import { create } from "zustand";
import type { CalibrationQuality, CameraStatus, GazePoint, GazeSourceKind } from "@/types/cv";

export interface CalibrationSummary {
  quality: CalibrationQuality;
  errorPx: { x: number; y: number };
  errorNorm: { x: number; y: number };
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
}));
