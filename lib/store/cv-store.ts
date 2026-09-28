import { create } from "zustand";
import type { CalibrationQuality, CameraStatus, GazePoint, GazeSourceKind } from "@/types/cv";

export interface CalibrationSummary {
  version: number;
  quality: CalibrationQuality;
  /** 1-sigma gaze error per axis, CSS px: held-out RMSE (v2) or leave-one-point-out error (legacy v1). */
  sigmaPx: { x: number; y: number };
  /** Accuracy on points never used for fitting; null for legacy or unmeasured calibrations. */
  validation: { points: number; medianPx: number; p90Px: number; worstPointPx: number; precisionPx: number } | null;
  /** Head movement achieved during the head sweep, degrees. */
  headSweep: { yawRange: number; pitchRange: number } | null;
  adaptive: boolean;
  viewport: { width: number; height: number };
  pointCount: number;
  sampleCount: number;
  createdAt: number;
}

/** UI-facing computer-vision status. Updated a few times per second, never per frame. */
export interface CvState {
  cameraStatus: CameraStatus;
  cameraError: string | null;
  delegate: "GPU" | "CPU" | null;
  source: GazeSourceKind;
  simulated: boolean;
  faceCount: number;
  fps: number;
  inferenceMs: number;
  gaze: GazePoint | null;
  gazeRaw: GazePoint | null;
  head: { yaw: number; pitch: number; roll: number } | null;
  /** Inter-ocular distance in image-width units (distance-to-screen proxy). */
  faceScale: number | null;
  iris: { h: number; v: number; openness: number } | null;
  blink: boolean;
  calibration: CalibrationSummary | null;
  calibrationStale: boolean;
  /** Current implicit drift correction in CSS px. */
  driftPx: { x: number; y: number };
  /** Drift monitor: EWMA of anchor residuals (calibration-sigma units) and whether drift is suspected. */
  drift: { ewma: number; anchors: number; suspected: boolean };
  /** Frames with eye features per second (the rate evidence actually arrives at). */
  effectiveFps: number;
}

export const useCvStore = create<CvState>(() => ({
  cameraStatus: "idle",
  cameraError: null,
  delegate: null,
  source: "none",
  simulated: false,
  faceCount: 0,
  fps: 0,
  inferenceMs: 0,
  gaze: null,
  gazeRaw: null,
  head: null,
  faceScale: null,
  iris: null,
  blink: false,
  calibration: null,
  calibrationStale: false,
  driftPx: { x: 0, y: 0 },
  drift: { ewma: 0, anchors: 0, suspected: false },
  effectiveFps: 0,
}));
