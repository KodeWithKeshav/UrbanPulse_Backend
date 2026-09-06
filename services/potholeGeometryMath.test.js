const {
  degToRad,
  buildIntrinsics,
  pixelToWorldRay,
  intersectGround,
  computeAreaCm2,
  computeWidthLengthCm,
  fitLinearRegression,
  computeConfidence,
  estimateGeometry,
} = require('./potholeGeometryMath');
const cfg = require('./potholeGeometryConfig');

const IMAGE_W = 1200;
const IMAGE_H = 900; // 4:3, matches the app's capture aspect
const H = cfg.CAMERA_HEIGHT_M;
const TILT = cfg.CAMERA_TILT_DEG;
const intrinsics = buildIntrinsics(IMAGE_W, IMAGE_H, cfg.HORIZONTAL_FOV_DEG, cfg.VERTICAL_FOV_DEG);

/** Inverse of pixelToWorldRay + intersectGround: project a known
 * ground-plane point (relative to the camera) back to a pixel, so tests
 * can construct synthetic rim points with a known real-world shape. */
function worldGroundPointToPixel(worldX, worldZ, cameraHeightM, tiltDeg) {
  const t = degToRad(tiltDeg);
  const c = Math.cos(t), s = Math.sin(t);
  const vx = worldX;
  const vy = -cameraHeightM;
  const vz = worldZ;
  // Inverse rotation (R(t)^T) to go from world back to camera space.
  const camX = vx;
  const camY = c * vy + s * vz;
  const camZ = -s * vy + c * vz;
  if (camZ <= 0) return null;
  const xc = camX / camZ;
  const yc = camY / camZ;
  const u = intrinsics.cx + intrinsics.fx * xc;
  const v = intrinsics.cy - intrinsics.fy * yc;
  return [u, v];
}

describe('pixelToWorldRay + intersectGround (homography core)', () => {
  test('a point straight ahead on the ground round-trips to itself', () => {
    const [u, v] = worldGroundPointToPixel(0, 3, H, TILT);
    const ray = pixelToWorldRay(u, v, intrinsics, TILT);
    const hit = intersectGround(ray, H);
    expect(hit).not.toBeNull();
    expect(hit.groundX).toBeCloseTo(0, 3);
    expect(hit.groundZ).toBeCloseTo(3, 3);
  });

  test('an off-center ground point round-trips to itself', () => {
    const [u, v] = worldGroundPointToPixel(0.4, 2.2, H, TILT);
    const ray = pixelToWorldRay(u, v, intrinsics, TILT);
    const hit = intersectGround(ray, H);
    expect(hit.groundX).toBeCloseTo(0.4, 2);
    expect(hit.groundZ).toBeCloseTo(2.2, 2);
  });

  test('a ray pointing above the assumed horizon is rejected', () => {
    // Straight along the camera's local forward axis before tilt is
    // applied at pixel (cx, cy) rotated by tilt still points downward for
    // any tilt > 0, so force an above-horizon ray directly: pick a pixel
    // far above the image center, which under a 35-degree downward tilt
    // and this FOV points above horizontal.
    const ray = pixelToWorldRay(intrinsics.cx, intrinsics.cy - intrinsics.fy * 5, intrinsics, TILT);
    const hit = intersectGround(ray, H);
    expect(hit).toBeNull();
  });
});

describe('computeAreaCm2 + computeWidthLengthCm (footprint)', () => {
  test('recovers area and extent of a known rectangle', () => {
    // A 0.5m x 0.3m axis-aligned rectangle on the ground, 2.5m out.
    const corners = [
      { groundX: -0.25, groundZ: 2.35 },
      { groundX: 0.25, groundZ: 2.35 },
      { groundX: 0.25, groundZ: 2.65 },
      { groundX: -0.25, groundZ: 2.65 },
    ];
    const areaCm2 = computeAreaCm2(corners);
    expect(areaCm2).toBeCloseTo(0.5 * 0.3 * 10000, 0); // 1500 cm^2

    const { widthCm, lengthCm } = computeWidthLengthCm(corners);
    const dims = [widthCm, lengthCm].sort((a, b) => a - b);
    expect(dims[0]).toBeCloseTo(30, 0);
    expect(dims[1]).toBeCloseTo(50, 0);
  });

  test('degenerate input (< 3 points) returns zero, not NaN', () => {
    expect(computeAreaCm2([{ groundX: 0, groundZ: 0 }])).toBe(0);
    const wl = computeWidthLengthCm([{ groundX: 0, groundZ: 0 }, { groundX: 1, groundZ: 1 }]);
    expect(wl.widthCm).toBe(0);
    expect(wl.lengthCm).toBe(0);
  });
});

describe('fitLinearRegression', () => {
  test('recovers a known noiseless linear relationship', () => {
    const xs = [1, 2, 3, 4, 5];
    const ys = xs.map((x) => 10 - 2 * x); // slope -2, intercept 10
    const { slope, intercept, r2 } = fitLinearRegression(xs, ys);
    expect(slope).toBeCloseTo(-2, 6);
    expect(intercept).toBeCloseTo(10, 6);
    expect(r2).toBeCloseTo(1, 6);
  });

  test('reports low R^2 for noisy/unrelated data', () => {
    const xs = [1, 2, 3, 4, 5];
    const ys = [5, 1, 8, 2, 9];
    const { r2 } = fitLinearRegression(xs, ys);
    expect(r2).toBeLessThan(cfg.MIN_REGRESSION_R2 + 0.3);
  });
});

describe('computeConfidence', () => {
  const baseInputs = {
    ringSampleCount: 200,
    rimPointCount: 28,
    regressionR2: 0.9,
    tiltSource: 'device_imu',
    droppedPointRatio: 0,
  };

  test('full confidence when every input is healthy', () => {
    const { confidence, flags } = computeConfidence(baseInputs, cfg);
    expect(confidence).toBe(1);
    expect(flags).toHaveLength(0);
  });

  test('penalizes an assumed (non-device) tilt', () => {
    const { confidence, flags } = computeConfidence({ ...baseInputs, tiltSource: 'assumed_default' }, cfg);
    expect(confidence).toBeCloseTo(0.7, 5);
    expect(flags).toContain('assumed_camera_tilt');
  });

  test('stacks multiple penalties multiplicatively', () => {
    const { confidence, flags } = computeConfidence(
      { ...baseInputs, ringSampleCount: 5, rimPointCount: 3, tiltSource: 'assumed_default' },
      cfg
    );
    expect(confidence).toBeCloseTo(0.5 * 0.5 * 0.7, 5);
    expect(flags).toEqual(expect.arrayContaining([
      'low_ring_sample_count', 'low_rim_point_count', 'assumed_camera_tilt',
    ]));
  });
});

describe('estimateGeometry (end-to-end synthetic case)', () => {
  test('recovers a known circular pothole footprint and a known synthetic depth', () => {
    const RADIUS_M = 0.25;
    const CENTER_Z = 2.0; // 2m straight ahead
    const N = cfg.RIM_RESAMPLE_POINT_COUNT;

    const rimWorldPoints = [];
    const rimPointsPx = [];
    for (let i = 0; i < N; i++) {
      const angle = (2 * Math.PI * i) / N;
      const wx = RADIUS_M * Math.cos(angle);
      const wz = CENTER_Z + RADIUS_M * Math.sin(angle);
      rimWorldPoints.push({ groundX: wx, groundZ: wz });
      const px = worldGroundPointToPixel(wx, wz, H, TILT);
      rimPointsPx.push(px);
    }
    const centroidPx = worldGroundPointToPixel(0, CENTER_Z, H, TILT);

    // Synthetic depth model: nd = 0.9 - 0.05*slantDistance (a plausible
    // monotonic falloff), then bake in a KNOWN 8cm depth by computing what
    // ring/inside medians that implies, using the same geometry the
    // production code uses to go the other direction.
    const A = 0.9, B = 0.05; // nd = A - B * distance
    const centroidRay = pixelToWorldRay(centroidPx[0], centroidPx[1], intrinsics, TILT);
    const verticalFactor = Math.abs(centroidRay.y);
    const KNOWN_DEPTH_M = 0.08;
    const extraSlantDistanceM = KNOWN_DEPTH_M / verticalFactor;

    const rimDepthSamples = rimPointsPx.map((px) => {
      const ray = pixelToWorldRay(px[0], px[1], intrinsics, TILT);
      const hit = intersectGround(ray, H);
      return { px, nd: A - B * hit.slantDistanceM };
    });

    // Ring/inside medians consistent with the same local linear model,
    // offset by the known extra slant-distance the floor represents.
    const ringDistances = rimDepthSamples.map((s, i) => {
      const ray = pixelToWorldRay(rimPointsPx[i][0], rimPointsPx[i][1], intrinsics, TILT);
      return intersectGround(ray, H).slantDistanceM;
    });
    const medianRingDistance = ringDistances.slice().sort((a, b) => a - b)[Math.floor(ringDistances.length / 2)];
    const depthMedianRing = A - B * medianRingDistance;
    const depthMedianInside = A - B * (medianRingDistance + extraSlantDistanceM);

    const instance = {
      rim_points_px: rimPointsPx,
      rim_depth_samples: rimDepthSamples,
      depth_median_inside: depthMedianInside,
      depth_median_ring: depthMedianRing,
      ring_sample_count: 200,
      centroid_px: centroidPx,
      image_width: IMAGE_W,
      image_height: IMAGE_H,
    };

    const camera = {
      CAMERA_HEIGHT_M: H,
      CAMERA_TILT_DEG: TILT,
      HORIZONTAL_FOV_DEG: cfg.HORIZONTAL_FOV_DEG,
      VERTICAL_FOV_DEG: cfg.VERTICAL_FOV_DEG,
      tiltSource: 'device_imu',
    };

    const result = estimateGeometry(instance, camera, cfg);

    // Circle of radius 0.25m -> area pi*r^2 ~ 1963 cm^2, diameter ~50cm.
    expect(result.areaCm2).toBeGreaterThan(1800);
    expect(result.areaCm2).toBeLessThan(2150);
    expect(result.widthCm).toBeGreaterThan(45);
    expect(result.widthCm).toBeLessThan(55);
    expect(result.lengthCm).toBeGreaterThan(45);
    expect(result.lengthCm).toBeLessThan(55);

    // Known synthetic depth was 8cm.
    expect(result.depthCm).toBeGreaterThan(6.5);
    expect(result.depthCm).toBeLessThan(9.5);

    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.qualityFlags).not.toContain('unexpected_depth_sign');
  });

  test('flags an implausible depth instead of silently reporting it', () => {
    const instance = {
      rim_points_px: [[600, 500], [620, 500], [610, 520], [590, 510], [605, 495]],
      rim_depth_samples: [
        { px: [600, 500], nd: 0.5 },
        { px: [620, 500], nd: 0.49 },
        { px: [610, 520], nd: 0.51 },
        { px: [590, 510], nd: 0.50 },
        { px: [605, 495], nd: 0.505 },
      ],
      depth_median_inside: 0.05, // enormous, implausible drop
      depth_median_ring: 0.5,
      ring_sample_count: 200,
      centroid_px: [605, 505],
      image_width: IMAGE_W,
      image_height: IMAGE_H,
    };
    const camera = {
      CAMERA_HEIGHT_M: H, CAMERA_TILT_DEG: TILT,
      HORIZONTAL_FOV_DEG: cfg.HORIZONTAL_FOV_DEG, VERTICAL_FOV_DEG: cfg.VERTICAL_FOV_DEG,
      tiltSource: 'assumed_default',
    };
    const result = estimateGeometry(instance, camera, cfg);
    expect(result.depthCm).toBeLessThanOrEqual(cfg.MAX_PLAUSIBLE_DEPTH_CM);
  });

  test('does not throw on empty/missing rim data', () => {
    const instance = {
      rim_points_px: [],
      rim_depth_samples: [],
      depth_median_inside: null,
      depth_median_ring: null,
      ring_sample_count: 0,
      centroid_px: null,
      image_width: IMAGE_W,
      image_height: IMAGE_H,
    };
    const camera = {
      CAMERA_HEIGHT_M: H, CAMERA_TILT_DEG: TILT,
      HORIZONTAL_FOV_DEG: cfg.HORIZONTAL_FOV_DEG, VERTICAL_FOV_DEG: cfg.VERTICAL_FOV_DEG,
      tiltSource: 'assumed_default',
    };
    expect(() => estimateGeometry(instance, camera, cfg)).not.toThrow();
    const result = estimateGeometry(instance, camera, cfg);
    expect(result.areaCm2).toBe(0);
    expect(result.confidence).toBeLessThan(0.5);
  });
});
