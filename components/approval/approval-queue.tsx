"use client";

import { Check, Circle, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSessionStore } from "@/lib/store/session-store";
import { useUiStore } from "@/lib/store/ui-store";
import { cn } from "@/lib/utils";

export function ApprovalQueue() {
  const queue = useSessionStore((s) => s.queue);
  const activeId = useSessionStore((s) => s.active?.itemId);
  const select = useSessionStore((s) => s.select);
  const setComposeOpen = useUiStore((s) => s.setComposeOpen);
  const done = queue.filter((q) => q.status !== "pending").length;

  return (
    <nav aria-label="Approval queue" className="hidden w-[250px] shrink-0 flex-col border-r border-line bg-base xl:flex">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <span className="eyebrow">Approval queue</span>
        <span className="font-mono text-[11px] tabular text-fg-subtle">
          {done}/{queue.length}
        </span>
      </div>
      <ol className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {queue.map((q, i) => {
          const current = q.id === activeId;
          return (
            <li key={q.id}>
              <button
                type="button"
                onClick={() => select(q.id)}
                aria-current={current ? "true" : undefined}
                aria-label={`Request ${i + 1}: ${q.request.title}, from ${q.request.agent.name}, ${q.status}`}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                  current ? "bg-surface" : "hover:bg-raised",
                )}
              >
                <span className="mt-0.5 grid size-4 shrink-0 place-items-center" aria-hidden>
                  {q.status === "approved" ? (
                    <Check className="size-3.5 text-safe" />
                  ) : q.status === "rejected" ? (
                    <X className="size-3.5 text-fg-subtle" />
                  ) : current ? (
                    <span className="size-2 rounded-full bg-intel" />
                  ) : (
                    <Circle className="size-3 text-fg-subtle" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className={cn("block truncate text-[13px]", current ? "text-fg" : "text-fg-muted")}>
                    {q.request.title}
                  </span>
                  <span className="block truncate font-mono text-[10.5px] text-fg-subtle">
                    #{i + 1} · {q.request.agent.name}
                    <span className="sr-only"> · {q.status}</span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="border-t border-line p-3">
        <Button variant="secondary" size="sm" className="w-full" onClick={() => setComposeOpen(true)}>
          <Plus aria-hidden /> Analyze a custom request
        </Button>
      </div>
    </nav>
  );
}
