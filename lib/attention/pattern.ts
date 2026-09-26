/**
 * Session approval pattern.
 *
 * Evaluates the *sequence* of approvals, not a single one: is review
 * attention declining and are approvals accelerating? This is what
 * "approval fatigue" means in OverSight: a behavioral pattern in the
 * interaction. It is NOT an inference about tiredness, mood or wellbeing.
 */
import type { SessionPattern } from "@/types/attention";
import { clamp01 } from "@/lib/utils";
import { slope } from "@/lib/math/stats";
import { ATTENTION_CONFIG } from "./config";

export interface PatternPoint {
  attentionScore: number;
  latencyRatio: number;
}

export function assessPattern(points: readonly PatternPoint[]): SessionPattern {
  const cfg = ATTENTION_CONFIG.pattern;
  const rapidRatio = ATTENTION_CONFIG.latency.rapidRatio;
  const n = points.length;
  const allScores = points.map((p) => p.attentionScore);
  const window = points.slice(-cfg.window);
  const scores = window.map((p) => p.attentionScore);

  if (n === 0) {
    return {
      n,
      scores: [],
      declineRun: 0,
      drop: 0,
      slope: 0,
      rapidStreak: 0,
      latencyTrend: 0,
      fatigueScore: 0,
      status: "insufficient",
      detected: false,
      message: "Pattern analysis starts after 3 approvals.",
    };
  }

  // Non-increasing run (within tolerance) ending at the latest approval,
  // measured from the highest score inside that run.
  let start = n - 1;
  while (start > 0 && allScores[start] <= allScores[start - 1] + cfg.declineTolerance) start--;
  let peak = start;
  for (let i = start; i < n; i++) {
    if (allScores[i] >= allScores[peak]) peak = i;
  }
  const latest = allScores[n - 1];
  const declineRun = n - 1 - peak;
  const drop = Math.max(0, allScores[peak] - latest);

  let rapidStreak = 0;
  for (let i = n - 1; i >= 0; i--) {
    if (points[i].latencyRatio < rapidRatio) rapidStreak++;
    else break;
  }

  const s = slope(scores);
  const latencyTrend = slope(window.map((p) => Math.min(p.latencyRatio, 3)));

  const fatigueScore = clamp01(
    0.45 * Math.min(1, declineRun / 4) * Math.min(1, drop / 0.4) +
      0.3 * clamp01(-s / 0.12) +
      0.25 * Math.min(1, rapidStreak / cfg.rapidStreakForDetection),
  );

  const recovered =
    n >= 2 && allScores[n - 1] >= cfg.recoveryScore && allScores[n - 2] >= cfg.recoveryScore;

  const detected =
    !recovered &&
    n >= cfg.minApprovals &&
    ((declineRun >= cfg.declineRunForDetection && drop >= cfg.dropForDetection) ||
      (rapidStreak >= cfg.rapidStreakForDetection && latest < 0.6) ||
      fatigueScore >= cfg.fatigueScoreForDetection);

  let status: SessionPattern["status"];
  if (n < 3) status = "insufficient";
  else if (detected) status = "degradation";
  else if ((declineRun >= 2 && drop >= 0.15) || s < -0.06) status = "declining";
  else status = "stable";

  let message: string;
  if (status === "insufficient") message = "Pattern analysis starts after 3 approvals.";
  else if (detected && declineRun >= 2)
    message = `Review attention has declined across ${declineRun + 1} consecutive approvals.`;
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
    fatigueScore,
    status,
    detected,
    message,
  };
}
