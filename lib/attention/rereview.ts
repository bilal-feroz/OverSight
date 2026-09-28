/**
 * Re-review validation after an intervention.
 *
 * Approval is NOT re-enabled by a timer. With camera evidence, the isolated
 * consequence must be on screen and receive enough gaze dwell, weighted by
 * how compatible each estimate is with looking at it. Without
 * camera evidence (or by choice, for accessibility) the reviewer confirms
 * the consequence manually by typing its key quantity.
 */
import type { ReReviewState } from "@/types/attention";
import { clamp } from "@/lib/utils";
import { ATTENTION_CONFIG } from "./config";

export function createReReview(
  targetId: string,
  targetRequiredDwellMs: number,
  method: "gaze" | "manual",
): ReReviewState {
  const r = ATTENTION_CONFIG.rereview;
  return {
    targetId,
    method,
    requiredDwellMs: clamp(targetRequiredDwellMs * r.fractionOfTarget, r.minRequiredMs, r.maxRequiredMs),
    minVisibleMs: r.minVisibleMs,
    dwellMs: 0,
    visibleMs: 0,
    satisfied: false,
  };
}

export interface ReReviewInput {
  dtMs: number;
  targetVisible: boolean;
  /** Soft weight (0-1) that gaze was on the target; takes precedence over gazeOnTarget. */
  gazeWeight?: number;
  /** Binary form, for callers without an uncertainty estimate. */
  gazeOnTarget?: boolean;
  faceOk: boolean;
}

export function stepReReview(state: ReReviewState, input: ReReviewInput): ReReviewState {
  if (state.satisfied || state.method !== "gaze") return state;
  const dt = clamp(input.dtMs, 0, ATTENTION_CONFIG.targets.maxFrameDtMs);
  const weight = clamp(input.gazeWeight ?? (input.gazeOnTarget ? 1 : 0), 0, 1);
  const visibleMs = state.visibleMs + (input.targetVisible ? dt : 0);
  const dwellMs = state.dwellMs + (input.targetVisible && input.faceOk ? dt * weight : 0);
  const satisfied = dwellMs >= state.requiredDwellMs && visibleMs >= state.minVisibleMs;
  return { ...state, visibleMs, dwellMs, satisfied };
}

export function reReviewProgress(state: ReReviewState): number {
  if (state.satisfied) return 1;
  if (state.method !== "gaze") return 0;
  return Math.min(1, state.dwellMs / Math.max(1, state.requiredDwellMs));
}

/**
 * The value a reviewer types to acknowledge a consequence without camera
 * verification: the first quantity in the statement (e.g. "2,431"), or null
 * when the statement has none (a checkbox is used instead).
 */
export function manualAckToken(statement: string): string | null {
  const m = /\d[\d,.]*\d|\d/.exec(statement);
  return m ? m[0] : null;
}

function normalizeAck(value: string): string {
  return value.replace(/[^0-9a-z]/gi, "").toLowerCase();
}

export function acknowledgeManually(
  state: ReReviewState,
  input: { typed?: string; expectedToken: string | null; checked?: boolean },
): ReReviewState {
  const ok = input.expectedToken
    ? normalizeAck(input.typed ?? "") === normalizeAck(input.expectedToken)
    : Boolean(input.checked);
  return ok ? { ...state, method: "manual", satisfied: true } : state;
}
