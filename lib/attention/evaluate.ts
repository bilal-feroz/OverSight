/**
 * One call that runs the full deterministic decision for an approval attempt:
 *
 *   snapshot -> AttentionEngine -> session pattern (incl. this attempt) -> InterventionEngine
 */
import type { RiskLevel } from "@/types/approval";
import type {
  ApprovalRecord,
  AttentionAssessment,
  Baseline,
  InterventionDecision,
  ReviewSnapshot,
  SessionPattern,
} from "@/types/attention";
import { decideIntervention, type MlInfluence } from "@/lib/risk/intervention";
import { thoroughnessOf } from "./baseline";
import { assessAttention } from "./engine";
import { assessPattern, type PatternPoint } from "./pattern";

/** What the pattern needs from an earlier approval. */
export type HistoryRecord = Pick<ApprovalRecord, "attentionScore" | "latencyRatio"> &
  Partial<Pick<ApprovalRecord, "thoroughness" | "criticalCoverage" | "notObserved">>;

export interface EvaluationInput {
  snapshot: ReviewSnapshot;
  risk: RiskLevel;
  baseline: Baseline;
  history: readonly HistoryRecord[];
  expectedWords: number;
  /** Influence of an activated advisory model (its own calibrated thresholds). */
  ml?: MlInfluence | null;
  /** Shorthand for `ml` with the default thresholds (tests, tools). */
  mlProbability?: number | null;
}

export interface Evaluation {
  assessment: AttentionAssessment;
  patternBefore: SessionPattern;
  patternAfter: SessionPattern;
  decision: InterventionDecision;
}

export function toPatternPoints(history: readonly HistoryRecord[]): PatternPoint[] {
  return history.map((r) => ({
    thoroughness: thoroughnessOf(r),
    latencyRatio: r.latencyRatio,
    coverage: r.criticalCoverage ?? null,
    notObserved: r.notObserved ?? 0,
  }));
}

/** Critical targets whose conclusive gaze evidence says "not observed". */
export function notObservedCount(assessment: AttentionAssessment): number {
  return assessment.targetCoverage.filter((t) => t.strength === "not-observed").length;
}

export function evaluateApproval(input: EvaluationInput): Evaluation {
  const points = toPatternPoints(input.history);
  const assessment = assessAttention(input.snapshot, {
    risk: input.risk,
    baseline: input.baseline,
    history: points,
    expectedWords: input.expectedWords,
  });
  const patternBefore = assessPattern(points);
  const patternAfter = assessPattern([
    ...points,
    {
      thoroughness: assessment.thoroughness,
      latencyRatio: assessment.latencyRatio,
      coverage: assessment.criticalCoverage,
      notObserved: notObservedCount(assessment),
    },
  ]);
  const decision = decideIntervention(assessment, {
    risk: input.risk,
    pattern: patternAfter,
    ml: input.ml,
    mlProbability: input.mlProbability,
  });
  return { assessment, patternBefore, patternAfter, decision };
}
