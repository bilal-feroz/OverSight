/**
 * Geometry for semantic regions. Pure functions over rectangles so the
 * mapping from gaze to DOM regions can be unit-tested without a browser.
 */
import type { Baseline, EvidenceStrength, RectLike } from "@/types/attention";
import { clamp } from "@/lib/utils";
import { ATTENTION_CONFIG } from "./config";

export function rectFromDOM(r: DOMRect | RectLike): RectLike {
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

export function right(r: RectLike): number {
  return r.left + r.width;
}

export function bottom(r: RectLike): number {
  return r.top + r.height;
}

export function expandRect(r: RectLike, mx: number, my: number): RectLike {
  return { left: r.left - mx, top: r.top - my, width: r.width + 2 * mx, height: r.height + 2 * my };
}

export function containsPoint(r: RectLike, x: number, y: number): boolean {
  return x >= r.left && x <= right(r) && y >= r.top && y <= bottom(r);
}

export function intersect(a: RectLike, b: RectLike): RectLike | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const r = Math.min(right(a), right(b));
  const btm = Math.min(bottom(a), bottom(b));
  if (r <= left || btm <= top) return null;
  return { left, top, width: r - left, height: btm - top };
}

/** Fraction of `rect` area inside `viewport` (0-1). */
export function visibleFraction(rect: RectLike, viewport: RectLike): number {
  const area = rect.width * rect.height;
  if (area <= 0) return 0;
  const inter = intersect(rect, viewport);
  return inter ? (inter.width * inter.height) / area : 0;
}

/** Converts a viewport rect into coordinates relative to `origin` (e.g. the approval card). */
export function relativeTo(rect: RectLike, origin: RectLike): RectLike {
  return { left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height };
}

/** Elliptical distance, in sigma units per axis, from a point to a rectangle (0 inside it). */
export function sigmaDistance(r: RectLike, x: number, y: number, sigma: { x: number; y: number }): number {
  const dx = Math.max(r.left - x, 0, x - right(r));
  const dy = Math.max(r.top - y, 0, y - bottom(r));
  return Math.hypot(dx / Math.max(1, sigma.x), dy / Math.max(1, sigma.y));
}

/**
 * Soft hit: how compatible a gaze estimate with per-axis error `sigma` is with
 * looking at the rectangle, exp(-d^2 / 2) for the elliptical distance d. 1 inside
 * the rectangle, 0.61 at one sigma outside, 0.14 at two.
 */
export function softWeight(r: RectLike, x: number, y: number, sigma: { x: number; y: number }): number {
  const d = sigmaDistance(r, x, y, sigma);
  return Math.exp(-0.5 * d * d);
}

/**
 * Evidence strength for one target. "Not observed" is a statement about the
 * evidence, never about the reviewer ("skipped").
 */
export function evidenceStrength(t: {
  visible: boolean;
  conclusive: boolean;
  coverage: number;
  fixations: number;
}): EvidenceStrength {
  const cfg = ATTENTION_CONFIG.targets;
  if (!t.visible) return "not-visible";
  if (!t.conclusive) return "inconclusive";
  if (t.coverage >= cfg.strongCoverage && t.fixations >= 1) return "strong";
  if (t.coverage >= cfg.partialCoverage) return "partial";
  return "not-observed";
}

/**
 * Hit-test margin from the calibration error, used for UI outlines only.
 * Dwell is weighted by the measured error instead (softWeight).
 */
export function hitMargin(sigmaPx: { x: number; y: number } | null): { x: number; y: number } {
  const t = ATTENTION_CONFIG.targets;
  if (!sigmaPx) return { x: t.marginMinPx, y: t.marginMinPx };
  return {
    x: clamp(sigmaPx.x * t.marginSigmaFactor, t.marginMinPx, t.marginMaxPx),
    y: clamp(sigmaPx.y * t.marginSigmaFactor, t.marginMinPx, t.marginMaxPx),
  };
}

/**
 * How far apart two regions are for a gaze estimate with per-axis error
 * `sigma`: the gap between the rectangles along their best separating axis,
 * in sigma units. 0 when they overlap or touch.
 */
export function separationSigma(a: RectLike, b: RectLike, sigma: { x: number; y: number }): number {
  const gx = Math.max(0, b.left - right(a), a.left - right(b));
  const gy = Math.max(0, b.top - bottom(a), a.top - bottom(b));
  return Math.max(gx / Math.max(1, sigma.x), gy / Math.max(1, sigma.y));
}

/** Separation of a target from its nearest competitor (Infinity when there is none). */
export function targetSeparation(
  target: RectLike,
  competitors: readonly RectLike[],
  sigma: { x: number; y: number },
): number {
  let s = Infinity;
  for (const c of competitors) s = Math.min(s, separationSigma(target, c, sigma));
  return s;
}

/** Index of the horizontal bin of `rect` that x falls into. */
export function binIndex(rect: RectLike, x: number, bins: number): number {
  if (rect.width <= 0) return 0;
  const f = (x - rect.left) / rect.width;
  return clamp(Math.floor(f * bins), 0, bins - 1);
}

/** Fraction of bins that received at least `minMs` of gaze. */
export function sweepCoverage(binMs: readonly number[], minMs: number): number {
  if (binMs.length === 0) return 0;
  return binMs.filter((ms) => ms >= minMs).length / binMs.length;
}

/**
 * Required dwell for a target of `words` words: personal when a baseline
 * exists (a fraction of the user's own typical dwell), a robust default otherwise.
 */
export function requiredDwellMs(words: number, baseline: Baseline | null): number {
  const d = ATTENTION_CONFIG.dwell;
  const perWord =
    baseline?.msPerWordDwell != null
      ? clamp(baseline.msPerWordDwell * d.baselineFraction, d.minMsPerWord, d.maxMsPerWord)
      : d.defaultMsPerWord;
  return clamp(Math.max(1, words) * perWord, d.minRequiredMs, d.maxRequiredMs);
}

/** Severity weight used when averaging coverage across several targets. */
export function severityWeight(severity: string): number {
  switch (severity) {
    case "CRITICAL":
      return 3;
    case "HIGH":
      return 2;
    case "MEDIUM":
      return 1.5;
    default:
      return 1;
  }
}
