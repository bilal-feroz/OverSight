/**
 * Computer-vision tuning. See docs/TUNING.md.
 */
export const CV_CONFIG = {
  camera: {
    width: 1280,
    height: 720,
    frameRate: 30,
  },
  model: {
    /** Served from this origin (scripts/setup-assets.mjs). */
    wasmPath: "/mediapipe/wasm",
    modelPath: "/models/face_landmarker.task",
    /** Detect up to 2 faces so a second person can mark the signal unreliable. */
    numFaces: 2,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  },
  calibration: {
    /** Normalized viewport positions of the 9 calibration targets, in display order. */
    points: [
      [0.5, 0.5],
      [0.08, 0.1],
      [0.5, 0.1],
      [0.92, 0.1],
      [0.92, 0.5],
      [0.92, 0.9],
      [0.5, 0.9],
      [0.08, 0.9],
      [0.08, 0.5],
    ] as ReadonlyArray<readonly [number, number]>,
    /** Time for the eyes to travel to a new point before sampling starts. */
    settleMs: 650,
    /** Sampling window per point. */
    sampleMs: 1050,
    /** Minimum usable frames per point; otherwise the point is extended. */
    minFramesPerPoint: 8,
    maxExtensionMs: 2500,
    /** Ridge penalties tried; the one with the lowest grouped leave-one-point-out error wins. */
    lambdas: [0.0005, 0.002, 0.01, 0.05, 0.2, 1],
    /**
     * Standardization floors per input. A feature that barely moved during
     * calibration (e.g. head yaw with the head still) is scaled by at least this
     * much, so a later change in it cannot swing the prediction arbitrarily.
     */
    stdFloor: {
      irisH: 0.01,
      irisV: 0.005,
      openness: 0.01,
      bsH: 0.05,
      bsV: 0.05,
      yaw: 2,
      pitch: 2,
      roll: 2,
      faceX: 0.01,
      faceY: 0.01,
      faceScale: 0.005,
      irisHxScale: 0.001,
      irisVxScale: 0.0005,
    } as Record<string, number>,
    /**
     * Head sweep (phase A2): the eyes stay on each dot while the head turns and
     * nods, so head pose varies independently of where the person looks. That
     * makes head-pose compensation learnable instead of collinear with the target.
     */
    headSweep: {
      points: [
        [0.5, 0.5],
        [0.2, 0.5],
        [0.8, 0.5],
      ] as ReadonlyArray<readonly [number, number]>,
      settleMs: 400,
      sampleMs: 2100,
      /** Minimum head movement to aim for (5th to 95th percentile over the whole sweep). */
      minYawRangeDeg: 6,
      minPitchRangeDeg: 4,
      /** Extra time (total) granted with a gentle prompt when the range was not reached. */
      maxExtensionMs: 2000,
      /** Group id of the first sweep target (each target is its own leave-one-out group). */
      groupBase: 100,
    },
    /** Held-out validation (phase B): never used for fitting. Same settle/sample timing as the grid. */
    validation: {
      points: [
        [0.25, 0.3],
        [0.75, 0.3],
        [0.5, 0.55],
        [0.25, 0.72],
        [0.75, 0.72],
      ] as ReadonlyArray<readonly [number, number]>,
      minSamplesPerPoint: 3,
      minPoints: 3,
      groupBase: 300,
    },
    /** Optional adaptive round (phase C), at most once, when one region validates much worse. */
    adaptive: {
      /** Trigger: worst point error > max(ratio x median point error, fraction x viewport width). */
      worstToMedianRatio: 2,
      worstMinFractionOfWidth: 0.18,
      /** Two extra training points this far (normalized) from the worst point, toward the centre. */
      offset: 0.08,
      /** Re-validation uses a point between the worst area and the centre plus these, all new. */
      revalidationPoints: [
        [0.62, 0.42],
        [0.38, 0.62],
      ] as ReadonlyArray<readonly [number, number]>,
      groupBase: 200,
      revalidationGroupBase: 400,
    },
    /**
     * Quality from held-out per-axis RMSE as a fraction of the viewport width /
     * height. These are OverSight's operating thresholds for how much it relies
     * on gaze, not accuracy claims.
     */
    quality: {
      good: { x: 0.1, y: 0.13 },
      fair: { x: 0.17, y: 0.22 },
    },
    /** Legacy (v1) models were rated on leave-one-point-out mean error with these thresholds. */
    legacyQuality: {
      good: { x: 0.12, y: 0.16 },
      fair: { x: 0.2, y: 0.26 },
    },
    /** Calibrated posture: robust center and spread of these features (for posture distance). */
    posture: {
      keys: ["yaw", "pitch", "faceX", "faceY", "faceScale"] as const,
    },
    /** Viewport change (fraction) that makes a calibration stale. */
    staleViewportChange: 0.06,
    /** Moving the browser window further than this (CSS px) makes a calibration stale. */
    staleWindowMovePx: 40,
    /** Any devicePixelRatio change beyond this (zoom, moving to another display) makes it stale. */
    staleDprChange: 0.01,
    /** Staleness is also polled this often, since window moves fire no event. */
    staleCheckMs: 2000,
  },
  gaze: {
    /** One Euro filter (normalized viewport units, seconds). */
    minCutoff: 0.9,
    beta: 0.35,
    dCutoff: 1.0,
    /** Hold the last gaze estimate through blinks up to this long. */
    blinkHoldMs: 350,
    blinkThreshold: 0.5,
    /** Estimates outside [-margin, 1 + margin] are treated as off-screen. */
    offscreenMargin: 0.15,
  },
  /**
   * Implicit drift correction: clicking a control marked `data-gaze-anchor`
   * nudges the gaze estimate toward it (people look at what they click).
   */
  drift: {
    windowMs: 450,
    minSamples: 5,
    /** Ignore clicks where the estimate is further than this from the control (probably not looking). */
    maxDistancePx: 260,
    learningRate: 0.3,
    /** Caps as a fraction of the viewport (≈ ±110 px on common laptops). */
    maxX: 0.08,
    maxY: 0.12,
  },
  /**
   * Inputs of each regression axis. Every axis also tries "base + faceScale"
   * and "base + faceScale + iris x faceScale" and keeps the set with the lowest
   * grouped leave-one-point-out error.
   */
  features: {
    x: ["irisH", "bsH", "yaw", "faceX"],
    y: ["irisV", "bsV", "pitch", "faceY", "openness"],
    scale: ["faceScale"],
    interactions: ["irisHxScale", "irisVxScale"],
  },
} as const;
