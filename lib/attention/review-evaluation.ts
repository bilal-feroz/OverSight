/**
 * The decision for an approval attempt, exactly as the console makes it.
 *
 * Shared by the session store (the real decision) and the diagnostics panel
 * ("If approved now"), so the preview can never disagree with what Approve
 * would do: same history (approvals only), same baseline, same advisory ML.
 */
import type { ApprovalRequest } from "@/types/approval";
import type { ApprovalRecord, Baseline, ReviewSnapshot } from "@/types/attention";
import type { SemanticAnalysis } from "@/types/semantic";
import { extractFeatures } from "@/lib/ml/features";
import { isClassifierUsable, predictProbability, type AttentionClassifier } from "@/lib/ml/logistic";
import { evaluateApproval, toPatternPoints, type Evaluation } from "./evaluate";
import { expectedWordsFor } from "./targets";

/**
 * The approval pattern and the personal baseline describe how *approvals* are
 * reviewed; rejecting a bad request quickly is the safe action, not rubber-stamping.
 */
export function approvalsOf(records: readonly ApprovalRecord[]): ApprovalRecord[] {
  return records.filter((r) => r.outcome.startsWith("approved"));
}

/** Target dwell per word on a gaze-mode review (feeds the personal baseline). */
export function dwellPerWord(snapshot: ReviewSnapshot, evaluation: Evaluation): number | null {
  if (evaluation.assessment.mode !== "gaze") return null;
  const visible = snapshot.targets.filter((t) => t.visibleMs > 0);
  const words = visible.reduce((a, t) => a + t.words, 0);
  if (!words) return null;
  return visible.reduce((a, t) => a + t.dwellMs, 0) / words;
}

export interface ReviewContext {
  request: ApprovalRequest;
  analysis: SemanticAnalysis;
  /** All decisions so far in this session; only approvals feed the pattern. */
  records: readonly ApprovalRecord[];
  baseline: Baseline;
  classifier: AttentionClassifier | null;
}

export interface ReviewEvaluation {
  evaluation: Evaluation;
  features: number[];
  /** Advisory P(low attention), or null when no validated classifier is loaded. */
  ml: number | null;
}

export function evaluateReview(snapshot: ReviewSnapshot, ctx: ReviewContext): ReviewEvaluation {
  const history = approvalsOf(ctx.records);
  const input = {
    snapshot,
    risk: ctx.analysis.overallRisk,
    baseline: ctx.baseline,
    history,
    expectedWords: expectedWordsFor(ctx.request, ctx.analysis),
  };
  let evaluation = evaluateApproval(input);
  const features = extractFeatures(snapshot, evaluation.assessment, toPatternPoints(history));
  const ml = ctx.classifier && isClassifierUsable(ctx.classifier) ? predictProbability(ctx.classifier, features) : null;
  if (ml !== null) evaluation = evaluateApproval({ ...input, mlProbability: ml });
  return { evaluation, features, ml };
}
