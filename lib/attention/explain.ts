/**
 * What an intervention rests on, so the UI states only what the evidence
 * supports: gaze evidence that the consequence was not observed, interaction
 * timing alone (gaze inconclusive or unavailable), or the consequence never
 * having been on screen.
 */
import type { InterventionDecision, AttentionAssessment } from "@/types/attention";
import { INTERVENTION_ORDER } from "@/types/attention";

export type InterventionBasis = "gaze" | "behavior" | "not-visible";

export function interventionBasis(
  evaluation: { assessment: AttentionAssessment; decision: InterventionDecision } | null,
  focusId: string | null,
): InterventionBasis {
  if (!evaluation) return "behavior";
  const { assessment, decision } = evaluation;
  const focus = assessment.targetCoverage.find((t) => t.id === focusId);
  if (focus && !focus.visible) return "not-visible";
  const gazeTrusted = decision.trustLevel === "high" || decision.trustLevel === "medium";
  if (
    gazeTrusted &&
    decision.gazeLevel !== null &&
    INTERVENTION_ORDER[decision.gazeLevel] >= INTERVENTION_ORDER.REFOCUS &&
    focus?.conclusive !== false
  ) {
    return "gaze";
  }
  return "behavior";
}
