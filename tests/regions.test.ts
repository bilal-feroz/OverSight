import { describe, expect, it } from "vitest";
import {
  binIndex,
  containsPoint,
  expandRect,
  hitMargin,
  relativeTo,
  requiredDwellMs,
  sweepCoverage,
  visibleFraction,
} from "@/lib/attention/regions";
import { DEFAULT_BASELINE } from "@/lib/attention/baseline";

const warning = { left: 100, top: 520, width: 640, height: 56 };
const title = { left: 100, top: 120, width: 520, height: 40 };

describe("critical region mapping", () => {
  it("expands regions by a margin derived from calibration error, clamped", () => {
    expect(hitMargin({ x: 100, y: 1000 })).toEqual({ x: 60, y: 72 });
    expect(hitMargin({ x: 5, y: 5 })).toEqual({ x: 16, y: 16 });
    expect(hitMargin(null)).toEqual({ x: 16, y: 16 });
  });

  it("counts gaze near the warning but not gaze on the title", () => {
    const m = hitMargin({ x: 120, y: 120 });
    const expanded = expandRect(warning, m.x, m.y);
    expect(containsPoint(expanded, 400, 548)).toBe(true); // on the sentence
    expect(containsPoint(expanded, 400, 505)).toBe(true); // just above, within noise margin
    expect(containsPoint(expanded, 360, 140)).toBe(false); // looking at the title
    expect(containsPoint(expandRect(title, m.x, m.y), 360, 140)).toBe(true);
  });

  it("computes visible fraction against the viewport", () => {
    const viewport = { left: 0, top: 0, width: 1440, height: 900 };
    expect(visibleFraction(warning, viewport)).toBe(1);
    expect(visibleFraction({ ...warning, top: 872 }, viewport)).toBeCloseTo(0.5, 5);
    expect(visibleFraction({ ...warning, top: 1200 }, viewport)).toBe(0);
  });

  it("maps viewport coordinates into card-relative coordinates", () => {
    expect(relativeTo(warning, { left: 80, top: 100, width: 800, height: 700 })).toEqual({
      left: 20,
      top: 420,
      width: 640,
      height: 56,
    });
  });

  it("measures how much of a sentence gaze swept across", () => {
    expect(binIndex(warning, 100, 5)).toBe(0);
    expect(binIndex(warning, 739, 5)).toBe(4);
    expect(binIndex(warning, 5000, 5)).toBe(4);
    expect(sweepCoverage([200, 0, 90, 0, 300], 60)).toBeCloseTo(0.6, 5);
  });

  it("derives required dwell from text length, personalised when a baseline exists", () => {
    expect(requiredDwellMs(15, null)).toBe(1350);
    expect(requiredDwellMs(2, null)).toBe(600);
    expect(requiredDwellMs(100, null)).toBe(2400);
    expect(requiredDwellMs(15, { ...DEFAULT_BASELINE, msPerWordDwell: 150, source: "personal" })).toBe(1350);
    expect(requiredDwellMs(15, { ...DEFAULT_BASELINE, msPerWordDwell: 60, source: "personal" })).toBe(750);
  });
});
