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
import { decideIntervention } from "@/lib/risk/intervention";
import { assessAttention } from "./engine";
import { assessPattern, type PatternPoint } from "./pattern";

export interface EvaluationInput {
  snapshot: ReviewSnapshot;
  risk: RiskLevel;
  baseline: Baseline;
  history: readonly Pick<ApprovalRecord, "attentionScore" | "latencyRatio">[];
  expectedWords: number;
  mlProbability?: number | null;
}

export interface Evaluation {
  assessment: AttentionAssessment;
  patternBefore: SessionPattern;
  patternAfter: SessionPattern;
  decision: InterventionDecision;
}

export function toPatternPoints(
  history: readonly Pick<ApprovalRecord, "attentionScore" | "latencyRatio">[],
): PatternPoint[] {
  return history.map((r) => ({ attentionScore: r.attentionScore, latencyRatio: r.latencyRatio }));
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
    { attentionScore: assessment.attentionScore, latencyRatio: assessment.latencyRatio },
  ]);
  const decision = decideIntervention(assessment, {
    risk: input.risk,
    pattern: patternAfter,
    mlProbability: input.mlProbability,
  });
  return { assessment, patternBefore, patternAfter, decision };
}
