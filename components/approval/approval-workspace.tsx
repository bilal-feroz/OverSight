"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { CircleCheck, Layers, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DomGeometrySource } from "@/lib/attention/geometry";
import { reviewController } from "@/lib/attention/review-controller";
import { reReviewProgress } from "@/lib/attention/rereview";
import { currentGazeSignal } from "@/lib/attention/signal";
import { buildReviewTargets } from "@/lib/attention/targets";
import { useCvStore } from "@/lib/store/cv-store";
import { useLiveStore } from "@/lib/store/live-store";
import { useSessionStore } from "@/lib/store/session-store";
import { useUiStore } from "@/lib/store/ui-store";
import { ApprovalCard } from "./approval-card";
import { PauseView } from "./pause-view";

export function ApprovalWorkspace({ scrollRef }: { scrollRef: React.RefObject<HTMLElement | null> }) {
  const active = useSessionStore((s) => s.active);
  const item = useSessionStore((s) => s.queue.find((q) => q.id === s.active?.itemId) ?? null);
  const criticalOnly = useSessionStore((s) => s.criticalOnly);
  const overlay = useUiStore((s) => s.overlay);
  const liveReReview = useLiveStore((s) => s.reReview);
  const cardRef = useRef<HTMLElement | null>(null);

  const itemId = item?.id;
  const seq = active?.seq;
  const phaseNow = active?.phase;
  const ready = phaseNow === "reviewing" && Boolean(item?.analysis);
  const needsReReview =
    (phaseNow === "refocus" || phaseNow === "paused") && active?.reReview?.method === "gaze" && !active?.manual;

  // Start measuring once this request's own card is mounted (the previous card may
  // still be animating out), again on every activation.
  useEffect(() => {
    if (!ready || !itemId) return;
    let raf = 0;
    const tryBegin = () => {
      if (cardRef.current?.dataset.itemId !== itemId) {
        raf = requestAnimationFrame(tryBegin);
        return;
      }
      const { queue, baseline } = useSessionStore.getState();
      const current = queue.find((q) => q.id === itemId);
      if (!current?.analysis) return;
      reviewController.begin({
        approvalId: current.id,
        targets: buildReviewTargets(current.request, current.analysis, baseline),
        geometry: new DomGeometrySource({ getCard: () => cardRef.current, getScrollContainer: () => scrollRef.current }),
        ...currentGazeSignal(),
      });
    };
    raf = requestAnimationFrame(tryBegin);
    return () => cancelAnimationFrame(raf);
  }, [ready, itemId, seq, scrollRef]);

  // Returning to the console mid-intervention (e.g. after recalibrating): the
  // measuring session ended on unmount, so resume the gaze re-review.
  useEffect(() => {
    if (!needsReReview || !itemId || reviewController.session?.approvalId === itemId) return;
    const { queue, baseline, active: current } = useSessionStore.getState();
    const entry = queue.find((q) => q.id === itemId);
    if (!entry?.analysis || !current?.reReview) return;
    const session = reviewController.begin({
      approvalId: entry.id,
      targets: buildReviewTargets(entry.request, entry.analysis, baseline),
      geometry: new DomGeometrySource({ getCard: () => cardRef.current, getScrollContainer: () => scrollRef.current }),
      ...currentGazeSignal(),
    });
    session.startReReview(current.reReview);
    reviewController.flush();
  }, [needsReReview, itemId, seq, scrollRef]);

  // Keep a running review in sync if the camera, calibration or simulation changes.
  useEffect(
    () =>
      useCvStore.subscribe((s, prev) => {
        if (
          s.source === prev.source &&
          s.calibration === prev.calibration &&
          s.calibrationStale === prev.calibrationStale &&
          s.drift.suspected === prev.drift.suspected
        ) {
          return;
        }
        const session = reviewController.session;
        if (session?.phase === "reviewing") session.updateSignal(currentGazeSignal());
      }),
    [],
  );

  useEffect(() => () => reviewController.end(), []);

  // Advance after a decision; longer pause after an intervention so the outcome is visible.
  const phase = active?.phase;
  const outcome = active?.outcome;
  useEffect(() => {
    if (phase !== "approved" && phase !== "rejected") return;
    const delay = outcome?.endsWith("after_review") ? 2400 : 1300;
    const timer = window.setTimeout(() => useSessionStore.getState().next(), delay);
    return () => window.clearTimeout(timer);
  }, [phase, outcome, itemId]);

  // Refocus: bring the missed consequence into view and move focus to it.
  const focusFieldId = active?.focusFieldId;
  useEffect(() => {
    if (phase !== "refocus" || !focusFieldId || !itemId) return;
    const el = findRegionElement(itemId, focusFieldId);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.focus({ preventScroll: true });
  }, [phase, focusFieldId, itemId]);

  if (!active || !item) return <QueueComplete />;

  const actions = useSessionStore.getState();
  const reReview = active.manual ? active.reReview : (liveReReview ?? active.reReview);
  const satisfied = active.manual ? Boolean(active.reReview?.satisfied) : Boolean(liveReReview?.satisfied);
  const progress = reReview ? reReviewProgress(reReview) : 0;
  const reviewFocus = () => {
    if (!active.focusFieldId) return;
    const el = findRegionElement(item.id, active.focusFieldId);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.focus({ preventScroll: true });
  };
  // Bound to the request this card renders: a card that is animating out cannot act on the next one.
  const id = item.id;

  return (
    <AnimatePresence mode="wait" initial={false}>
      {active.phase === "paused" && item.analysis ? (
        <PauseView
          key={`pause-${item.id}`}
          request={item.request}
          analysis={item.analysis}
          active={active}
          reReviewProgress={progress}
          reReviewSatisfied={satisfied}
          onConfirm={() => actions.confirmApproval(id)}
          onReject={() => actions.reject(id)}
          onManual={() => actions.switchToManual(id)}
        />
      ) : (
        <motion.div
          key={`card-${item.id}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <ApprovalCard
            request={item.request}
            analysis={item.analysis}
            active={active}
            criticalOnly={criticalOnly}
            overlay={overlay}
            cardRef={cardRef}
            reReviewProgress={progress}
            reReviewSatisfied={satisfied}
            onApprove={() => actions.attemptApproval(id)}
            onReject={() => actions.reject(id)}
            onConfirm={() => actions.confirmApproval(id)}
            onReviewFocus={reviewFocus}
            onManual={() => actions.switchToManual(id)}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function findRegionElement(scope: string, regionId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[data-attention-scope="${CSS.escape(scope)}"][data-attention-region="${CSS.escape(regionId)}"]`,
  );
}

function QueueComplete() {
  const records = useSessionStore((s) => s.records);
  const reset = useSessionStore((s) => s.reset);
  const initialized = useSessionStore((s) => s.initialized);
  if (!initialized) return null;
  const interventions = records.filter((r) => r.intervention === "REFOCUS" || r.intervention === "PAUSE").length;
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-raised px-8 py-12 text-center">
      <CircleCheck className="mx-auto size-8 text-safe" aria-hidden />
      <h2 className="mt-4 text-xl font-semibold tracking-tight">Queue complete</h2>
      <p className="mt-1.5 text-sm text-fg-muted">
        {records.length} decision{records.length === 1 ? "" : "s"} recorded · {interventions} intervention
        {interventions === 1 ? "" : "s"}
      </p>
      <div className="mt-6 flex justify-center gap-2">
        <Link href="/session">
          <Button variant="primary">
            <Layers aria-hidden /> View session pattern
          </Button>
        </Link>
        <Button variant="secondary" onClick={reset}>
          <RotateCcw aria-hidden /> Reset demo
        </Button>
      </div>
    </div>
  );
}

export function CriticalOnlyBanner() {
  const criticalOnly = useSessionStore((s) => s.criticalOnly);
  const pattern = useSessionStore((s) => s.pattern);
  const setCriticalOnly = useSessionStore((s) => s.setCriticalOnly);
  return (
    <AnimatePresence initial={false}>
      {criticalOnly && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
        >
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-warn/35 bg-warn/[0.06] px-4 py-3">
            <div>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-warn">
                Critical-only review mode
              </p>
              <p className="mt-1 text-[13px] text-fg/90">
                {pattern.detected ? pattern.message : "Enabled for this session."} Routine details are collapsed and
                decision-critical consequences are expanded.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setCriticalOnly(false)}>
              Show full requests
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
