/**
 * osmPlacesService
 *
 * Keyless replacement for Google Places nearby search, backed by the
 * OpenStreetMap Overpass API. LocationPriorityService asks for one place
 * type at a time (hospital, school, police, ...) — roughly 20 lookups per
 * complaint — so instead of 20 HTTP calls we fetch every supported type
 * around the point in ONE Overpass query, cache it briefly, and filter per
 * type in memory.
 *
 * Results mimic the Google Places shape the scoring code already consumes
 * ({ name, place_id, geometry, types, vicinity, rating }), with Google-style
 * type names in `types` so keyword filters and assessFacilityImportance()
 * keep working unchanged.
 */

const axios = require('axios');

// Public Overpass instances are free but individually flaky (429/504 under
// load), so try the configured one first and then fall back to mirrors.
const OVERPASS_URLS = [
  process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter',
  ...(process.env.OVERPASS_FALLBACK_URLS || 'https://maps.mail.ru/osm/tools/overpass/api/interpreter')
    .split(',').map((u) => u.trim()).filter(Boolean),
].filter((u, i, all) => all.indexOf(u) === i);
// Complaint submission waits on this lookup; bound the whole mirror chain so
// a slow OSM day degrades location scoring instead of hanging the request.
const LOOKUP_BUDGET_MS = parseInt(process.env.OVERPASS_BUDGET_MS, 10) || 12000;
const CACHE_TTL_MS = 10 * 60 * 1000;
// A failed lookup is remembered briefly so the ~20 per-type searches for the
// same complaint fail fast instead of each re-hitting a struggling server.
const FAILURE_TTL_MS = 60 * 1000;
const CACHE_MAX_ENTRIES = 100;
// Google Nearby Search returned at most 20 places per type; area-type
// thresholds in LocationPriorityService (e.g. >= 80 probe hits) were tuned
// against that cap, so keep it.
const MAX_RESULTS_PER_TYPE = 20;
// Shops/restaurants are only used by the 1km area-density probe; pulling
// them over a 10km radius in a city would return tens of thousands of nodes.
const DENSE_TYPE_MAX_RADIUS = 2000;

// Google place type -> OSM tag filters (Overpass selector form).
const TYPE_TAGS = {
  hospital: ['["amenity"="hospital"]', '["healthcare"="hospital"]'],
  doctor: ['["amenity"~"^(clinic|doctors)$"]', '["healthcare"~"^(clinic|doctor)$"]'],
  school: ['["amenity"="school"]'],
  primary_school: ['["amenity"="school"]["isced:level"~"(^|;)1(;|$)"]'],
  university: ['["amenity"~"^(university|college)$"]'],
  police: ['["amenity"="police"]'],
  fire_station: ['["amenity"="fire_station"]'],
  transit_station: ['["public_transport"="station"]', '["railway"~"^(station|halt)$"]'],
  bus_station: ['["amenity"="bus_station"]'],
  subway_station: ['["station"="subway"]', '["railway"="station"]["subway"="yes"]'],
  local_government_office: ['["office"="government"]'],
  city_hall: ['["amenity"="townhall"]'],
  bank: ['["amenity"="bank"]'],
  atm: ['["amenity"="atm"]'],
  pharmacy: ['["amenity"="pharmacy"]', '["healthcare"="pharmacy"]'],
  drugstore: ['["shop"="chemist"]'],
  store: ['["shop"]'],
  restaurant: ['["amenity"~"^(restaurant|fast_food|cafe)$"]'],
};
const DENSE_TYPES = new Set(['store', 'restaurant']);

// Extra Google-style types attached to matches (Google tags hospitals and
// clinics with "health", etc.).
const EXTRA_TYPES = {
  hospital: ['health'],
  doctor: ['health'],
  pharmacy: ['health'],
  drugstore: ['health'],
  primary_school: ['school'],
  bus_station: ['transit_station'],
  subway_station: ['transit_station'],
};

const cache = new Map();

/**
 * Evaluate an Overpass selector string like ["amenity"~"^(a|b)$"]["x"="y"]
 * against an element's tags, so a single bulk result can be split per type.
 */
function matchesSelector(tags, selector) {
  const parts = selector.match(/\[[^\]]+\]/g) || [];
  return parts.every((part) => {
    const m = part.match(/^\["([^"]+)"(?:(=|~)"([^"]*)")?\]$/);
    if (!m) return false;
    const [, key, op, value] = m;
    if (!(key in tags)) return false;
    if (!op) return true;
    return op === '=' ? tags[key] === value : new RegExp(value).test(tags[key]);
  });
}

function typesForTags(tags) {
  const types = new Set();
  for (const [type, selectors] of Object.entries(TYPE_TAGS)) {
    if (selectors.some((s) => matchesSelector(tags, s))) {
      types.add(type);
      (EXTRA_TYPES[type] || []).forEach((t) => types.add(t));
    }
  }
  if (types.size > 0) types.add('point_of_interest').add('establishment');
  return [...types];
}

function buildQuery(latitude, longitude, radius) {
  const selectors = new Set();
  for (const [type, tags] of Object.entries(TYPE_TAGS)) {
    if (DENSE_TYPES.has(type) && radius > DENSE_TYPE_MAX_RADIUS) continue;
    tags.forEach((t) => selectors.add(t));
  }
  const around = `(around:${Math.round(radius)},${latitude},${longitude})`;
  const body = [...selectors].map((s) => `  nwr${s}${around};`).join('\n');
  return `[out:json][timeout:25];\n(\n${body}\n);\nout center tags;`;
}

function formatAddress(tags) {
  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  return [street, tags['addr:suburb'], tags['addr:city']].filter(Boolean).join(', ');
}

function toPlace(element) {
  const tags = element.tags || {};
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return {
    name: tags.name || tags['name:en'] || tags.operator || 'Unnamed place',
    place_id: `osm:${element.type}/${element.id}`,
    geometry: { location: { lat, lng } },
    types: typesForTags(tags),
    vicinity: formatAddress(tags),
    rating: 0, // OSM has no ratings
  };
}

async function postOverpass(url, query, signal) {
  const response = await axios.post(url, new URLSearchParams({ data: query }).toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'UrbanPulse/1.0 (civic complaint prioritisation)',
    },
    signal,
  });
  if (!Array.isArray(response.data?.elements)) {
    throw new Error('malformed Overpass response');
  }
  return response.data.elements;
}

async function fetchAllPlaces(latitude, longitude, radius) {
  const query = buildQuery(latitude, longitude, radius);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_BUDGET_MS);

  // Race all instances: public servers are often slow or 504 for 10s+, and
  // waiting on them one at a time would burn the whole budget on the first.
  const attempts = OVERPASS_URLS.map((url) =>
    postOverpass(url, query, controller.signal)
      .then((elements) => ({ url, elements }))
      .catch((err) => {
        throw new Error(`${new URL(url).host}: ${controller.signal.aborted ? 'timed out' : (err.response?.status || err.message)}`);
      })
  );

  try {
    const { url, elements } = await Promise.any(attempts);
    const places = elements.map(toPlace).filter(Boolean);
    console.log(`🗺️ Overpass (${new URL(url).host}): ${places.length} places within ${Math.round(radius)}m in ${Date.now() - started}ms`);
    return places;
  } catch (aggregate) {
    const reasons = (aggregate.errors || [aggregate]).map((e) => e.message).join('; ');
    const error = new Error(`OpenStreetMap lookup failed (${reasons})`);
    // Every instance already had its chance within the budget; retrying per
    // facility type would just multiply the wait.
    error.retryable = false;
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort(); // cancel the slower instances
  }
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getPlacesAround(latitude, longitude, radius) {
  // ~11m grid so lookups for the same complaint share requests.
  const pointKey = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;
  const now = Date.now();
  const entries = (cache.get(pointKey) || []).filter((e) => now - e.at < (e.failed ? FAILURE_TTL_MS : CACHE_TTL_MS));

  // A recent failure at this point means Overpass is struggling: fail fast.
  const failure = entries.find((e) => e.failed);
  if (failure) return Promise.reject(failure.error);

  // Reuse any fetch covering at least this radius (dense shop/restaurant
  // types are only included in small-radius fetches, so require a match).
  const needsDense = radius <= DENSE_TYPE_MAX_RADIUS;
  const covering = entries.find((e) => e.radius >= radius && (!needsDense || e.radius <= DENSE_TYPE_MAX_RADIUS));
  if (covering) {
    return covering.radius === radius
      ? covering.promise
      : covering.promise.then((places) => places.filter((p) =>
        distanceMeters(latitude, longitude, p.geometry.location.lat, p.geometry.location.lng) <= radius));
  }

  const entry = { radius, at: now, promise: fetchAllPlaces(latitude, longitude, radius) };
  entry.promise.catch((error) => Object.assign(entry, { failed: true, error, at: Date.now() }));
  entries.push(entry);
  cache.delete(pointKey);
  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(pointKey, entries);
  return entry.promise;
}

/**
 * Nearby search for one Google-style place type.
 * @returns {Promise<Array>} the (up to) 20 nearest places of that type.
 */
async function nearbySearch(latitude, longitude, type, radius) {
  if (!TYPE_TAGS[type]) {
    const error = new Error(`Unsupported place type for OpenStreetMap search: ${type}`);
    error.retryable = false;
    throw error;
  }
  const lat = Number(latitude);
  const lng = Number(longitude);
  const places = await getPlacesAround(lat, lng, radius);
  const distance = (p) => distanceMeters(lat, lng, p.geometry.location.lat, p.geometry.location.lng);
  return places
    .filter((p) => p.types.includes(type))
    .sort((a, b) => distance(a) - distance(b))
    .slice(0, MAX_RESULTS_PER_TYPE);
}

module.exports = {
  nearbySearch,
  SUPPORTED_TYPES: Object.keys(TYPE_TAGS),
  // exported for tests
  _buildQuery: buildQuery,
  _typesForTags: typesForTags,
  _toPlace: toPlace,
  _clearCache: () => cache.clear(),
};
