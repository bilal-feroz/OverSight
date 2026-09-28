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

/**
 * Inputs a calibration axis can use: the raw features plus iris x face-scale
 * interactions (iris displacement for a given screen offset shrinks with
 * distance to the screen).
 */
export type ModelFeatureKey = FeatureKey | "irisHxScale" | "irisVxScale";

/** Candidate input sets per axis, chosen by grouped leave-one-point-out error. */
export type FeatureSetName = "base" | "scale" | "scaleInteraction";

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
  features: ModelFeatureKey[];
  mean: number[];
  std: number[];
  weights: number[];
  intercept: number;
  lambda: number;
}

/** Legacy calibration (quality from leave-one-point-out error on the training points). */
export interface CalibrationModelV1 {
  version: 1;
  x: AxisModel;
  y: AxisModel;
  /** Leave-one-point-out mean absolute error as a fraction of viewport width / height. */
  errorNorm: { x: number; y: number };
  /** Same error in CSS pixels for the calibrated viewport. */
  errorPx: { x: number; y: number };
  quality: CalibrationQuality;
  viewport: { width: number; height: number };
  /** Window position on the screen at calibration time (window.screenX / screenY). */
  screen?: { x: number; y: number };
  /** devicePixelRatio at calibration time (changes with browser zoom and display). */
  dpr?: number;
  pointCount: number;
  sampleCount: number;
  createdAt: number;
}

/** Error of one held-out validation point, CSS px. */
export interface ValidationPoint {
  /** Normalized viewport position of the dot. */
  target: { x: number; y: number };
  samples: number;
  /** Median Euclidean error of this point's predictions (accuracy). */
  medianPx: number;
  /** RMS distance of this point's predictions from their own median (precision / jitter). */
  precisionPx: number;
  /** Median signed error, prediction minus target. */
  biasPx: { x: number; y: number };
}

/** Accuracy measured on points that were never used for fitting. */
export interface CalibrationValidation {
  points: number;
  samples: number;
  /** Pooled median and 90th percentile of per-sample Euclidean error. */
  medianPx: number;
  p90Px: number;
  /** Largest per-point median error. */
  worstPointPx: number;
  /** Median per-point precision. */
  precisionPx: number;
  /** Per-axis RMSE: the 1-sigma gaze error used for uncertainty. */
  sigmaPx: { x: number; y: number };
  perPoint: ValidationPoint[];
}

/** The head posture the calibration was trained on: robust center and spread per feature. */
export interface PostureModel {
  keys: FeatureKey[];
  /** Median per key. */
  center: number[];
  /** 1.4826 x MAD per key, floored. */
  scale: number[];
}

export interface CalibrationModelV2 {
  version: 2;
  x: AxisModel;
  y: AxisModel;
  /** Input set chosen per axis by grouped leave-one-point-out error. */
  featureSets: { x: FeatureSetName; y: FeatureSetName };
  /** Grouped leave-one-point-out mean absolute error (fraction of the viewport); training diagnostic only. */
  loo: { x: number; y: number };
  /** Error on held-out points; null when too few could be measured. */
  validation: CalibrationValidation | null;
  quality: CalibrationQuality;
  posture: PostureModel;
  /** Head movement achieved during the head-sweep phase, degrees (5th to 95th percentile). */
  headSweep: { yawRange: number; pitchRange: number } | null;
  /** An adaptive round added training points where the first validation was worst. */
  adaptive: boolean;
  viewport: { width: number; height: number };
  screen?: { x: number; y: number };
  dpr?: number;
  pointCount: number;
  sampleCount: number;
  createdAt: number;
}

export type CalibrationModel = CalibrationModelV1 | CalibrationModelV2;

/** Where the viewport sits on the physical display, for calibration staleness. */
export interface DisplayState {
  viewport: { width: number; height: number };
  screen?: { x: number; y: number };
  dpr?: number;
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
