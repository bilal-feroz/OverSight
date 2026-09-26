/**
 * Geometry for semantic regions. Pure functions over rectangles so the
 * mapping from gaze to DOM regions can be unit-tested without a browser.
 */
import type { RectLike } from "@/types/attention";
import type { Baseline } from "@/types/attention";
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

/**
 * Hit-test margin from the calibration error. Webcam gaze is noisy; a margin
 * proportional to the measured error avoids demanding pixel-perfect gaze,
 * while the clamp keeps far-away content (e.g. the title) from counting.
 */
export function hitMargin(sigmaPx: { x: number; y: number } | null): { x: number; y: number } {
  const t = ATTENTION_CONFIG.targets;
  if (!sigmaPx) return { x: t.marginMinPx, y: t.marginMinPx };
  return {
    x: clamp(sigmaPx.x * t.marginSigmaFactor, t.marginMinPx, t.marginMaxPx),
    y: clamp(sigmaPx.y * t.marginSigmaFactor, t.marginMinPx, t.marginMaxPx),
  };
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
