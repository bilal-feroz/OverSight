"use client";

import { useEffect } from "react";
import { MotionConfig } from "motion/react";
import { Toaster } from "sonner";
import { getGazeHub } from "@/lib/cv/gaze-hub";
import { useCvStore } from "@/lib/store/cv-store";
import { useUiStore } from "@/lib/store/ui-store";

/**
 * Client bootstrap shared by every page: restores UI preferences and the
 * session's gaze calibration, and silently resumes the camera after a reload
 * if it was already enabled and permitted (never prompts on its own).
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void useUiStore.persist.rehydrate();
    const hub = getGazeHub();
    hub.restoreCalibration();
    void hub.resumeCameraIfPermitted();
    // Development-only handle for driving the pipeline in automated UI tests (stripped from production builds).
    if (process.env.NODE_ENV === "development") {
      (window as unknown as { __oversight?: unknown }).__oversight = { hub, cvStore: useCvStore };
    }
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      {children}
      <Toaster
        theme="dark"
        position="bottom-center"
        toastOptions={{
          style: {
            background: "var(--color-surface)",
            border: "1px solid var(--color-line-strong)",
            color: "var(--color-fg)",
          },
        }}
      />
    </MotionConfig>
  );
}
