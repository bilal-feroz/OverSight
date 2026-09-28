/**
 * Per-frame gaze uncertainty.
 *
 * The calibration's held-out error is the base sigma. It grows when the head
 * leaves the posture the calibration was trained on (a robust z-distance over
 * yaw, pitch, face position and face scale), while an estimate is held through
 * a blink, and when drift is suspected. Downstream, region evidence is
 * weighted by this sigma instead of a fixed pixel margin.
 */
import type { EyeFeatures, GazeEstimate, PostureModel } from "@/types/cv";
import { clamp01 } from "@/lib/utils";
import { CV_CONFIG } from "./config";

/** RMS of the robust z-scores of the posture features; 0 when there is no posture model. */
export function postureZ(features: EyeFeatures | null, posture: PostureModel | null | undefined): number {
  if (!features || !posture || !posture.keys.length) return 0;
  let sum = 0;
  posture.keys.forEach((key, i) => {
    const z = (features[key] - posture.center[i]) / Math.max(1e-9, posture.scale[i]);
    sum += z * z;
  });
  return Math.sqrt(sum / posture.keys.length);
}

/** sigma multiplier for a posture distance: 1 inside the calibrated range, growing linearly beyond it. */
export function postureInflation(z: number): number {
  const u = CV_CONFIG.uncertainty;
  return 1 + u.postureAlpha * Math.max(0, z - u.postureZ0);
}

export interface EstimateInput {
  /** Smoothed gaze in normalized viewport coordinates. */
  gaze: { x: number; y: number };
  viewport: { width: number; height: number };
  /** Calibration sigma per axis, CSS px. */
  base: { x: number; y: number };
  faceCount: number;
  postureZ: number;
  held: boolean;
  /** Extra multiplier while drift is suspected (1 otherwise). */
  driftInflation?: number;
}

export function gazeEstimate(input: EstimateInput): GazeEstimate {
  const inflate =
    postureInflation(input.postureZ) *
    (input.held ? CV_CONFIG.uncertainty.heldInflation : 1) *
    Math.max(1, input.driftInflation ?? 1);
  const sigmaX = input.base.x * inflate;
  const sigmaY = input.base.y * inflate;
  const confidence =
    input.faceCount === 1 ? clamp01((input.base.x + input.base.y) / Math.max(1e-9, sigmaX + sigmaY)) : 0;
  return {
    x: input.gaze.x * input.viewport.width,
    y: input.gaze.y * input.viewport.height,
    sigmaX,
    sigmaY,
    confidence,
    postureZ: input.postureZ,
    held: input.held,
  };
}
