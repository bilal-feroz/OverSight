/**
 * Feature vector for the behavioral classifier (layer 2).
 *
 * Only derived numbers: no video, no images, no landmarks, no identity.
 * The deterministic attention score itself is deliberately NOT a feature,
 * so the classifier learns from raw evidence rather than copying layer 1.
 */
import type { AttentionAssessment, ReviewSnapshot } from "@/types/attention";
import { clamp, clamp01 } from "@/lib/utils";
import { mean } from "@/lib/math/stats";
import type { PatternPoint } from "@/lib/attention/pattern";
import { assessPattern } from "@/lib/attention/pattern";

export const FEATURE_NAMES = [
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

export type FeatureName = (typeof FEATURE_NAMES)[number];

export const FEATURE_DESCRIPTIONS: Record<FeatureName, string> = {
  criticalCoverage: "Gaze dwell on critical regions vs. required dwell (0 when gaze unavailable)",
  gazeAvailable: "1 when reliable camera gaze evidence existed for this review",
  readingEvidence: "Horizontal sweep and fixations on critical text",
  logLatencyRatio: "log(approval latency / expected review time)",
  targetVisibility: "Time the critical regions were on screen",
  facePresence: "Face present and oriented to the screen",
  timeToFirstTargetRatio: "First fixation on a critical region / latency (1 = never)",
  offCardGazeRatio: "Share of gaze time spent outside the approval card",
  scrollDepth: "Deepest scroll position reached in the request",
  pointerActivity: "log(1 + pointer distance / 100 px)",
  hoveredTarget: "Pointer rested on a critical region",
  rapidStreak: "Consecutive rapid approvals before this one (capped at 5)",
  latencyTrend: "Recent trend of latency ratio (negative = accelerating)",
  priorAttentionMean: "Mean attention score of the previous 3 approvals",
};

export function extractFeatures(
  snapshot: ReviewSnapshot,
  assessment: AttentionAssessment,
  history: readonly PatternPoint[],
): number[] {
  const component = (key: string) => assessment.components.find((c) => c.key === key);
  const gazeTotal = snapshot.cardGazeMs + snapshot.offCardGazeMs;
  const firstFix = snapshot.targets
    .map((t) => t.firstFixationMs)
    .filter((v): v is number => v != null);
  const prior = assessPattern(history);
  const recent = history.slice(-3).map((p) => p.attentionScore);

  const values: Record<FeatureName, number> = {
    criticalCoverage: assessment.criticalCoverage ?? 0,
    gazeAvailable: assessment.mode === "gaze" ? 1 : 0,
    readingEvidence: component("reading")?.available ? (component("reading")?.value ?? 0) : 0,
    logLatencyRatio: clamp(Math.log(Math.max(1e-3, assessment.latencyRatio)), -3, 2),
    targetVisibility: component("visibility")?.value ?? 0,
    facePresence: component("presence")?.available ? (component("presence")?.value ?? 0) : 0,
    timeToFirstTargetRatio: firstFix.length
      ? clamp01(Math.min(...firstFix) / Math.max(1, snapshot.elapsedMs))
      : 1,
    offCardGazeRatio: gazeTotal > 0 ? clamp01(snapshot.offCardGazeMs / gazeTotal) : 0,
    scrollDepth: clamp01(snapshot.scrollDepth),
    pointerActivity: Math.log1p(snapshot.pointerDistancePx / 100),
    hoveredTarget: snapshot.targets.some((t) => t.hoverMs >= 300) ? 1 : 0,
    rapidStreak: Math.min(prior.rapidStreak, 5) / 5,
    latencyTrend: clamp(prior.latencyTrend, -1, 1),
    priorAttentionMean: recent.length ? mean(recent) : 0.8,
  };
  return FEATURE_NAMES.map((name) => values[name]);
}
