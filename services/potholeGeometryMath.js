/**
 * Pure geometry/math functions for converting a pothole's segmentation mask
 * (rim contour points + local depth samples, in pixel space and unitless
 * depth) into real-world width/length/area/depth estimates.
 *
 * No I/O here -- everything is a pure function of its inputs, so this file
 * is directly unit-testable (see potholeGeometryMath.test.js) without a
 * network or database.
 *
 * ============================================================================
 * METHOD OVERVIEW
 * ============================================================================
 * 1. HOMOGRAPHY (footprint): each rim pixel is turned into a camera-space
 *    ray using a pinhole model built from an assumed field of view, rotated
 *    by the camera's downward tilt, then intersected with the ground plane
 *    (Y=0, camera at height CAMERA_HEIGHT_M). This recovers each rim
 *    point's real-world (x, z) ground position -- valid because the rim
 *    lies on the flat road surface a homography can actually model. A
 *    homography cannot recover the pothole FLOOR's position (it's off the
 *    ground plane), which is why depth needs a separate step.
 *
 * 2. DEPTH (local calibration): Roboflow's depth-estimation block emits a
 *    per-image-normalized, unitless "nearness" map -- NOT physically
 *    comparable across photos taken from different distances (this is the
 *    scale-ambiguity problem discussed in project planning). We calibrate
 *    it locally: each rim point already has both a real slant-distance
 *    (from step 1) and a depth-model sample, so a linear regression of
 *    depth-vs-distance over just those ~28 points gives a photo-local
 *    conversion rate (depth-units per meter). The pothole floor reads at
 *    greater slant-distance than the surrounding road ring (a lower point
 *    on the same ray requires traveling farther along it -- see
 *    verticalDepthFromSlant below), so the ring/inside depth delta,
 *    divided by that local rate, gives the extra slant-distance the floor
 *    represents; multiplying by the ray's downward-angle sine converts that
 *    slant-distance into the vertical depth actually asked for.
 * ============================================================================
 */

function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Pinhole camera intrinsics from an assumed field of view.
 */
function buildIntrinsics(imageWidth, imageHeight, horizontalFovDeg, verticalFovDeg) {
  const fx = (imageWidth / 2) / Math.tan(degToRad(horizontalFovDeg) / 2);
  const fy = (imageHeight / 2) / Math.tan(degToRad(verticalFovDeg) / 2);
  return { fx, fy, cx: imageWidth / 2, cy: imageHeight / 2 };
}

/**
 * Convert one pixel (u, v) into a unit-length world-space ray, given the
 * camera's downward tilt (pitch, degrees below horizontal). Camera-space:
 * +x right, +y up, +z forward. World-space: +y up. Pitching the camera
 * down by `tiltDeg` rotates the forward/up plane about the camera's local
 * x-axis.
 */
function pixelToWorldRay(u, v, intrinsics, tiltDeg) {
  const { fx, fy, cx, cy } = intrinsics;
  const xc = (u - cx) / fx;
  const yc = (cy - v) / fy; // image v grows downward; flip so "up" is +y
  const zc = 1;

  const mag = Math.sqrt(xc * xc + yc * yc + zc * zc);
  const [nx, ny, nz] = [xc / mag, yc / mag, zc / mag];

  const tiltRad = degToRad(tiltDeg);
  const cosT = Math.cos(tiltRad);
  const sinT = Math.sin(tiltRad);

  return {
    x: nx,
    y: ny * cosT - nz * sinT,
    z: ny * sinT + nz * cosT,
  };
}

/**
 * Intersect a unit world ray (from the camera at height cameraHeightM) with
 * the ground plane (world Y = 0). Returns null when the ray points level
 * or upward (never reaches the ground in front of the camera under the
 * assumed tilt) -- callers should drop such points and note reduced
 * confidence rather than silently produce nonsense geometry.
 */
function intersectGround(rayWorld, cameraHeightM) {
  const EPS = 1e-6;
  if (rayWorld.y >= -EPS) return null;

  const t = -cameraHeightM / rayWorld.y; // slant distance, since rayWorld is unit length
  return {
    groundX: t * rayWorld.x,
    groundZ: t * rayWorld.z,
    slantDistanceM: t,
  };
}

/**
 * Shoelace formula for polygon area (m^2 -> cm^2). Points are expected in
 * their original contour order (preserved through the projection above),
 * which the shoelace formula requires for a correct (non-self-intersecting)
 * result.
 */
function computeAreaCm2(groundPoints) {
  const n = groundPoints.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = groundPoints[i];
    const b = groundPoints[(i + 1) % n];
    sum += a.groundX * b.groundZ - b.groundX * a.groundZ;
  }
  const areaM2 = Math.abs(sum) / 2;
  return areaM2 * 10000; // m^2 -> cm^2
}

/**
 * Oriented width/length (cm) via PCA: the major/minor axes of the point
 * cloud's covariance ellipse, with the point set's extent projected onto
 * each. Labeled "oriented-extent estimate" rather than true width/length of
 * a rectangle, since an irregular pothole isn't actually rectangular.
 */
function computeWidthLengthCm(groundPoints) {
  const n = groundPoints.length;
  if (n < 3) return { widthCm: 0, lengthCm: 0 };

  const meanX = groundPoints.reduce((s, p) => s + p.groundX, 0) / n;
  const meanZ = groundPoints.reduce((s, p) => s + p.groundZ, 0) / n;

  let sxx = 0, szz = 0, sxz = 0;
  for (const p of groundPoints) {
    const dx = p.groundX - meanX;
    const dz = p.groundZ - meanZ;
    sxx += dx * dx;
    szz += dz * dz;
    sxz += dx * dz;
  }
  sxx /= n; szz /= n; sxz /= n;

  // Closed-form eigen-decomposition of the 2x2 symmetric covariance matrix.
  const trace = sxx + szz;
  const det = sxx * szz - sxz * sxz;
  const disc = Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
  const lambda1 = trace / 2 + disc; // major
  const lambda2 = trace / 2 - disc; // minor

  let axis1;
  if (Math.abs(sxz) > 1e-12) {
    const vx = lambda1 - szz;
    const vz = sxz;
    const vm = Math.sqrt(vx * vx + vz * vz);
    axis1 = { x: vx / vm, z: vz / vm };
  } else {
    axis1 = sxx >= szz ? { x: 1, z: 0 } : { x: 0, z: 1 };
  }
  const axis2 = { x: -axis1.z, z: axis1.x }; // perpendicular

  let min1 = Infinity, max1 = -Infinity, min2 = Infinity, max2 = -Infinity;
  for (const p of groundPoints) {
    const dx = p.groundX - meanX;
    const dz = p.groundZ - meanZ;
    const proj1 = dx * axis1.x + dz * axis1.z;
    const proj2 = dx * axis2.x + dz * axis2.z;
    if (proj1 < min1) min1 = proj1;
    if (proj1 > max1) max1 = proj1;
    if (proj2 < min2) min2 = proj2;
    if (proj2 > max2) max2 = proj2;
  }

  const lengthM = max1 - min1; // along major axis
  const widthM = max2 - min2;  // along minor axis

  return {
    lengthCm: lengthM * 100,
    widthCm: widthM * 100,
    _lambda1: lambda1,
    _lambda2: lambda2,
  };
}

/**
 * Ordinary least-squares linear regression y = slope*x + intercept, plus R^2.
 */
function fitLinearRegression(xs, ys) {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: ys[0] || 0, r2: 0 };

  const xbar = xs.reduce((s, v) => s + v, 0) / n;
  const ybar = ys.reduce((s, v) => s + v, 0) / n;

  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - xbar) * (ys[i] - ybar);
    sxx += (xs[i] - xbar) * (xs[i] - xbar);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = ybar - slope * xbar;

  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = slope * xs[i] + intercept;
    ssRes += (ys[i] - pred) * (ys[i] - pred);
    ssTot += (ys[i] - ybar) * (ys[i] - ybar);
  }
  const r2 = ssTot === 0 ? (ssRes === 0 ? 1 : 0) : 1 - ssRes / ssTot;

  return { slope, intercept, r2 };
}

/**
 * Data-quality confidence (0-1), NOT an AHP criticality weight -- this is a
 * measurement-reliability penalty, a different kind of judgment from
 * priorityConfig.js's weights, so it is a plain documented multiplier
 * function rather than miscast as an AHP derivation.
 */
function computeConfidence({ ringSampleCount, rimPointCount, regressionR2, tiltSource, droppedPointRatio }, cfg) {
  let confidence = 1.0;
  const flags = [];

  if (ringSampleCount < cfg.MIN_RING_SAMPLE_PX) {
    confidence *= 0.5;
    flags.push('low_ring_sample_count');
  }
  if (rimPointCount < cfg.MIN_RIM_POINTS) {
    confidence *= 0.5;
    flags.push('low_rim_point_count');
  }
  if (regressionR2 < cfg.MIN_REGRESSION_R2) {
    confidence *= 0.6;
    flags.push('poor_depth_regression_fit');
  }
  if (droppedPointRatio > 0.2) {
    confidence *= 0.8;
    flags.push('rim_points_dropped_above_horizon');
  }
  if (tiltSource === 'assumed_default') {
    confidence *= 0.7;
    flags.push('assumed_camera_tilt');
  }

  return { confidence: Math.max(0, Math.min(1, confidence)), flags };
}

/**
 * Main entry point: turn one Roboflow-detected pothole instance into a
 * geometry estimate.
 *
 * @param {object} instance - one entry from the Roboflow workflow's
 *   `instances` output: { rim_points_px: [[u,v],...],
 *   rim_depth_samples: [{px:[u,v], nd:number}], depth_median_inside,
 *   depth_median_ring, ring_sample_count, centroid_px: [u,v],
 *   image_width, image_height }
 * @param {object} camera - { CAMERA_HEIGHT_M, CAMERA_TILT_DEG,
 *   HORIZONTAL_FOV_DEG, VERTICAL_FOV_DEG, tiltSource } merged from
 *   potholeGeometryConfig.js, optionally overridden with a real device tilt
 * @param {object} cfg - threshold constants from potholeGeometryConfig.js
 */
function estimateGeometry(instance, camera, cfg) {
  const qualityFlags = [];
  const {
    rim_points_px: rimPointsPx = [],
    rim_depth_samples: rimDepthSamples = [],
    depth_median_inside: depthMedianInside,
    depth_median_ring: depthMedianRing,
    ring_sample_count: ringSampleCount = 0,
    centroid_px: centroidPx,
    image_width: imageWidth,
    image_height: imageHeight,
  } = instance;

  const intrinsics = buildIntrinsics(imageWidth, imageHeight, camera.HORIZONTAL_FOV_DEG, camera.VERTICAL_FOV_DEG);

  // Project every rim point to the ground plane; drop points whose ray
  // never reaches the ground under the assumed tilt.
  const groundPoints = [];
  let droppedCount = 0;
  for (const [u, v] of rimPointsPx) {
    const rayWorld = pixelToWorldRay(u, v, intrinsics, camera.CAMERA_TILT_DEG);
    const hit = intersectGround(rayWorld, camera.CAMERA_HEIGHT_M);
    if (!hit) { droppedCount++; continue; }
    groundPoints.push(hit);
  }

  const rimPointCount = groundPoints.length;
  const droppedPointRatio = rimPointsPx.length > 0 ? droppedCount / rimPointsPx.length : 1;

  let areaCm2 = 0, widthCm = 0, lengthCm = 0;
  if (rimPointCount >= 3) {
    areaCm2 = computeAreaCm2(groundPoints);
    const wl = computeWidthLengthCm(groundPoints);
    widthCm = wl.widthCm;
    lengthCm = wl.lengthCm;
  } else {
    qualityFlags.push('insufficient_rim_points_for_footprint');
  }

  // Depth: build (slantDistance, normalizedDepth) pairs from the rim
  // samples (each already has a real slant-distance via the same
  // projection used for the footprint) and fit the local calibration.
  const regressionXs = [];
  const regressionYs = [];
  for (const sample of rimDepthSamples) {
    const [u, v] = sample.px;
    const rayWorld = pixelToWorldRay(u, v, intrinsics, camera.CAMERA_TILT_DEG);
    const hit = intersectGround(rayWorld, camera.CAMERA_HEIGHT_M);
    if (!hit) continue;
    regressionXs.push(hit.slantDistanceM);
    regressionYs.push(sample.nd);
  }

  let depthCm = 0;
  let regressionR2 = 0;
  if (regressionXs.length >= 2 && typeof depthMedianInside === 'number' && typeof depthMedianRing === 'number') {
    const { slope, r2 } = fitLinearRegression(regressionXs, regressionYs);
    regressionR2 = r2;
    const ratePerMeter = -slope; // expected positive: depth-units lost per meter of distance

    const deltaNd = depthMedianRing - depthMedianInside; // expected positive (see file header)
    if (deltaNd <= 0) {
      qualityFlags.push('unexpected_depth_sign');
    }
    if (ratePerMeter <= 0) {
      qualityFlags.push('non_monotonic_depth_regression');
    }

    if (deltaNd > 0 && ratePerMeter > 0) {
      const extraSlantDistanceM = deltaNd / ratePerMeter;

      // Convert extra slant-distance into vertical depth using the
      // pothole centroid ray's downward angle: traveling an additional
      // slant-distance S along a ray whose unit direction has vertical
      // component sin(phi) produces a vertical drop of S*sin(phi).
      let verticalFactor = Math.sin(degToRad(camera.CAMERA_TILT_DEG)); // fallback
      if (centroidPx) {
        const centroidRay = pixelToWorldRay(centroidPx[0], centroidPx[1], intrinsics, camera.CAMERA_TILT_DEG);
        if (centroidRay.y < 0) verticalFactor = Math.abs(centroidRay.y);
      }

      const verticalDepthM = extraSlantDistanceM * verticalFactor;
      const rawDepthCm = verticalDepthM * 100;

      if (rawDepthCm > cfg.MAX_PLAUSIBLE_DEPTH_CM) {
        qualityFlags.push('depth_exceeds_plausible_range');
      }
      depthCm = Math.max(0, Math.min(rawDepthCm, cfg.MAX_PLAUSIBLE_DEPTH_CM));
    }
  } else {
    qualityFlags.push('insufficient_depth_samples');
  }

  const { confidence, flags: confidenceFlags } = computeConfidence(
    { ringSampleCount, rimPointCount, regressionR2, tiltSource: camera.tiltSource, droppedPointRatio },
    cfg
  );

  return {
    widthCm: round1(widthCm),
    lengthCm: round1(lengthCm),
    areaCm2: round1(areaCm2),
    depthCm: round1(depthCm),
    confidence: Math.round(confidence * 100) / 100,
    qualityFlags: [...qualityFlags, ...confidenceFlags],
    assumptions: {
      cameraHeightM: camera.CAMERA_HEIGHT_M,
      cameraTiltDeg: camera.CAMERA_TILT_DEG,
      tiltSource: camera.tiltSource,
      horizontalFovDeg: camera.HORIZONTAL_FOV_DEG,
      verticalFovDeg: camera.VERTICAL_FOV_DEG,
      rimPointCount,
      droppedRimPoints: droppedCount,
      ringSampleCount,
      regressionR2: Math.round(regressionR2 * 1000) / 1000,
    },
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

module.exports = {
  degToRad,
  buildIntrinsics,
  pixelToWorldRay,
  intersectGround,
  computeAreaCm2,
  computeWidthLengthCm,
  fitLinearRegression,
  computeConfidence,
  estimateGeometry,
};
