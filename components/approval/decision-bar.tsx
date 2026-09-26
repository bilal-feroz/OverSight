"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, CirclePause, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ApprovalPhase } from "@/lib/store/session-store";

const swap = {
  initial: { opacity: 0, scale: 0.96, filter: "blur(2px)" },
  animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
  exit: { opacity: 0, scale: 0.96, filter: "blur(2px)" },
  transition: { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] as const },
};

/**
 * Approve / Reject. On a low-attention attempt the Approve button is not
 * merely disabled: it transforms into a route to the missed consequence.
 */
export function DecisionBar({
  phase,
  satisfied,
  onApprove,
  onReject,
  onConfirm,
  onReviewFocus,
}: {
  phase: ApprovalPhase;
  satisfied: boolean;
  onApprove: () => void;
  onReject: () => void;
  onConfirm: () => void;
  onReviewFocus: () => void;
}) {
  if (phase === "approved") {
    return (
      <div className="inline-flex h-9 items-center gap-2 rounded-lg border border-safe/40 bg-safe/10 px-3 text-sm font-medium text-safe">
        <Check className="size-4" aria-hidden /> Approved
      </div>
    );
  }
  if (phase === "rejected") {
    return (
      <div className="inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-sm font-medium text-fg-muted">
        <X className="size-4" aria-hidden /> Rejected
      </div>
    );
  }
  if (phase === "paused") {
    return (
      <div className="inline-flex h-9 items-center gap-2 rounded-lg border border-critical/50 bg-critical/10 px-3 text-sm font-medium text-critical">
        <CirclePause className="size-4" aria-hidden /> Approval paused
      </div>
    );
  }
  const analyzing = phase === "analyzing";
  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" onClick={onReject} disabled={analyzing} data-gaze-anchor>
        Reject
      </Button>
      <AnimatePresence mode="popLayout" initial={false}>
        {analyzing && (
          <motion.div key="analyzing" {...swap}>
            <Button variant="secondary" disabled>
              <LoaderCircle className="animate-spin" aria-hidden /> Analyzing
            </Button>
          </motion.div>
        )}
        {phase === "reviewing" && (
          <motion.div key="approve" {...swap}>
            <Button variant="primary" onClick={onApprove} className="min-w-[112px]" data-gaze-anchor>
              <Check aria-hidden /> Approve
            </Button>
          </motion.div>
        )}
        {phase === "refocus" && !satisfied && (
          <motion.div key="review" {...swap}>
            <Button variant="dangerOutline" onClick={onReviewFocus}>
              Review critical consequence <ArrowRight aria-hidden />
            </Button>
          </motion.div>
        )}
        {phase === "refocus" && satisfied && (
          <motion.div key="confirm" {...swap}>
            <Button variant="primary" onClick={onConfirm} data-gaze-anchor>
              <Check aria-hidden /> Confirm approval
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
