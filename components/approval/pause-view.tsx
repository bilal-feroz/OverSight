"use client";

import { useEffect, useId, useRef } from "react";
import { motion } from "motion/react";
import { ArrowRight, Check, CircleCheck, CirclePause, Info, TriangleAlert } from "lucide-react";
import type { ApprovalRequest } from "@/types/approval";
import type { Reason } from "@/types/attention";
import type { SemanticAnalysis } from "@/types/semantic";
import type { ActiveApproval } from "@/lib/store/session-store";
import { AttentionRegion, RegionScope } from "@/components/attention/attention-region";
import { EvidenceMap } from "@/components/attention/evidence-map";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/misc";
import { interventionBasis, type InterventionBasis } from "@/lib/attention/explain";
import { findBlock, focusRegionFor } from "@/lib/attention/targets";
import { cn, formatPct, wordCount } from "@/lib/utils";
import { BlockText } from "./block-text";
import { ManualAck } from "./manual-ack";

export function ReasonIcon({ tone }: { tone: Reason["tone"] }) {
  if (tone === "critical") return <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-critical" aria-hidden />;
  if (tone === "warning") return <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />;
  if (tone === "positive") return <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-safe" aria-hidden />;
  return <Info className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" aria-hidden />;
}

const PAUSE_COPY: Record<InterventionBasis, string> = {
  gaze: "The evidence suggests this consequence was not visually inspected before Approve was clicked. OverSight cannot tell whether it was understood, only that it was probably not looked at.",
  behavior:
    "Approve was clicked much sooner than a careful review of this request usually takes, and gaze could not confirm that this consequence was looked at. OverSight cannot tell whether it was understood, so it asks you to confirm it.",
  "not-visible":
    "This consequence was not on screen before Approve was clicked. OverSight cannot tell whether it was understood, so it asks you to review it.",
};

/**
 * APPROVAL PAUSED: the request collapses to the single consequence that
 * appears not to have been observed. Approval re-enables only after that
 * consequence is visually reviewed (or manually acknowledged).
 */
export function PauseView({
  request,
  analysis,
  active,
  reReviewProgress,
  reReviewSatisfied,
  onConfirm,
  onReject,
  onManual,
}: {
  request: ApprovalRequest;
  analysis: SemanticAnalysis;
  active: ActiveApproval;
  reReviewProgress: number;
  reReviewSatisfied: boolean;
  onConfirm: () => void;
  onReject: () => void;
  onManual: () => void;
}) {
  const headingId = useId();
  const descId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const reviewRef = useRef<HTMLDivElement>(null);
  const region = focusRegionFor(request, analysis, active.focusFieldId);
  const block = findBlock(request, region.fieldId);
  const evaluation = active.evaluation;
  const satisfied = active.manual ? Boolean(active.reReview?.satisfied) : reReviewSatisfied;

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.closest("main")?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  if (!evaluation || !active.snapshot) return null;
  const { assessment, decision } = evaluation;
  const reasons = decision.reasons.filter((r) => r.tone !== "positive").slice(0, 5);

  return (
    <RegionScope value={request.id}>
    <motion.section
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={headingId}
      aria-describedby={descId}
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      className="relative overflow-hidden rounded-[var(--radius-card)] border border-critical/45 bg-raised shadow-[0_30px_70px_-35px_rgba(217,105,78,0.45)]"
    >
      <div className="h-1 w-full bg-critical" aria-hidden />
      <div className="px-7 pb-6 pt-5 short:pb-5 short:pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-mono text-[11.5px] font-semibold uppercase tracking-[0.2em] text-critical">
            <CirclePause className="size-4" aria-hidden /> Approval paused
          </div>
          <span className="truncate font-mono text-[11.5px] text-fg-subtle">
            {request.agent.name} · {request.title}
          </span>
        </div>
        <h2
          id={headingId}
          ref={headingRef}
          tabIndex={-1}
          className="mt-2.5 text-[28px] font-semibold leading-tight tracking-[-0.02em] text-fg outline-none short:mt-1.5 short:text-[24px]"
        >
          You may have missed a critical consequence.
        </h2>
        <p id={descId} className="mt-1.5 max-w-[64ch] text-[14px] leading-relaxed text-fg-muted short:text-[13px]">
          {PAUSE_COPY[interventionBasis(evaluation, region.fieldId)]}
        </p>

        <AttentionRegion
          ref={reviewRef}
          regionId={`review:${region.fieldId}`}
          regionRole="review-target"
          label="Isolated consequence"
          words={wordCount(region.statement)}
          severity={region.severity}
          tabIndex={-1}
          className="outline-none"
        >
          <motion.div
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.08, duration: 0.25 }}
            className={cn(
              "mt-5 rounded-xl border-2 px-6 py-5 transition-colors duration-300 short:mt-3.5 short:py-4",
              satisfied ? "border-safe/50 bg-safe/[0.05]" : "border-critical/60 bg-critical/[0.07] motion-safe:animate-pulse-once",
            )}
          >
            <div className={cn("eyebrow flex items-center gap-2", satisfied ? "!text-safe" : "!text-critical")}>
              <TriangleAlert className="size-3.5" aria-hidden /> Decision-critical · {region.reason}
            </div>
            <p className="mt-2.5 text-[25px] font-semibold leading-snug tracking-[-0.01em] text-fg short:mt-1.5 short:text-[22px]">
              {region.statement}
            </p>
            {block && (
              <p className="mt-2.5 text-[13.5px] leading-relaxed text-fg-muted">
                <span className="text-fg-subtle">From the request: </span>“
                <BlockText text={block.text} phrase={region.phrase} emphasize />”
              </p>
            )}
          </motion.div>
        </AttentionRegion>

        <div className="mt-3.5 min-h-[40px] short:mt-2.5" aria-live="polite">
          {active.manual ? (
            <ManualAck statement={region.statement} satisfied={satisfied} />
          ) : satisfied ? (
            <p className="inline-flex items-center gap-2 text-[15px] font-medium text-safe">
              <CircleCheck className="size-5" aria-hidden /> Critical consequence reviewed
            </p>
          ) : (
            <div>
              <Progress value={reReviewProgress} tone="critical" label="Re-review progress" className="bg-canvas/70" />
              <p className="mt-1.5 text-xs text-fg-muted">
                Read the consequence above. Approval unlocks once OverSight registers that it was visually reviewed.
              </p>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {!active.manual ? (
            <button
              type="button"
              onClick={onManual}
              className="text-[13px] text-fg-muted underline underline-offset-2 hover:text-fg"
            >
              I cannot use camera-based attention verification
            </button>
          ) : (
            <span className="text-[13px] text-fg-subtle">Manual acknowledgement mode</span>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={onReject} data-gaze-anchor>
              Reject action
            </Button>
            {satisfied ? (
              <Button variant="primary" onClick={onConfirm} data-gaze-anchor>
                <Check aria-hidden /> I reviewed the critical consequence
              </Button>
            ) : (
              <Button
                variant="dangerOutline"
                onClick={() => reviewRef.current?.focus({ preventScroll: false })}
              >
                Review missed consequence <ArrowRight aria-hidden />
              </Button>
            )}
          </div>
        </div>

        <div className="mt-5 grid gap-6 border-t border-line pt-5 md:grid-cols-[minmax(0,1fr)_236px]">
          <div>
            <h3 className="eyebrow mb-2">Why OverSight paused</h3>
            <ul className="space-y-1.5">
              {reasons.map((r) => (
                <li key={r.code} className="flex gap-2 text-[13.5px] leading-snug text-fg/90">
                  <ReasonIcon tone={r.tone} />
                  <span>{r.text}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11.5px] text-fg-subtle">
              <div>
                <dt className="inline">Attention </dt>
                <dd className="inline text-fg-muted">{formatPct(assessment.attentionScore)}</dd>
              </div>
              <div>
                <dt className="inline">Coverage </dt>
                <dd className="inline text-fg-muted">
                  {assessment.criticalCoverage === null ? "n/a" : formatPct(assessment.criticalCoverage)}
                </dd>
              </div>
              <div>
                <dt className="inline">Latency </dt>
                <dd className="inline text-fg-muted">{(assessment.latencyMs / 1000).toFixed(1)} s</dd>
              </div>
              <div>
                <dt className="inline">Gaze trust </dt>
                <dd className="inline text-fg-muted">{assessment.trust.level}</dd>
              </div>
            </dl>
          </div>
          <div>
            <h3 className="eyebrow mb-2">Attention evidence</h3>
            <EvidenceMap snapshot={active.snapshot} targetCoverage={assessment.targetCoverage} />
          </div>
        </div>

      </div>
    </motion.section>
    </RegionScope>
  );
}
