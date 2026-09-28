/**
 * Gaze trust of the review in progress, for the signal banner. The decision
 * itself always uses the trust computed at the approval click.
 */
import type { LiveTrust } from "@/lib/store/live-store";
import { ATTENTION_CONFIG } from "./config";
import { assessSignal } from "./engine";
import type { ReviewSession } from "./tracker";
import { assessGazeTrust } from "./trust";

/** Trust of the evidence so far, or null until the review has run long enough to judge it. */
export function liveTrust(session: ReviewSession): LiveTrust | null {
  const snapshot = session.snapshot();
  if (snapshot.elapsedMs < ATTENTION_CONFIG.trust.liveSettleMs) return null;
  const signal = assessSignal(snapshot);
  const trust = assessGazeTrust(snapshot, signal);
  const reason = trust.reasons[0] ?? signal.notes[0] ?? null;
  return { level: trust.level, code: reason?.code ?? null, text: reason?.text ?? null };
}
