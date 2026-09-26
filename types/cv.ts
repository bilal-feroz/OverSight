/**
 * Computer-vision types. Everything here is a *derived* signal computed
 * on-device from face landmarks. No image data ever leaves the CV module.
 */

/** Per-frame eye and head features used for gaze regression. */
export interface EyeFeatures {
  /** Iris position along the eye axis (0 = image-left corner, 1 = image-right corner), both eyes averaged. */
  irisH: number;
  /** Iris offset perpendicular to the eye axis, normalized by eye width (+ = down). */
  irisV: number;
  /** Eyelid aperture / eye width. Correlates with vertical gaze. */
  openness: number;
  /** Horizontal eye-direction coefficient from MediaPipe eyeLook* blendshapes. */
  bsH: number;
  /** Vertical eye-direction coefficient from MediaPipe eyeLook* blendshapes. */
  bsV: number;
  /** Head orientation in degrees. */
  yaw: number;
  pitch: number;
  roll: number;
  /** Face centre in the camera image (0..1). */
  faceX: number;
  faceY: number;
  /** Inter-ocular distance in image-width units (proxy for distance to screen). */
  faceScale: number;
  /** Eyes closed on this frame; iris landmarks are unreliable. */
  blink: boolean;
}

export type FeatureKey =
  | "irisH"
  | "irisV"
  | "openness"
  | "bsH"
  | "bsV"
  | "yaw"
  | "pitch"
  | "faceX"
  | "faceY"
  | "faceScale";

/** Normalized viewport coordinates: (0,0) top-left, (1,1) bottom-right. */
export interface GazePoint {
  x: number;
  y: number;
}

export interface GazeFrame {
  /** performance.now() timestamp. */
  t: number;
  source: "camera" | "simulated";
  faceCount: number;
  features: EyeFeatures | null;
  /** Calibrated + smoothed gaze estimate, or null when unavailable. */
  gaze: GazePoint | null;
  /** Calibrated, unsmoothed gaze estimate (diagnostics only). */
  gazeRaw: GazePoint | null;
  /** True when the gaze value is being held through a blink. */
  held: boolean;
  inferenceMs: number;
}

export type CalibrationQuality = "good" | "fair" | "poor";

export interface AxisModel {
  features: FeatureKey[];
  mean: number[];
  std: number[];
  weights: number[];
  intercept: number;
  lambda: number;
}

export interface CalibrationModel {
  version: 1;
  x: AxisModel;
  y: AxisModel;
  /** Leave-one-point-out mean absolute error as a fraction of viewport width / height. */
  errorNorm: { x: number; y: number };
  /** Same error in CSS pixels for the calibrated viewport. */
  errorPx: { x: number; y: number };
  quality: CalibrationQuality;
  viewport: { width: number; height: number };
  pointCount: number;
  sampleCount: number;
  createdAt: number;
}

export type CameraStatus =
  | "idle"
  | "requesting"
  | "loading-model"
  | "active"
  | "denied"
  | "unavailable"
  | "error";

export type GazeSourceKind = "camera" | "simulated" | "none";
