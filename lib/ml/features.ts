/**
 * Named, versioned features for the behavioral classifier (layer 2).
 *
 * Only derived numbers: no video, no images, no landmarks, no identity. The
 * current review's deterministic score and decision are deliberately NOT
 * features, so a model learns from evidence rather than copying layer 1.
 * Missing evidence is `null` (for example coverage when gaze did not judge),
 * never a fake 0; models impute it from their training data and also see the
 * availability indicator.
 */
import type { RiskLevel } from "@/types/approval";
import { RISK_ORDER } from "@/types/approval";
import type { AttentionAssessment, ReviewSnapshot } from "@/types/attention";
import { TRUST_ORDER } from "@/types/attention";
import { clamp, clamp01 } from "@/lib/utils";
import type { PatternPoint } from "@/lib/attention/pattern";
import { temporalFeatures } from "@/lib/attention/temporal";

export const FEATURE_SCHEMA_VERSION = 2;

/** Current review, then the recent trajectory (this approval included). */
export const FEATURE_NAMES = [
  "conclusiveCoverage",
  "coverageAvailable",
  "trustLevel",
  "trustConfidence",
  "separationSigma",
  "timeToFirstCriticalRatio",
  "attributedFixations",
  "logLatencyRatio",
  "visibilityRatio",
  "offCardRatio",
  "pointerActivity",
  "hoveredTarget",
  "scrollDepth",
  "riskOrdinal",
  "latencyMedian5",
  "latencyEwma",
  "latencySlope5",
  "rapidStreak",
  "coverageMean5",
  "notObserved5",
  "speedupCusum",
  "approvalIndex",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];
export type NamedFeatures = Record<FeatureName, number | null>;

/** The same feature list split for the evaluation's model comparison. */
export const CURRENT_REVIEW_FEATURES: FeatureName[] = FEATURE_NAMES.slice(0, 14) as FeatureName[];
export const TEMPORAL_FEATURES: FeatureName[] = FEATURE_NAMES.slice(14) as FeatureName[];

export const FEATURE_DESCRIPTIONS: Record<FeatureName, string> = {
  conclusiveCoverage: "Dwell vs. required dwell on critical targets gaze could judge (missing when it judged none)",
  coverageAvailable: "1 when gaze judged at least one critical target",
  trustLevel: "Gaze trust: 0 none, 1 low, 2 medium, 3 high",
  trustConfidence: "Gaze trust confidence (0-1)",
  separationSigma: "Best separation of a critical target from title/summary/buttons, in gaze-error units (capped at 10)",
  timeToFirstCriticalRatio: "First fixation on a critical target / latency (1 = never; missing without gaze)",
  attributedFixations: "log(1 + fixations attributed to critical targets); missing without gaze",
  logLatencyRatio: "log(approval latency / expected review time from the personal baseline)",
  visibilityRatio: "Time the critical regions were on screen vs. what reviewing them needs",
  offCardRatio: "Share of gaze time outside the approval card; missing without gaze",
  pointerActivity: "log(1 + pointer distance / 100 px)",
  hoveredTarget: "Pointer rested on a critical region",
  scrollDepth: "Deepest scroll position reached in the request",
  riskOrdinal: "Request risk: 0 low, 1 medium, 2 high, 3 critical",
  latencyMedian5: "Median log latency ratio over the last 5 approvals",
  latencyEwma: "EWMA of log latency ratio across the session",
  latencySlope5: "Slope of log latency ratio over the last 5 approvals (negative = speeding up)",
  rapidStreak: "Consecutive rapid approvals ending here (capped at 5)",
  coverageMean5: "Mean conclusive coverage over the last 5 approvals (missing when gaze judged none)",
  notObserved5: "Critical targets with 'not observed' gaze evidence over the last 5 approvals",
  speedupCusum: "One-sided CUSUM of -log latency ratio (sustained speed-up)",
  approvalIndex: "Approvals so far in this session",
};

/**
 * Features of one approval attempt. `history` is the session's earlier
 * approvals (oldest first); everything used is available at decision time.
 */
export function extractFeatures(
  snapshot: ReviewSnapshot,
  assessment: AttentionAssessment,
  history: readonly PatternPoint[],
  risk: RiskLevel,
): NamedFeatures {
  const component = (key: string) => assessment.components.find((c) => c.key === key);
  const gazeUsed = assessment.mode === "gaze";
  const gazeTotal = snapshot.cardGazeMs + snapshot.offCardGazeMs;
  const firstFix = snapshot.targets.map((t) => t.firstFixationMs).filter((v): v is number => v != null);
  const fixations = snapshot.targets.reduce((a, t) => a + t.fixations, 0);
  const current: PatternPoint = {
    thoroughness: assessment.thoroughness,
    latencyRatio: assessment.latencyRatio,
    coverage: assessment.criticalCoverage,
    notObserved: assessment.targetCoverage.filter((t) => t.strength === "not-observed").length,
  };
  const t = temporalFeatures([...history, current]);
  const visibility = component("visibility");
  return {
    conclusiveCoverage: assessment.criticalCoverage,
    coverageAvailable: assessment.criticalCoverage === null ? 0 : 1,
    trustLevel: TRUST_ORDER[assessment.trust.level],
    trustConfidence: assessment.trust.confidence,
    separationSigma: assessment.trust.separation === null ? null : Math.min(10, assessment.trust.separation),
    timeToFirstCriticalRatio: !gazeUsed
      ? null
      : firstFix.length
        ? clamp01(Math.min(...firstFix) / Math.max(1, snapshot.elapsedMs))
        : 1,
    attributedFixations: gazeUsed ? Math.log1p(fixations) : null,
    logLatencyRatio: clamp(Math.log(Math.max(1e-3, assessment.latencyRatio)), -3, 2),
    visibilityRatio: visibility?.available ? visibility.value : null,
    offCardRatio: gazeUsed && gazeTotal > 0 ? clamp01(snapshot.offCardGazeMs / gazeTotal) : null,
    pointerActivity: Math.log1p(snapshot.pointerDistancePx / 100),
    hoveredTarget: snapshot.targets.some((x) => x.hoverMs >= 300) ? 1 : 0,
    scrollDepth: clamp01(snapshot.scrollDepth),
    riskOrdinal: RISK_ORDER[risk],
    latencyMedian5: clamp(t.logLatencyMedian, -3, 2),
    latencyEwma: clamp(t.logLatencyEwma, -3, 2),
    latencySlope5: clamp(t.logLatencySlope, -2, 2),
    rapidStreak: Math.min(t.rapidStreak, 5),
    coverageMean5: t.coverageMean,
    notObserved5: t.notObservedRecent,
    speedupCusum: Math.min(t.cusum, 10),
    approvalIndex: t.index - 1,
  };
}

/**
 * Ordered vector for a model trained on `names`. A missing feature takes the
 * model's imputation value (its training mean), so "no gaze" is never read
 * as "zero coverage".
 */
export function toVector(
  named: Partial<Record<string, number | null>>,
  names: readonly string[],
  impute: readonly number[],
): number[] {
  return names.map((name, i) => {
    const v = named[name];
    return v == null || !Number.isFinite(v) ? (impute[i] ?? 0) : v;
  });
}

/** Feature names of legacy (v1) dataset files, which stay readable but are not used for v2 models. */
export const LEGACY_V1_FEATURE_NAMES = [
  "criticalCoverage",
  "gazeAvailable",
  "readingEvidence",
  "logLatencyRatio",
  "targetVisibility",
  "facePresence",
  "timeToFirstTargetRatio",
  "offCardGazeRatio",
  "scrollDepth",
  "pointerActivity",
  "hoveredTarget",
  "rapidStreak",
  "latencyTrend",
  "priorAttentionMean",
] as const;
