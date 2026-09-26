"use client";

import { useEffect } from "react";
import { DiagnosticsPanel } from "@/components/attention/diagnostics-panel";
import { GazeCursor } from "@/components/attention/gaze-cursor";
import { ComposeDialog } from "@/components/approval/compose-dialog";
import { useSessionStore } from "@/lib/store/session-store";
import { useUiStore } from "@/lib/store/ui-store";
import { AppHeader } from "./app-header";
import { ShortcutsDialog, useDemoShortcuts } from "./shortcuts";
import { SignalBanner } from "./signal-banner";

/** Chrome shared by Console, Session and Model lab. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const init = useSessionStore((s) => s.init);
  const diagnostics = useUiStore((s) => s.diagnostics);
  const overlay = useUiStore((s) => s.overlay);
  useDemoShortcuts();

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:min-h-0">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded-md focus:bg-fg focus:px-3 focus:py-2 focus:text-canvas"
      >
        Skip to content
      </a>
      <AppHeader />
      <SignalBanner />
      {children}
      {diagnostics && <DiagnosticsPanel />}
      {diagnostics ? <GazeCursor variant="debug" /> : overlay ? <GazeCursor variant="soft" /> : null}
      <ComposeDialog />
      <ShortcutsDialog />
    </div>
  );
}
