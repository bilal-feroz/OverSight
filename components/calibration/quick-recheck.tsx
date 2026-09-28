"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CalibrationCollector, getGazeHub } from "@/lib/cv/gaze-hub";
import { CV_CONFIG } from "@/lib/cv/config";
import { evaluateRecheck, type RecheckResult } from "@/lib/cv/drift";
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

const px10 = (v: number) => Math.max(10, Math.round(v / 10) * 10);

type Outcome = { kind: "applied" | "recalibrate"; result: RecheckResult } | { kind: "failed" };

/**
 * Quick recheck (about 5 s): three held-out dots measure whether the current
 * calibration still maps gaze to the right place. A constant offset that
 * explains the error is applied (capped like the click correction) and the
 * drift alarm clears; otherwise a full recalibration is recommended. Esc
 * cancels.
 */
export function QuickRecheck({ onClose }: { onClose: () => void }) {
  const points = CV_CONFIG.drift.recheck.points;
  const [index, setIndex] = useState(-1);
  const [sampling, setSampling] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const faces = useCvStore((s) => s.faceCount);
  const doneRef = useRef<HTMLButtonElement>(null);
  const [viewport] = useState(() =>
    typeof window === "undefined" ? { w: 0, h: 0 } : { w: window.innerWidth, h: window.innerHeight },
  );

  useEffect(() => {
    const hub = getGazeHub();
    const model = hub.calibration;
    const collector = new CalibrationCollector();
    const signal = { cancelled: false };
    const cfg = CV_CONFIG.drift.recheck;
    const run = async () => {
      await sleep(500, signal);
      for (let i = 0; i < points.length && !signal.cancelled; i++) {
        const [x, y] = points[i];
        collector.setPoint(cfg.groupBase + i, { x, y }, "validation");
        setIndex(i);
        setSampling(false);
        await sleep(cfg.settleMs, signal);
        if (signal.cancelled) return;
        collector.setCollecting(true);
        setSampling(true);
        await sleep(cfg.sampleMs, signal);
        collector.setCollecting(false);
      }
      if (signal.cancelled) return;
      const result = model
        ? evaluateRecheck(model, collector.validation, { width: window.innerWidth, height: window.innerHeight })
        : null;
      if (!result) setOutcome({ kind: "failed" });
      else if (result.accept) {
        hub.applyRecheck(result.offset);
        setOutcome({ kind: "applied", result });
      } else setOutcome({ kind: "recalibrate", result });
    };
    void run();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        signal.cancelled = true;
        onClose();
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

  useEffect(() => {
    if (outcome) doneRef.current?.focus();
  }, [outcome]);

  const current = index >= 0 && !outcome ? points[index] : null;
  return (
    <div
      className={cn("fixed inset-0 z-[90] select-none bg-canvas", !outcome && "cursor-none")}
      role="dialog"
      aria-modal="true"
      aria-label="Quick gaze recheck"
    >
      {!outcome ? (
        <div className="pointer-events-none absolute left-1/2 top-5 -translate-x-1/2 text-center">
          <p className="text-[13px] text-fg-muted" aria-live="polite">
            {index < 0 ? "Quick recheck: follow the dot with your eyes" : "Look at the dot."}
          </p>
          <p className="mt-1 font-mono text-[11px] text-fg-subtle">
            {index < 0 ? "starting" : `${index + 1} / ${points.length}`} · Esc to cancel
          </p>
        </div>
      ) : (
        <div className="grid h-full place-items-center p-4">
          <div className="w-full max-w-[420px] rounded-xl border border-line-strong bg-raised p-6 shadow-2xl" role="status">
            {outcome.kind === "applied" ? (
              <>
                <p className="flex items-center gap-2 text-lg font-semibold text-safe">
                  <CircleCheck className="size-5" aria-hidden /> Gaze rechecked
                </p>
                <p className="mt-2 text-[13.5px] leading-relaxed text-fg-muted">
                  A shift of about {px10(Math.hypot(outcome.result.offset.x * viewport.w, outcome.result.offset.y * viewport.h))} px
                  was corrected. Median error on the check points is now about {px10(outcome.result.correctedMedianPx)} px,
                  close to the calibration&apos;s own {px10(outcome.result.referencePx)} px.
                </p>
              </>
            ) : (
              <>
                <p className="flex items-center gap-2 text-lg font-semibold text-warn">
                  <TriangleAlert className="size-5" aria-hidden /> Recalibration recommended
                </p>
                <p className="mt-2 text-[13.5px] leading-relaxed text-fg-muted">
                  {outcome.kind === "failed"
                    ? "Too few usable frames reached the check points (face out of view?)."
                    : `Even after correcting a constant shift, median error is about ${px10(outcome.result.correctedMedianPx)} px, well above the calibration's ${px10(outcome.result.referencePx)} px.`}{" "}
                  Until you recalibrate, OverSight leans on interaction timing more.
                </p>
                <Link href="/setup#calibrate" className="mt-3 inline-block text-[13px] text-intel underline underline-offset-2">
                  Recalibrate (about 35 s)
                </Link>
              </>
            )}
            <Button ref={doneRef} variant="secondary" size="sm" className="mt-5" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      )}

      {faces !== 1 && current && (
        <p className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded-md border border-warn/40 bg-warn/10 px-3 py-1.5 text-[13px] text-warn">
          {faces > 1 ? "More than one face in view" : "Face not detected: stay in view of the camera"}
        </p>
      )}

      {current && viewport.w > 0 && (
        <div
          aria-hidden
          className="absolute size-0 transition-[left,top] duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
          style={{ left: current[0] * viewport.w, top: current[1] * viewport.h }}
        >
          <span
            key={`ring-${index}`}
            className={cn(
              "absolute left-0 top-0 size-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-intel/70 motion-reduce:transition-none",
              sampling
                ? "scale-[0.35] opacity-40 transition-[scale,opacity] ease-linear motion-reduce:scale-100"
                : "scale-100 opacity-100",
            )}
            style={{ transitionDuration: sampling ? `${CV_CONFIG.drift.recheck.sampleMs}ms` : "0ms" }}
          />
          <span className="absolute left-0 top-0 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-intel shadow-[0_0_24px_rgba(206,215,227,0.8)]" />
          <span className="absolute left-0 top-0 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-canvas" />
        </div>
      )}
    </div>
  );
}
