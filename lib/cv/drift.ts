/**
 * Drift monitoring and quick recheck.
 *
 * People look at what they click. Each click on a control marked
 * `data-gaze-anchor` gives a residual: how far the gaze estimate just before
 * the click was from the control, in units of the calibration's own error.
 * An exponentially weighted average of those residuals that stays high means
 * the mapping has drifted (the person moved, the camera was nudged). OverSight
 * then widens the gaze uncertainty and offers a 5 s recheck instead of
 * silently warping the estimate. A small, capped translation correction is
 * still learned from clicks, as before.
 */
import { median } from "@/lib/math/stats";
import { clamp } from "@/lib/utils";
import type { CalibrationModel } from "@/types/cv";
import { predictGaze, type CalibrationSample } from "./calibration";
import { CV_CONFIG } from "./config";

export interface DriftState {
  /** EWMA of anchor residuals in sigma units. */
  ewma: number;
  /** Weighted number of anchor observations since calibration or the last recheck. */
  anchors: number;
  suspected: boolean;
}

export const INITIAL_DRIFT: DriftState = {
  ewma: CV_CONFIG.drift.ewmaInitial,
  anchors: 0,
  suspected: false,
};

type Pt = { x: number; y: number };

/** Distance from the gaze estimate to the anchor centre in sigma units (CSS px in, sigma per axis). */
export function driftResidual(estimate: Pt, anchor: Pt, sigma: Pt): number {
  return Math.hypot((estimate.x - anchor.x) / Math.max(1, sigma.x), (estimate.y - anchor.y) / Math.max(1, sigma.y));
}

/**
 * One anchor observation. Weight scales the EWMA step (a queue click says less
 * about where the eyes were than a click on Approve), and residuals are
 * clamped so one click made while looking elsewhere cannot raise the alarm.
 */
export function updateDrift(state: DriftState, residual: number, weight = 1): DriftState {
  const cfg = CV_CONFIG.drift;
  const w = clamp(weight, 0, 1);
  if (w === 0) return state;
  const r = Math.min(residual, cfg.maxResidual);
  const ewma = state.ewma + cfg.ewmaAlpha * w * (r - state.ewma);
  const anchors = state.anchors + w;
  return { ewma, anchors, suspected: anchors >= cfg.minAnchors && ewma > cfg.residualThreshold };
}

/** sigma multiplier while drift is suspected. */
export function driftInflation(state: DriftState): number {
  return state.suspected ? CV_CONFIG.drift.sigmaInflation : 1;
}

/** Bounded translation step toward the clicked control (normalized viewport units). */
export function updateBias(bias: Pt, anchor: Pt, estimate: Pt, weight = 1): Pt {
  const cfg = CV_CONFIG.drift;
  const rate = cfg.learningRate * clamp(weight, 0, 1);
  return {
    x: clamp(bias.x + rate * (anchor.x - estimate.x), -cfg.maxX, cfg.maxX),
    y: clamp(bias.y + rate * (anchor.y - estimate.y), -cfg.maxY, cfg.maxY),
  };
}

/**
 * How much an anchor click says about gaze. Unknown kinds count as decision
 * buttons. Anything inside the isolated re-review consequence counts for
 * nothing: that is the thing being measured, not a reference for it.
 */
export function anchorWeight(kind: string | null, regionRole: string | null): number {
  if (regionRole === "review-target") return 0;
  const weights = CV_CONFIG.drift.anchorWeights as Record<string, number>;
  return weights[kind || "decision"] ?? weights.decision;
}

export interface RecheckResult {
  /** Points with enough usable samples. */
  points: number;
  /** Translation that best explains the error (normalized, capped like the click correction). */
  offset: Pt;
  /** Median error before and after applying the offset, CSS px. */
  rawMedianPx: number;
  correctedMedianPx: number;
  /** The calibration's own median error the recheck is compared against. */
  referencePx: number;
  /** The offset explains the drift: apply it. Otherwise recalibrate. */
  accept: boolean;
}

/** Median error the calibration itself achieved (held-out for v2, leave-one-out for v1). */
export function referenceErrorPx(model: CalibrationModel): number {
  if (model.version === 2 && model.validation) return model.validation.medianPx;
  if (model.version === 2) return Math.hypot(model.loo.x * model.viewport.width, model.loo.y * model.viewport.height);
  return Math.hypot(model.errorPx.x, model.errorPx.y);
}

/**
 * Quick recheck: a few dots, predicted with the current model. The median
 * per-point offset is the drift; it is accepted when, once removed, the
 * remaining error is within `acceptRatio` x the calibration's own median.
 */
export function evaluateRecheck(
  model: CalibrationModel,
  samples: readonly CalibrationSample[],
  viewport: { width: number; height: number },
): RecheckResult | null {
  const cfg = CV_CONFIG.drift.recheck;
  const groups = new Map<number, CalibrationSample[]>();
  for (const s of samples) {
    if (s.features.blink) continue;
    const g = groups.get(s.pointIndex) ?? [];
    g.push(s);
    groups.set(s.pointIndex, g);
  }
  const perPoint = [...groups.values()]
    .filter((g) => g.length >= cfg.minSamplesPerPoint)
    .map((g) => {
      const preds = g.map((s) => predictGaze(model, s.features));
      return { target: g[0].target, preds, median: { x: median(preds.map((p) => p.x)), y: median(preds.map((p) => p.y)) } };
    });
  if (perPoint.length < cfg.minPoints) return null;
  const drift = CV_CONFIG.drift;
  const offset = {
    x: clamp(median(perPoint.map((p) => p.target.x - p.median.x)), -drift.maxX, drift.maxX),
    y: clamp(median(perPoint.map((p) => p.target.y - p.median.y)), -drift.maxY, drift.maxY),
  };
  const errors = (shift: Pt) =>
    perPoint.flatMap((p) =>
      p.preds.map((q) =>
        Math.hypot((q.x + shift.x - p.target.x) * viewport.width, (q.y + shift.y - p.target.y) * viewport.height),
      ),
    );
  const rawMedianPx = median(errors({ x: 0, y: 0 }));
  const correctedMedianPx = median(errors(offset));
  const referencePx = referenceErrorPx(model);
  return {
    points: perPoint.length,
    offset,
    rawMedianPx,
    correctedMedianPx,
    referencePx,
    accept: correctedMedianPx <= cfg.acceptRatio * referencePx,
  };
}
