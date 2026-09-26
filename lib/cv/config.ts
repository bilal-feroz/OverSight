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
    /** Ridge penalties tried; the one with the lowest leave-one-point-out error wins. */
    lambdas: [0.0005, 0.002, 0.01, 0.05, 0.2, 1],
    /** Quality thresholds on leave-one-point-out mean error (fraction of viewport). */
    quality: {
      good: { x: 0.12, y: 0.16 },
      fair: { x: 0.2, y: 0.26 },
    },
    /** Viewport change (fraction) that makes a calibration stale. */
    staleViewportChange: 0.06,
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
  /** Features used by each regression axis. */
  features: {
    x: ["irisH", "bsH", "yaw", "faceX"],
    y: ["irisV", "bsV", "pitch", "faceY", "openness"],
  },
} as const;
