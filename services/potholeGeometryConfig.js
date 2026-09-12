/**
 * ============================================================================
 * POTHOLE GEOMETRY CONFIGURATION -- single source of truth
 * ============================================================================
 * Every assumed camera/geometry constant used by services/potholeGeometryMath.js
 * and services/potholeGeometryService.js lives here, each with a written
 * rationale -- same documentation discipline as services/priorityConfig.js
 * (the AHP-derived priority weights). Nothing here is a bare literal
 * presented as measured fact: these are engineering defaults used because
 * the citizen app currently captures photos via expo-image-picker's
 * launchCameraAsync(), which exposes no device tilt or camera intrinsics
 * (see plan doc, Phase 2/3). CAMERA_TILT_DEG in particular is replaced
 * per-request the moment a real device tilt reading is available.
 * ============================================================================
 */

// CAMERA_HEIGHT_M: assumed height (meters) of the phone's camera above the
// ground at capture time. 1.4m approximates a typical chest/waist-height
// hold while photographing something on the ground a meter or two ahead --
// not eye height, since citizens angle the phone down/forward for this
// shot rather than holding it up to their face. Engineering default;
// Phase 2/3 (see plan) could replace this with a per-user calibration.
const CAMERA_HEIGHT_M = 1.4;

// CAMERA_TILT_DEG: assumed downward pitch (degrees below horizontal) of the
// camera at capture time. 35 degrees approximates pointing a handheld phone
// at a pothole roughly 1-2m in front of the citizen's feet. This is the
// single most impactful assumption in the whole pipeline and the first
// candidate for replacement -- see potholeGeometryService.js, which prefers
// a caller-supplied deviceTilt (Phase 2: expo-sensors DeviceMotion) over
// this default whenever one is present.
const CAMERA_TILT_DEG = 35;

// HORIZONTAL_FOV_DEG / VERTICAL_FOV_DEG: assumed field of view in degrees.
// Derived from a ~26mm full-frame-equivalent focal length, common across
// current iPhone/Pixel/Samsung *main* rear cameras, which works out to
// roughly a 70 degree horizontal FOV. The citizen app crops photos to a
// 4:3 aspect ratio (UrbanPulse_Frontend/app: launchCameraAsync({aspect:
// [4,3]})), so the vertical FOV implied by that aspect at 70 degrees
// horizontal is ~55 degrees. Documented default, not a per-device
// measurement -- expo-image-picker exposes no camera intrinsics (see
// Phase 3 in the plan: only migrating to expo-camera would allow reading
// the device's real focal length/sensor size).
const HORIZONTAL_FOV_DEG = 70;
const VERTICAL_FOV_DEG = 55;

// --- Confidence-penalty thresholds (data-quality gating, not AHP weights --
// these describe when a specific *measurement* looks unreliable, not a
// criticality judgment, so they are plain documented thresholds rather than
// AHP-derived) ---

// Below this many ring (surrounding-road) pixels, the local depth baseline
// is too small a sample to trust (e.g. the pothole touches the image edge
// or is very close to the camera, cropping the ring).
const MIN_RING_SAMPLE_PX = 50;

// Below this many resampled rim points, the homography-projected polygon
// (and the depth regression, which reuses the same points) is too sparse
// to be a reliable estimate of shape or scale.
const MIN_RIM_POINTS = 10;

// Below this R^2, the local "depth vs. slant-distance" linear fit used to
// convert the depth model's unitless output into a real scale is a poor
// fit -- the resulting depth estimate is flagged, not hidden.
const MIN_REGRESSION_R2 = 0.3;

// Sanity clamp for the final depth estimate (cm). Real potholes are rarely
// deeper than this; a raw value above it indicates a failed local
// calibration, not an actual multi-decimeter-deep hole, and is flagged via
// qualityFlags rather than silently clipped-and-hidden.
const MAX_PLAUSIBLE_DEPTH_CM = 60;

// How many evenly arc-length-spaced points the Roboflow custom Python block
// resamples each pothole's mask contour to. Bounds the payload size
// regardless of how complex the traced contour is. Mirrored as a comment
// in the workflow's Pothole_Geometry_Depth_Extractor block (a raster
// constant that lives in Python, not a camera-model constant, so it is not
// itself read by Node -- documented here for a single point of reference).
const RIM_RESAMPLE_POINT_COUNT = 28;

const GEOMETRY_METHOD_VERSION = 'homography_imu_tilt_v1+depth_anything_v3_small';

module.exports = {
  CAMERA_HEIGHT_M,
  CAMERA_TILT_DEG,
  HORIZONTAL_FOV_DEG,
  VERTICAL_FOV_DEG,
  MIN_RING_SAMPLE_PX,
  MIN_RIM_POINTS,
  MIN_REGRESSION_R2,
  MAX_PLAUSIBLE_DEPTH_CM,
  RIM_RESAMPLE_POINT_COUNT,
  GEOMETRY_METHOD_VERSION,
};
