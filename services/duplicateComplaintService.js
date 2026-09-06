/**
 * Finds an existing, still-open complaint that's plausibly the same real-
 * world issue as a new submission, so routes/complaints.js's /submit can
 * upvote it (see services/voteService.js's castUpvote) instead of creating
 * a duplicate row. V1 heuristic: same category, within DUPLICATE_RADIUS_M
 * of each other, not already resolved/rejected.
 *
 * This is a proximity+category proxy, not true same-issue detection - two
 * distinct potholes 20m apart on the same street would incorrectly match.
 * Good enough as a first pass given there's no image/text similarity
 * infra in this app yet; tune DUPLICATE_RADIUS_M down if that turns out to
 * over-merge in practice.
 */

// Matches this app's existing "street-level" location-privacy radius
// (~25m, see LocationService/ChatbotKnowledgeBase) with a little slack for
// GPS drift between two separate citizens' reports of the same spot.
const DUPLICATE_RADIUS_M = 40;

const EARTH_RADIUS_M = 6371000;
const METERS_PER_DEGREE_LAT = 111320;

function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * @returns the closest matching complaint (with `_distanceMeters` added),
 * or null if none found within radiusMeters.
 */
async function findNearbyDuplicateComplaint({
  supabase,
  category,
  latitude,
  longitude,
  radiusMeters = DUPLICATE_RADIUS_M,
}) {
  if (!category || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  // Cheap bounding-box pre-filter in SQL (lat/lng deltas for the radius),
  // then exact Haversine distance in JS for the (small) candidate set -
  // this table has no PostGIS geometry column to do it server-side.
  const latDelta = radiusMeters / METERS_PER_DEGREE_LAT;
  const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos((latitude * Math.PI) / 180);
  const lonDelta = radiusMeters / (metersPerDegreeLon || METERS_PER_DEGREE_LAT);

  const { data: candidates, error } = await supabase
    .from('complaints')
    .select('*')
    .eq('category', category)
    .not('status', 'in', '(resolved,rejected)')
    .gte('location_latitude', latitude - latDelta)
    .lte('location_latitude', latitude + latDelta)
    .gte('location_longitude', longitude - lonDelta)
    .lte('location_longitude', longitude + lonDelta);

  if (error) {
    console.error('❌ Duplicate-complaint lookup failed (continuing as no-duplicate):', error.message);
    return null;
  }
  if (!candidates || candidates.length === 0) return null;

  let closest = null;
  let closestDistance = Infinity;
  for (const candidate of candidates) {
    const lat2 = parseFloat(candidate.location_latitude);
    const lon2 = parseFloat(candidate.location_longitude);
    if (Number.isNaN(lat2) || Number.isNaN(lon2)) continue;

    const distance = haversineMeters(latitude, longitude, lat2, lon2);
    if (distance <= radiusMeters && distance < closestDistance) {
      closest = candidate;
      closestDistance = distance;
    }
  }

  return closest ? { ...closest, _distanceMeters: closestDistance } : null;
}

module.exports = { findNearbyDuplicateComplaint, DUPLICATE_RADIUS_M };
