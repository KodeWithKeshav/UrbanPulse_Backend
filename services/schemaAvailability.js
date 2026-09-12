/**
 * Lets routes that explicitly SELECT the pothole geometry columns
 * (estimated_width_cm etc. - see database/add_pothole_geometry_columns.sql)
 * degrade gracefully instead of hard-failing with a Postgres "column does
 * not exist" error on any Supabase project the migration hasn't been run
 * on yet.
 *
 * Cheap existence probe (SELECT of one column, LIMIT 1) cached briefly in
 * memory. Short TTL rather than "check once and remember forever" so that
 * running the migration is picked up on its own within a minute, with no
 * server restart needed.
 */

const CHECK_TTL_MS = 60_000;

let cache = { available: null, checkedAt: 0 };
let deviceIdCache = { available: null, checkedAt: 0 };

async function geometryColumnsAvailable(supabase) {
  const now = Date.now();
  if (cache.available !== null && now - cache.checkedAt < CHECK_TTL_MS) {
    return cache.available;
  }

  const { error } = await supabase.from('complaints').select('geometry_status').limit(1);
  // Any error here is treated as "not available" -- the caller falls back
  // to placeholders either way, and a transient/unrelated error will just
  // be re-checked on the next request rather than cached for the full TTL.
  const available = !error;
  cache = { available, checkedAt: now };
  return available;
}

// Same probe-and-cache pattern as geometryColumnsAvailable, for
// complaint_votes.device_id (database/add_device_id_to_complaint_votes.sql)
// -- lets routes/guest-votes.js dedupe guest votes per-device once the
// migration has run, while degrading gracefully (no dedup, today's
// behavior) beforehand.
async function deviceIdColumnAvailable(supabase) {
  const now = Date.now();
  if (deviceIdCache.available !== null && now - deviceIdCache.checkedAt < CHECK_TTL_MS) {
    return deviceIdCache.available;
  }

  const { error } = await supabase.from('complaint_votes').select('device_id').limit(1);
  const available = !error;
  deviceIdCache = { available, checkedAt: now };
  return available;
}

// Null placeholders for every geometry column, keyed the same as the real
// row shape, so callers can spread this onto a complaint object selected
// without those columns and keep a consistent response shape for clients.
// geometry_status deliberately stays null (not 'not_applicable') -- that
// value already means something specific (category doesn't support
// geometry estimation) and would be misleading here; both the mobile and
// web admin UIs only render the estimate line when geometry_status ===
// 'completed', so null renders identically to "no data yet" either way.
const GEOMETRY_PLACEHOLDER = {
  estimated_width_cm: null,
  estimated_length_cm: null,
  estimated_area_cm2: null,
  estimated_depth_cm: null,
  geometry_confidence: null,
  geometry_method: null,
  geometry_assumptions: null,
  geometry_status: null,
  geometry_error: null,
  geometry_computed_at: null,
};

module.exports = { geometryColumnsAvailable, GEOMETRY_PLACEHOLDER, deviceIdColumnAvailable };
