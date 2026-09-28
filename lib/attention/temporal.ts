/**
 * Temporal features of the approval sequence: pure functions over the
 * session's previous approvals (plus the current one where the policy needs
 * it). They describe how the reviewer's pace and evidence are changing, never
 * the reviewer ("not tiredness").
 *
 * Inputs are independent of the pattern itself: thoroughness (the attention
 * score without its pattern component), latency ratio, conclusive coverage and
 * the count of critical targets whose gaze evidence was "not observed".
 */
import { mean, median, slope } from "@/lib/math/stats";
import { clamp } from "@/lib/utils";
import { ATTENTION_CONFIG } from "./config";

export interface TemporalPoint {
  /** Attention evidence without the pattern component (0-1). */
  thoroughness: number;
  /** Approval latency / expected review time. */
  latencyRatio: number;
  /** Severity-weighted coverage of conclusive targets; null when gaze did not judge. */
  coverage?: number | null;
  /** Critical targets with conclusive "not observed" gaze evidence. */
  notObserved?: number;
}

export interface TemporalFeatures {
  /** Approvals before this point (the approval index of the next one). */
  index: number;
  /** Rolling median of log(latency ratio) over the window. */
  logLatencyMedian: number;
  /** EWMA of log(latency ratio). */
  logLatencyEwma: number;
  /** Least-squares slope of log(latency ratio) over the last window (negative = speeding up). */
  logLatencySlope: number;
  /** Consecutive latest approvals faster than the rapid ratio. */
  rapidStreak: number;
  /** Mean conclusive coverage over the window; null when gaze judged none of them. */
  coverageMean: number | null;
  /** Not-observed critical targets over the window. */
  notObservedRecent: number;
  /** One-sided CUSUM of -log(latency ratio): a sustained speed-up. */
  cusum: number;
  cusumAlarm: boolean;
}

const logRatio = (r: number) => Math.log(clamp(r, 1e-3, 1e3));

/**
 * One-sided CUSUM of x = -log(latency ratio): S_t = max(0, S_(t-1) + x_t - k).
 * A run of approvals clearly faster than expected accumulates; approvals at
 * the expected pace drain it by k each. `resetAt` (indices) restart it, e.g.
 * after two attentive approvals cleared a pattern.
 */
export function cusumSeries(points: readonly TemporalPoint[], resetAt: ReadonlySet<number> = new Set()): number[] {
  const k = ATTENTION_CONFIG.temporal.cusumK;
  const out: number[] = [];
  let s = 0;
  points.forEach((p, i) => {
    s = resetAt.has(i) ? 0 : Math.max(0, s + -logRatio(p.latencyRatio) - k);
    out.push(s);
  });
  return out;
}

/** Indices where two attentive approvals in a row end a pattern (the CUSUM restarts there). */
export function recoveryPoints(points: readonly TemporalPoint[]): Set<number> {
  const r = ATTENTION_CONFIG.pattern.recoveryScore;
  const set = new Set<number>();
  for (let i = 1; i < points.length; i++) {
    if (points[i].thoroughness >= r && points[i - 1].thoroughness >= r) set.add(i);
  }
  return set;
}

export function temporalFeatures(points: readonly TemporalPoint[]): TemporalFeatures {
  const cfg = ATTENTION_CONFIG.temporal;
  const window = points.slice(-cfg.window);
  const logs = window.map((p) => logRatio(p.latencyRatio));
  let ewma = 0;
  points.forEach((p, i) => {
    const x = logRatio(p.latencyRatio);
    ewma = i === 0 ? x : cfg.ewmaAlpha * x + (1 - cfg.ewmaAlpha) * ewma;
  });
  let rapidStreak = 0;
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].latencyRatio < ATTENTION_CONFIG.latency.rapidRatio) rapidStreak++;
    else break;
  }
  const judged = window.map((p) => p.coverage).filter((c): c is number => c != null);
  const cusum = cusumSeries(points, recoveryPoints(points));
  const last = cusum.length ? cusum[cusum.length - 1] : 0;
  return {
    index: points.length,
    logLatencyMedian: logs.length ? median(logs) : 0,
    logLatencyEwma: points.length ? ewma : 0,
    logLatencySlope: slope(logs),
    rapidStreak,
    coverageMean: judged.length ? mean(judged) : null,
    notObservedRecent: window.reduce((a, p) => a + (p.notObserved ?? 0), 0),
    cusum: last,
    cusumAlarm: last > cfg.cusumH,
  };
}
