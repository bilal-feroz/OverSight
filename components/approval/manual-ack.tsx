"use client";

import { useId, useState } from "react";
import { CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { manualAckToken } from "@/lib/attention/rereview";
import { useSessionStore } from "@/lib/store/session-store";

/**
 * Camera-free acknowledgement. Accessibility fallback and the path used
 * whenever gaze evidence is unavailable: the reviewer restates the key
 * quantity of the consequence (or explicitly confirms it when it has none).
 */
export function ManualAck({ statement, satisfied }: { statement: string; satisfied: boolean }) {
  const acknowledge = useSessionStore((s) => s.acknowledgeManual);
  const token = manualAckToken(statement);
  const [typed, setTyped] = useState("");
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const inputId = useId();
  const errorId = useId();

  if (satisfied) {
    return (
      <p className="flex items-center gap-2 text-sm font-medium text-safe" role="status">
        <CircleCheck className="size-4" aria-hidden /> Critical consequence acknowledged
      </p>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const ok = acknowledge({ typed, checked, expectedToken: token });
    setAttempts((a) => a + 1);
    // The number is revealed only after repeated misses: acknowledging should require reading the consequence.
    setError(
      ok
        ? null
        : token
          ? attempts >= 1
            ? `Type ${token} exactly as it appears in the consequence.`
            : "That does not match the number in the consequence. Read it again."
          : "Confirm the statement to continue.",
    );
  };

  return (
    <form onSubmit={submit} className="rounded-lg border border-line-strong bg-surface p-4">
      <div className="eyebrow mb-2">Manual acknowledgement</div>
      {token ? (
        <label htmlFor={inputId} className="block text-sm text-fg-muted">
          Type the number stated in the consequence to confirm you reviewed it.
          <input
            id={inputId}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            inputMode="numeric"
            autoComplete="off"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            className="mt-2 block h-9 w-44 rounded-md border border-line-strong bg-canvas px-3 font-mono text-sm text-fg outline-none focus:border-intel"
          />
        </label>
      ) : (
        <label className="flex items-start gap-2 text-sm text-fg-muted">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--color-intel)]"
          />
          I have read and understand the consequence: “{statement}”
        </label>
      )}
      {error && (
        <p id={errorId} className="mt-2 text-xs text-critical">
          {error}
        </p>
      )}
      <Button type="submit" variant="secondary" size="sm" className="mt-3">
        Acknowledge consequence
      </Button>
    </form>
  );
}
