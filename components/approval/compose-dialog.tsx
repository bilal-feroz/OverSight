"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CUSTOM_EXAMPLES, parseCustomRequest } from "@/lib/semantic/parser";
import { useSessionStore } from "@/lib/store/session-store";
import { useUiStore } from "@/lib/store/ui-store";

/**
 * Paste any proposed agent action. The same semantic analyzer (AI if
 * configured, deterministic rules otherwise) finds the decision-critical
 * sentences, and the request joins the queue with live attention regions.
 */
export function ComposeDialog() {
  const open = useUiStore((s) => s.composeOpen);
  const setOpen = useUiStore((s) => s.setComposeOpen);
  const addCustom = useSessionStore((s) => s.addCustom);
  const [title, setTitle] = useState("");
  const [agent, setAgent] = useState("");
  const [environment, setEnvironment] = useState("production");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    firstField.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    const request = parseCustomRequest({ title, agentName: agent, environment, body });
    setOpen(false);
    await addCustom(request);
    setBusy(false);
    setTitle("");
    setBody("");
  };

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-canvas/80 p-4 backdrop-blur-sm" onMouseDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-[620px] rounded-xl border border-line-strong bg-raised shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 id={titleId} className="text-[15px] font-semibold">
            Analyze a custom approval request
          </h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-fg-subtle hover:text-fg">
            <X className="size-4" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3 px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
            <Field label="Action title">
              <input ref={firstField} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional" className={inputClass} />
            </Field>
            <Field label="Agent">
              <input value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="External agent" className={inputClass} />
            </Field>
            <Field label="Environment">
              <input value={environment} onChange={(e) => setEnvironment(e.target.value)} className={inputClass} />
            </Field>
          </div>
          <Field label="Proposed action (one consequence per line works best)">
            <textarea
              required
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder={"Summary sentence first.\n- Detail or consequence\n- setting: old -> new"}
              className={`${inputClass} h-auto py-2 leading-relaxed`}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-subtle">
            Examples:
            {CUSTOM_EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                type="button"
                onClick={() => {
                  setTitle(ex.input.title ?? "");
                  setAgent(ex.input.agentName ?? "");
                  setEnvironment(ex.input.environment ?? "");
                  setBody(ex.input.body);
                }}
                className="rounded-md border border-line px-2 py-0.5 text-fg-muted hover:border-line-strong hover:text-fg"
              >
                {ex.label}
              </button>
            ))}
          </div>
          <p className="text-[12px] text-fg-subtle">
            Only this text is analyzed. With an AI provider configured it is sent to that provider; otherwise the
            deterministic rule engine runs locally.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !body.trim()}>
              Analyze and queue
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputClass =
  "block h-9 w-full rounded-md border border-line-strong bg-canvas px-3 text-[13.5px] text-fg outline-none placeholder:text-fg-subtle focus:border-intel";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] text-fg-muted">{label}</span>
      {children}
    </label>
  );
}
