/**
 * Session approval pattern.
 *
 * Evaluates the *sequence* of approvals, not a single one: is review
 * thoroughness declining and are approvals accelerating? This is what
 * "approval fatigue" means in OverSight: a behavioral pattern in the
 * interaction. It is NOT an inference about tiredness, mood or wellbeing.
 *
 * The inputs are thoroughness (the attention score without its pattern
 * component) and latency ratio, so the pattern never feeds on itself.
 */
import type { PatternTrigger, SessionPattern } from "@/types/attention";
import { clamp01 } from "@/lib/utils";
import { slope } from "@/lib/math/stats";
import { ATTENTION_CONFIG } from "./config";
import { cusumSeries, recoveryPoints, type TemporalPoint } from "./temporal";

/** One approval as the pattern sees it. */
export type PatternPoint = TemporalPoint;

export function assessPattern(points: readonly PatternPoint[]): SessionPattern {
  const cfg = ATTENTION_CONFIG.pattern;
  const rapidRatio = ATTENTION_CONFIG.latency.rapidRatio;
  const n = points.length;
  const all = points.map((p) => p.thoroughness);
  const window = points.slice(-cfg.window);
  const scores = window.map((p) => p.thoroughness);

  if (n === 0) {
    return {
      n,
      scores: [],
      declineRun: 0,
      drop: 0,
      slope: 0,
      rapidStreak: 0,
      latencyTrend: 0,
      cusum: 0,
      fatigueScore: 0,
      status: "insufficient",
      detected: false,
      trigger: null,
      message: "Pattern analysis starts after 3 approvals.",
    };
  }

  // Non-increasing run (within tolerance) ending at the latest approval,
  // measured from the highest score inside that run.
  let start = n - 1;
  while (start > 0 && all[start] <= all[start - 1] + cfg.declineTolerance) start--;
  let peak = start;
  for (let i = start; i < n; i++) {
    if (all[i] >= all[peak]) peak = i;
  }
  const latest = all[n - 1];
  const declineRun = n - 1 - peak;
  const drop = Math.max(0, all[peak] - latest);

  let rapidStreak = 0;
  for (let i = n - 1; i >= 0; i--) {
    if (points[i].latencyRatio < rapidRatio) rapidStreak++;
    else break;
  }

  const s = slope(scores);
  const latencyTrend = slope(window.map((p) => Math.min(p.latencyRatio, 3)));
  const cusumAll = cusumSeries(points, recoveryPoints(points));
  const cusum = cusumAll[cusumAll.length - 1];

  const fatigueScore = clamp01(
    0.45 * Math.min(1, declineRun / 4) * Math.min(1, drop / 0.4) +
      0.3 * clamp01(-s / 0.12) +
      0.25 * Math.min(1, rapidStreak / cfg.rapidStreakForDetection),
  );

  const recovered = n >= 2 && all[n - 1] >= cfg.recoveryScore && all[n - 2] >= cfg.recoveryScore;

  const decline = declineRun >= cfg.declineRunForDetection && drop >= cfg.dropForDetection;
  const rapid = rapidStreak >= cfg.rapidStreakForDetection && latest < 0.6;
  const strength = fatigueScore >= cfg.fatigueScoreForDetection;
  // A sustained speed-up relative to the review baseline, even without a clean decline.
  const speedup = cusum > ATTENTION_CONFIG.temporal.cusumH;
  const detected = !recovered && n >= cfg.minApprovals && (decline || rapid || strength || speedup);
  const trigger: PatternTrigger | null = !detected
    ? null
    : decline
      ? "decline"
      : rapid
        ? "rapid"
        : speedup
          ? "speedup"
          : "strength";

  let status: SessionPattern["status"];
  if (n < 3) status = "insufficient";
  else if (detected) status = "degradation";
  else if ((declineRun >= 2 && drop >= 0.15) || s < -0.06) status = "declining";
  else status = "stable";

  let message: string;
  if (status === "insufficient") message = "Pattern analysis starts after 3 approvals.";
  else if (detected && (trigger === "decline" || (trigger !== "speedup" && declineRun >= 2)))
    message = `Review attention has declined across ${declineRun + 1} consecutive approvals.`;
  else if (detected && trigger === "speedup")
    message = "Approvals have become steadily faster than the review baseline.";
  else if (detected)
    message = `${rapidStreak} consecutive approvals were faster than the review baseline.`;
  else if (status === "declining") message = "Review attention is trending down.";
  else message = "Review attention is stable.";

  return {
    n,
    scores,
    declineRun,
    drop,
    slope: s,
    rapidStreak,
    latencyTrend,
    cusum,
    fatigueScore,
    status,
    detected,
    trigger,
    message,
  };
}
