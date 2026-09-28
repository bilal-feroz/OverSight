/**
 * Performance policies: the inference stride (lib/cv/perf.ts), the
 * incremental heatmap plan, and the tracker's throttled geometry reads.
 */
import { describe, expect, it } from "vitest";
import { ATTENTION_CONFIG } from "@/lib/attention/config";
import { CV_CONFIG } from "@/lib/cv/config";
import { heatmapPlan, nextStride, type HeatmapState } from "@/lib/cv/perf";
import { openReview } from "./sim/gaze-sim";

const P = CV_CONFIG.performance;

describe("inference stride", () => {
  it("processes every frame while inference is fast", () => {
    expect(nextStride(1, 10)).toBe(1);
    expect(nextStride(1, P.stride2AboveMs)).toBe(1);
  });

  it("processes every 2nd frame above 28 ms and every 3rd above 55 ms", () => {
    expect(nextStride(1, P.stride2AboveMs + 1)).toBe(2);
    expect(nextStride(1, P.stride3AboveMs + 1)).toBe(3);
    expect(nextStride(2, P.stride3AboveMs + 1)).toBe(3);
  });

  it("steps back down one level at a time, and only below the hysteresis band", () => {
    expect(nextStride(2, P.stride2AboveMs - 1)).toBe(2);
    expect(nextStride(2, P.stride2AboveMs * P.strideHysteresis - 0.1)).toBe(1);
    expect(nextStride(3, P.stride3AboveMs - 1)).toBe(3);
    expect(nextStride(3, P.stride3AboveMs * P.strideHysteresis - 0.1)).toBe(2);
    // Even if inference is suddenly fast: one step per update.
    expect(nextStride(3, 5)).toBe(2);
  });

  it("does not flap while the inference time hovers around a threshold", () => {
    let stride = 1;
    let changes = 0;
    for (let i = 0; i < 400; i++) {
      const next = nextStride(stride, P.stride2AboveMs + Math.sin(i / 3) * 2);
      if (next !== stride) changes++;
      stride = next;
    }
    expect(changes).toBe(1);
    expect(stride).toBe(2);
  });
});

describe("incremental heatmap", () => {
  const base = { key: "a", width: 800, height: 600 };

  it("draws everything the first time, then only the new samples", () => {
    expect(heatmapPlan(null, { ...base, count: 12 })).toEqual({ reset: true, from: 0, to: 12 });
    const prev = { ...base, drawn: 12 };
    expect(heatmapPlan(prev, { ...base, count: 15 })).toEqual({ reset: false, from: 12, to: 15 });
    expect(heatmapPlan(prev, { ...base, count: 12 })).toEqual({ reset: false, from: 12, to: 12 });
  });

  it("redraws fully on resize, for a new review, or when the samples were replaced", () => {
    const prev = { ...base, drawn: 12 };
    expect(heatmapPlan(prev, { ...base, width: 801, count: 13 }).reset).toBe(true);
    expect(heatmapPlan(prev, { ...base, height: 500, count: 13 }).reset).toBe(true);
    expect(heatmapPlan(prev, { ...base, key: "b", count: 13 })).toEqual({ reset: true, from: 0, to: 13 });
    expect(heatmapPlan(prev, { ...base, count: 3 })).toEqual({ reset: true, from: 0, to: 3 });
  });

  it("stamps every sample exactly once over a review without a resize", () => {
    let state: HeatmapState | null = null;
    const stamps = new Array<number>(400).fill(0);
    let count = 0;
    for (let tick = 0; tick < 140; tick++) {
      count = Math.min(stamps.length, count + (tick % 7));
      const plan = heatmapPlan(state, { ...base, count });
      for (let i = plan.from; i < plan.to; i++) stamps[i]++;
      state = { ...base, drawn: plan.to };
    }
    expect(count).toBe(stamps.length);
    expect(stamps.every((n) => n === 1)).toBe(true);
  });
});

describe("tracker geometry reads", () => {
  function counted() {
    const review = openReview("db-config");
    let reads = 0;
    const regions = review.geo.regions.bind(review.geo);
    review.geo.regions = (scope: string) => {
      reads++;
      return regions(scope);
    };
    return { review, reads: () => reads };
  }

  it("re-reads region geometry at most every geometryRefreshMs, not every animation frame", () => {
    const { review, reads } = counted();
    for (let t = 0; t <= 1000; t += 1000 / 60) review.session.tick(t);
    const expected = 1000 / ATTENTION_CONFIG.targets.geometryRefreshMs;
    expect(reads()).toBeGreaterThanOrEqual(expected - 1);
    expect(reads()).toBeLessThanOrEqual(expected + 1);
  });

  it("re-reads at once after a scroll or resize invalidates it", () => {
    const { review, reads } = counted();
    review.session.tick(0);
    const before = reads();
    review.session.tick(16);
    expect(reads()).toBe(before);
    review.session.invalidateGeometry();
    review.session.tick(32);
    expect(reads()).toBe(before + 1);
  });
});
