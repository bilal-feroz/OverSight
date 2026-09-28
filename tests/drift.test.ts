import { describe, expect, it } from "vitest";
import { fitCalibration, type CalibrationSample } from "@/lib/cv/calibration";
import { CV_CONFIG } from "@/lib/cv/config";
import {
  INITIAL_DRIFT,
  anchorWeight,
  driftInflation,
  driftResidual,
  evaluateRecheck,
  updateBias,
  updateDrift,
  type DriftState,
} from "@/lib/cv/drift";
import { median } from "@/lib/math/stats";
import { gaussian, rng } from "./sim/gaze-sim";
import { REST, SCREEN, eyeFeatures, gridSamples, sweepSamples, validationSamples } from "./sim/eye-sim";

/** Calibration error of a good synthetic calibration (tests/calibration-v2 runs give 33 to 45 px). */
const SIGMA = { x: 40, y: 40 };
const anchor = { x: 900, y: 110 };

/**
 * SYNTHETIC click, modelled like the hub measures it: the median of the ~13
 * smoothed estimates in the 450 ms before the click. Each estimate carries the
 * calibration's local error at that spot (0.5 sigma) plus frame jitter (0.8
 * sigma); `offset` is drift on top.
 */
function click(rand: () => number, offset = { x: 0, y: 0 }) {
  const local = { x: gaussian(rand) * 0.5 * SIGMA.x, y: gaussian(rand) * 0.5 * SIGMA.y };
  const frames = Array.from({ length: 13 }, () => ({
    x: anchor.x + offset.x + local.x + gaussian(rand) * 0.8 * SIGMA.x,
    y: anchor.y + offset.y + local.y + gaussian(rand) * 0.8 * SIGMA.y,
  }));
  const est = { x: median(frames.map((f) => f.x)), y: median(frames.map((f) => f.y)) };
  return driftResidual(est, anchor, SIGMA);
}

describe("drift monitor", () => {
  it("does not raise the alarm during normal use", () => {
    const rand = rng(31);
    let s: DriftState = INITIAL_DRIFT;
    for (let i = 0; i < 300; i++) {
      s = updateDrift(s, click(rand));
      expect(s.suspected).toBe(false);
    }
    expect(driftInflation(s)).toBe(1);
  });

  it("detects a constant 120 px offset introduced mid-session within 3 anchor clicks", () => {
    const rand = rng(32);
    let s: DriftState = INITIAL_DRIFT;
    for (let i = 0; i < 12; i++) s = updateDrift(s, click(rand));
    expect(s.suspected).toBe(false);
    let clicks = 0;
    while (!s.suspected && clicks < 10) {
      s = updateDrift(s, click(rand, { x: 120, y: 0 }));
      clicks++;
    }
    expect(s.suspected).toBe(true);
    expect(clicks).toBeLessThanOrEqual(3);
    expect(driftInflation(s)).toBe(CV_CONFIG.drift.sigmaInflation);
  });

  it("one click made while looking elsewhere does not raise it", () => {
    let s: DriftState = { ...INITIAL_DRIFT, anchors: 10 };
    s = updateDrift(s, 20);
    expect(s.suspected).toBe(false);
  });

  it("weights weak anchors: queue clicks move the average less than decision buttons", () => {
    const strong = updateDrift({ ...INITIAL_DRIFT, anchors: 5 }, 3.5, anchorWeight(null, null));
    const weak = updateDrift({ ...INITIAL_DRIFT, anchors: 5 }, 3.5, anchorWeight("queue", null));
    expect(weak.ewma - INITIAL_DRIFT.ewma).toBeCloseTo((strong.ewma - INITIAL_DRIFT.ewma) * CV_CONFIG.drift.anchorWeights.queue, 6);
    expect(anchorWeight("manual-ack", null)).toBe(0.5);
    expect(anchorWeight("review-focus", null)).toBe(0.5);
    expect(anchorWeight("something-new", null)).toBe(1);
  });

  it("never learns from the re-review target, the thing being measured", () => {
    expect(anchorWeight(null, "review-target")).toBe(0);
    expect(anchorWeight("decision", "review-target")).toBe(0);
    expect(updateDrift(INITIAL_DRIFT, 3, 0)).toBe(INITIAL_DRIFT);
  });

  it("keeps the translation correction within its caps", () => {
    let bias = { x: 0, y: 0 };
    for (let i = 0; i < 50; i++) bias = updateBias(bias, { x: 0.95, y: 0.95 }, { x: 0.05, y: 0.05 });
    expect(bias.x).toBeCloseTo(CV_CONFIG.drift.maxX, 10);
    expect(bias.y).toBeCloseTo(CV_CONFIG.drift.maxY, 10);
    for (let i = 0; i < 50; i++) bias = updateBias(bias, { x: 0, y: 0 }, { x: 1, y: 1 });
    expect(bias.x).toBeCloseTo(-CV_CONFIG.drift.maxX, 10);
    expect(bias.y).toBeCloseTo(-CV_CONFIG.drift.maxY, 10);
    // A weak anchor learns proportionally slower.
    const full = updateBias({ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0.45, y: 0.5 }, 1);
    const weak = updateBias({ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0.45, y: 0.5 }, 0.3);
    expect(weak.x).toBeCloseTo(full.x * 0.3, 10);
  });
});

describe("quick recheck (synthetic)", () => {
  const model = fitCalibration({
    train: [...gridSamples(61), ...sweepSamples(161)],
    validation: validationSamples(71),
    viewport: SCREEN.viewport,
  }).model!;

  /** The eyes look at `look`, while the dot the recheck labels is at `target`. */
  function recheckSamples(shift: { x: number; y: number }, seed: number, scramble = false): CalibrationSample[] {
    const rand = rng(seed);
    const cfg = CV_CONFIG.drift.recheck;
    return cfg.points.flatMap(([x, y], k) =>
      Array.from({ length: 30 }, () => {
        const look = scramble ? { x: rand(), y: rand() } : { x: x - shift.x, y: y - shift.y };
        return { features: eyeFeatures(look, REST, rand), target: { x, y }, pointIndex: cfg.groupBase + k };
      }),
    );
  }

  it("corrects a constant shift and accepts it", () => {
    const shift = { x: 0.06, y: 0.05 };
    const result = evaluateRecheck(model, recheckSamples(shift, 3), SCREEN.viewport)!;
    expect(result.points).toBe(3);
    expect(result.offset.x).toBeCloseTo(shift.x, 1);
    expect(result.offset.y).toBeCloseTo(shift.y, 1);
    expect(result.correctedMedianPx).toBeLessThan(result.rawMedianPx);
    expect(result.accept).toBe(true);
  });

  it("recommends recalibration when no single shift explains the error", () => {
    const result = evaluateRecheck(model, recheckSamples({ x: 0, y: 0 }, 4, true), SCREEN.viewport)!;
    expect(result.accept).toBe(false);
  });

  it("needs usable frames on at least two points", () => {
    const few = recheckSamples({ x: 0, y: 0 }, 5).filter((s) => s.pointIndex === CV_CONFIG.drift.recheck.groupBase);
    expect(evaluateRecheck(model, few, SCREEN.viewport)).toBeNull();
  });
});
