const { supabase } = require('../config/supabase');
const { runPotholeGeometryWorkflow } = require('./imageAnalysisService');
const { estimateGeometry } = require('./potholeGeometryMath');
const geometryConfig = require('./potholeGeometryConfig');

/**
 * Orchestrates pothole footprint/depth estimation for one complaint: calls
 * the Roboflow geometry workflow, runs the homography+depth math
 * (potholeGeometryMath.js) with the assumed camera constants
 * (potholeGeometryConfig.js) -- or a real device tilt when the caller has
 * one -- and persists the result directly onto the complaint row.
 *
 * Deliberately does NOT go through routes/complaints.js's
 * filterComplaintDataForInsertion()/checkComplaintsTableSchema() machinery:
 * this runs as a targeted UPDATE on a known, small set of columns after the
 * complaint already exists, so that fragile live-schema-introspection path
 * (built for the initial INSERT) isn't a concern here.
 *
 * Only applies to pothole complaints for now -- see
 * PRIORITY_ENGINE plan doc: depth/footprint estimation is scoped to the
 * category this was actually requested for; other categories are marked
 * 'not_applicable' rather than silently skipped, so admins can tell "no
 * geometry data" apart from "geometry wasn't attempted".
 */
// Plausible range for a downward camera pitch (degrees below horizontal) at
// capture time. Client-supplied deviceTilt is unverified sensor data (see
// UrbanPulse_Frontend/app/src/services/DeviceTiltService.js) -- a value
// outside this range indicates a bad/garbled reading, not a real pose, so
// it's discarded in favor of the assumed default rather than fed into the
// geometry math and silently producing a bogus estimate.
const MIN_PLAUSIBLE_TILT_DEG = -10;
const MAX_PLAUSIBLE_TILT_DEG = 100;

function sanitizeDeviceTilt(deviceTilt) {
  if (typeof deviceTilt !== 'number' || !Number.isFinite(deviceTilt)) return null;
  if (deviceTilt < MIN_PLAUSIBLE_TILT_DEG || deviceTilt > MAX_PLAUSIBLE_TILT_DEG) return null;
  return deviceTilt;
}

async function estimateAndPersistGeometry({ complaintId, imageUrl, category, primaryClass, deviceTilt: rawDeviceTilt }) {
  const deviceTilt = sanitizeDeviceTilt(rawDeviceTilt);
  const applicable = category === 'pothole' || primaryClass === 'pothole';

  if (!applicable) {
    await safeUpdate(complaintId, { geometry_status: 'not_applicable' });
    return { status: 'not_applicable' };
  }

  if (!imageUrl) {
    await safeUpdate(complaintId, { geometry_status: 'failed', geometry_error: 'No image URL available' });
    return { status: 'failed', error: 'No image URL available' };
  }

  await safeUpdate(complaintId, { geometry_status: 'pending' });

  try {
    const instances = await runPotholeGeometryWorkflow(imageUrl);

    if (!Array.isArray(instances) || instances.length === 0) {
      await safeUpdate(complaintId, {
        geometry_status: 'failed',
        geometry_error: 'No pothole mask found by the geometry workflow',
      });
      return { status: 'failed', error: 'No pothole mask found' };
    }

    // If SAM3 found multiple pothole instances in one photo, use the
    // highest-confidence one -- consistent with how validateImageWithRoboflow
    // already picks a single "primary" detection elsewhere in this app.
    const best = instances.reduce((a, b) => ((b.confidence ?? 0) > (a.confidence ?? 0) ? b : a));

    const camera = deviceTilt != null
      ? {
          CAMERA_HEIGHT_M: geometryConfig.CAMERA_HEIGHT_M,
          CAMERA_TILT_DEG: deviceTilt,
          HORIZONTAL_FOV_DEG: geometryConfig.HORIZONTAL_FOV_DEG,
          VERTICAL_FOV_DEG: geometryConfig.VERTICAL_FOV_DEG,
          tiltSource: 'device_imu',
        }
      : {
          CAMERA_HEIGHT_M: geometryConfig.CAMERA_HEIGHT_M,
          CAMERA_TILT_DEG: geometryConfig.CAMERA_TILT_DEG,
          HORIZONTAL_FOV_DEG: geometryConfig.HORIZONTAL_FOV_DEG,
          VERTICAL_FOV_DEG: geometryConfig.VERTICAL_FOV_DEG,
          tiltSource: 'assumed_default',
        };

    const result = estimateGeometry(best, camera, geometryConfig);

    await safeUpdate(complaintId, {
      estimated_width_cm: result.widthCm,
      estimated_length_cm: result.lengthCm,
      estimated_area_cm2: result.areaCm2,
      estimated_depth_cm: result.depthCm,
      geometry_confidence: result.confidence,
      geometry_method: geometryConfig.GEOMETRY_METHOD_VERSION,
      geometry_assumptions: { ...result.assumptions, qualityFlags: result.qualityFlags },
      geometry_status: 'completed',
      geometry_error: null,
      geometry_computed_at: new Date().toISOString(),
    });

    return { status: 'completed', result };
  } catch (err) {
    console.error('❌ Pothole geometry estimation failed:', err.message);
    await safeUpdate(complaintId, { geometry_status: 'failed', geometry_error: err.message });
    return { status: 'failed', error: err.message };
  }
}

async function safeUpdate(complaintId, fields) {
  const { error } = await supabase.from('complaints').update(fields).eq('id', complaintId);
  if (error) {
    // Column(s) likely don't exist yet -- see database/add_pothole_geometry_columns.sql.
    console.error(`❌ Geometry status update failed for complaint ${complaintId}:`, error.message);
  }
}

module.exports = { estimateAndPersistGeometry };
