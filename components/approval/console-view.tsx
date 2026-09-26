"use client";

import { useRef } from "react";
import { FlaskConical } from "lucide-react";
import { IntelligencePanel } from "@/components/attention/intelligence-panel";
import { AppShell } from "@/components/layout/app-shell";
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
            <LabelingBanner />
            <CriticalOnlyBanner />
            <ApprovalWorkspace scrollRef={scrollRef} />
          </div>
        </main>
        <IntelligencePanel />
      </div>
    </AppShell>
  );
}

function LabelingBanner() {
  const labeling = useSessionStore((s) => s.labeling);
  const label = useSessionStore((s) => s.active?.label);
  if (!labeling || !label) return null;
  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-intel/35 bg-intel/[0.06] px-4 py-3" role="status">
      <FlaskConical className="mt-0.5 size-4 shrink-0 text-intel" aria-hidden />
      <div className="text-[13px]">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-intel">
          Data collection · label: {label === "ATTENTIVE" ? "attentive" : "low attention"}
        </p>
        <p className="mt-1 text-fg/90">
          {label === "ATTENTIVE"
            ? "Review this request the way you normally would when it matters, then decide."
            : "Glance at the title only and approve quickly, as a rushed reviewer would."}{" "}
          Interventions are recorded but not enforced while collecting.
        </p>
      </div>
    </div>
  );
}
