"use client";

import { useRef } from "react";
import { FlaskConical } from "lucide-react";
import { IntelligencePanel } from "@/components/attention/intelligence-panel";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { CONDITION_INSTRUCTIONS, CONDITION_NAMES } from "@/lib/ml/protocol";
import { useSessionStore } from "@/lib/store/session-store";
import { ApprovalQueue } from "./approval-queue";
import { ApprovalWorkspace, CriticalOnlyBanner } from "./approval-workspace";

export function ConsoleView() {
  const scrollRef = useRef<HTMLElement | null>(null);
  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <ApprovalQueue />
        <main
          id="main"
          ref={scrollRef}
          className="min-w-0 flex-1 bg-canvas lg:overflow-y-auto"
          aria-label="Approval request"
        >
          <div className="mx-auto w-full max-w-[860px] px-4 py-5 md:px-6 md:py-6 short:py-3">
            <CollectionBanner />
            <CriticalOnlyBanner />
            <ApprovalWorkspace scrollRef={scrollRef} />
          </div>
        </main>
        <IntelligencePanel />
      </div>
    </AppShell>
  );
}

/** Collection sessions: the participant's instruction for this request (derived numbers only are stored). */
function CollectionBanner() {
  const collection = useSessionStore((s) => s.collection);
  const step = useSessionStore((s) => s.active?.collection ?? null);
  const stop = useSessionStore((s) => s.stopCollection);
  if (!collection) return null;
  const position = Math.min(collection.index + 1, collection.plan.length);
  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-intel/35 bg-intel/[0.06] px-4 py-3" role="status">
      <FlaskConical className="mt-0.5 size-4 shrink-0 text-intel" aria-hidden />
      <div className="min-w-0 flex-1 text-[13px]">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-intel">
          Data collection · {collection.participant} · {position} / {collection.plan.length}
          {step ? ` · ${CONDITION_NAMES[step.condition]}` : ""}
        </p>
        <p className="mt-1 text-fg/90">
          {step
            ? CONDITION_INSTRUCTIONS[step.condition]
            : "This request is not part of the plan; move on (N) to continue the session."}{" "}
          Interventions are recorded but not enforced while collecting.
        </p>
      </div>
      <Button variant="ghost" size="sm" onClick={stop}>
        Stop
      </Button>
    </div>
  );
}
