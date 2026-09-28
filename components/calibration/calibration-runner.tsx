"use client";

import { useEffect, useState } from "react";
import { CalibrationCollector } from "@/lib/cv/gaze-hub";
import { fitCalibration, type FitResult } from "@/lib/cv/calibration";
import { CV_CONFIG } from "@/lib/cv/config";
import { useCvStore } from "@/lib/store/cv-store";
import { cn } from "@/lib/utils";

function sleep(ms: number, signal: { cancelled: boolean }) {
  return new Promise<void>((resolve) => {
    const t = window.setTimeout(resolve, ms);
    if (signal.cancelled) {
      window.clearTimeout(t);
      resolve();
    }
  });
}

/**
 * Full-viewport, 9-point calibration (~15 s). Each target is shown, the eyes
 * get time to settle, then eye/head features are sampled. Blink frames and
 * frames without exactly one face are skipped; a point is extended if too
 * few usable frames arrived.
 */
export function CalibrationRunner({
  onDone,
  onCancel,
}: {
  onDone: (result: FitResult) => void;
  onCancel: () => void;
}) {
  const points = CV_CONFIG.calibration.points;
  const [index, setIndex] = useState(-1);
  const [sampling, setSampling] = useState(false);
  const faces = useCvStore((s) => s.faceCount);
  // Rendered only after a user action (client-side), so window is available.
  const [viewport] = useState(() =>
    typeof window === "undefined" ? { w: 0, h: 0 } : { w: window.innerWidth, h: window.innerHeight },
  );

  useEffect(() => {
    const collector = new CalibrationCollector();
    const signal = { cancelled: false };
    const cfg = CV_CONFIG.calibration;

    const run = async () => {
      await sleep(900, signal);
      for (let i = 0; i < points.length; i++) {
        if (signal.cancelled) return;
        const [x, y] = points[i];
        collector.setPoint(i, { x, y });
        setIndex(i);
        setSampling(false);
        await sleep(cfg.settleMs, signal);
        if (signal.cancelled) return;
        collector.setCollecting(true);
        setSampling(true);
        const started = performance.now();
        await sleep(cfg.sampleMs, signal);
        while (
          !signal.cancelled &&
          collector.count(i) < cfg.minFramesPerPoint &&
          performance.now() - started < cfg.sampleMs + cfg.maxExtensionMs
        ) {
          await sleep(100, signal);
        }
        collector.setCollecting(false);
      }
      if (signal.cancelled) return;
      onDone(
        fitCalibration(
          collector.samples,
          { width: window.innerWidth, height: window.innerHeight },
          { screen: { x: window.screenX, y: window.screenY }, dpr: window.devicePixelRatio || 1 },
        ),
      );
    };
    void run();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        signal.cancelled = true;
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      signal.cancelled = true;
      collector.dispose();
      window.removeEventListener("keydown", onKey);
    };
    // Run exactly once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = index >= 0 ? points[index] : null;
  return (
    <div
      className="fixed inset-0 z-[90] cursor-none select-none bg-canvas"
      role="dialog"
      aria-modal="true"
      aria-label="Gaze calibration"
    >
      <div className="pointer-events-none absolute left-1/2 top-5 -translate-x-1/2 text-center">
        <p className="text-[13px] text-fg-muted">
          {index < 0 ? "Get ready: follow the dot with your eyes" : "Look at the dot. Keep your head still."}
        </p>
        <p className="mt-1 font-mono text-[11px] text-fg-subtle">
          {index < 0 ? "starting" : `${index + 1} / ${points.length}`} · Esc to cancel
        </p>
      </div>

      {faces !== 1 && index >= 0 && (
        <p className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded-md border border-warn/40 bg-warn/10 px-3 py-1.5 text-[13px] text-warn">
          {faces > 1 ? "More than one face in view" : "Face not detected: stay in view of the camera"}
        </p>
      )}

      {current && viewport.w > 0 && (
        <div
          aria-hidden
          className="absolute size-0 transition-[left,top] duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
          style={{ left: current[0] * viewport.w, top: current[1] * viewport.h }}
        >
          <span
            key={`ring-${index}`}
            className={cn(
              "absolute left-0 top-0 size-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-intel/70",
              sampling ? "scale-[0.35] opacity-40 transition-[scale,opacity] ease-linear" : "scale-100 opacity-100",
            )}
            style={{ transitionDuration: sampling ? `${CV_CONFIG.calibration.sampleMs}ms` : "0ms" }}
          />
          <span className="absolute left-0 top-0 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-intel shadow-[0_0_24px_rgba(206,215,227,0.8)]" />
          <span className="absolute left-0 top-0 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-canvas" />
        </div>
      )}
    </div>
  );
}
