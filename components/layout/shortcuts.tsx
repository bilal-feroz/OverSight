"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Kbd } from "@/components/ui/misc";
import { useSessionStore } from "@/lib/store/session-store";
import { useUiStore } from "@/lib/store/ui-store";
import { isTypingTarget } from "@/lib/utils";

export const SHORTCUTS: Array<{ key: string; label: string }> = [
  { key: "N", label: "Next approval (skip)" },
  { key: "R", label: "Reset demo session (keeps calibration)" },
  { key: "O", label: "Toggle attention overlay" },
  { key: "D", label: "Toggle developer diagnostics" },
  { key: "C", label: "Camera & calibration" },
  { key: "S", label: "Session analytics" },
  { key: "?", label: "Show shortcuts" },
];

/**
 * Presenter-safe demo controller. Shortcuts only navigate and reset state;
 * none of them can produce or alter attention measurements.
 */
export function useDemoShortcuts() {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      const ui = useUiStore.getState();
      if (ui.composeOpen) return;
      const key = e.key.toLowerCase();
      if (key === "n") useSessionStore.getState().next();
      else if (key === "r") useSessionStore.getState().reset();
      else if (key === "o") ui.setOverlay(!ui.overlay);
      else if (key === "d") ui.setDiagnostics(!ui.diagnostics);
      else if (key === "c") router.push("/setup#calibrate");
      else if (key === "s") router.push("/session");
      else if (e.key === "?") ui.setShortcutsOpen(!ui.shortcutsOpen);
      else if (e.key === "Escape" && ui.shortcutsOpen) ui.setShortcutsOpen(false);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);
}

export function ShortcutsDialog() {
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-canvas/70 p-4 backdrop-blur-sm" onMouseDown={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-line-strong bg-raised p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Demo controls</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-fg-subtle hover:text-fg">
            <X className="size-4" />
          </button>
        </div>
        <ul className="space-y-2">
          {SHORTCUTS.map((s) => (
            <li key={s.key} className="flex items-center justify-between text-[13px] text-fg-muted">
              {s.label}
              <Kbd>{s.key}</Kbd>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[12px] leading-relaxed text-fg-subtle">
          Shortcuts only move between requests or reset state. They cannot create or change attention evidence.
        </p>
      </div>
    </div>
  );
}
