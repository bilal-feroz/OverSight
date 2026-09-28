/**
 * Performance policies, as pure functions so they can be tested.
 *
 * Inference stride: when face-landmark inference gets slow (CPU delegate,
 * older laptops) OverSight processes every 2nd or 3rd camera frame instead of
 * falling behind. 20-30 feature frames per second is plenty; fewer lowers gaze
 * trust instead of silently skewing dwell (lib/attention/trust.ts).
 *
 * Heatmap: the overlay accumulates new gaze samples into an offscreen canvas
 * and redraws everything only when the card size or the review changes.
 */
import { CV_CONFIG } from "./config";

/**
 * Next inference stride (1 = every frame) from the inference-time EMA, with
 * hysteresis so the stride does not flap around a threshold.
 */
export function nextStride(current: number, inferenceEmaMs: number): number {
  const cfg = CV_CONFIG.performance;
  const target = inferenceEmaMs > cfg.stride3AboveMs ? 3 : inferenceEmaMs > cfg.stride2AboveMs ? 2 : 1;
  if (target > current) return target;
  // Step down only once inference is comfortably below the threshold that raised the stride.
  const downAt = (current === 3 ? cfg.stride3AboveMs : cfg.stride2AboveMs) * cfg.strideHysteresis;
  return inferenceEmaMs < downAt ? Math.max(target, current - 1) : current;
}

export interface HeatmapState {
  /** Review the accumulated samples belong to. */
  key: string;
  width: number;
  height: number;
  /** Samples already drawn into the accumulation canvas. */
  drawn: number;
}

export interface HeatmapPlan {
  /** Clear the accumulation canvas and redraw from the first sample. */
  reset: boolean;
  from: number;
  to: number;
}

/** What to draw this tick: only new samples, unless the canvas or the review changed. */
export function heatmapPlan(prev: HeatmapState | null, next: { key: string; width: number; height: number; count: number }): HeatmapPlan {
  const reset =
    !prev || prev.key !== next.key || prev.width !== next.width || prev.height !== next.height || next.count < prev.drawn;
  return { reset, from: reset ? 0 : prev.drawn, to: next.count };
}
