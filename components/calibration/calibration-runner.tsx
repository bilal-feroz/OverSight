"use client";

import { useEffect, useRef, useState } from "react";
import { MoveHorizontal, MoveVertical } from "lucide-react";
import { CalibrationCollector } from "@/lib/cv/gaze-hub";
import {
  adaptivePoints,
  adaptiveTarget,
  fitCalibration,
  headRange,
  revalidationPoints,
  type CalibrationInput,
  type FitResult,
} from "@/lib/cv/calibration";
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

type Stage = "intro" | "grid" | "sweep" | "validation" | "adaptive";

const STAGE_COPY: Record<Stage, { instruction: string; counter: string }> = {
  intro: { instruction: "Get ready: follow the dot with your eyes", counter: "starting" },
  grid: { instruction: "Look at the dot. Keep your head still.", counter: "Calibration" },
  sweep: {
    instruction: "Keep your eyes on the dot and slowly turn your head left and right, then nod.",
    counter: "Head movement",
  },
  validation: {
    instruction: "Look at the dot. These points check accuracy and are not used for calibration.",
    counter: "Accuracy check",
  },
  adaptive: { instruction: "One area was less accurate. Look at a few more dots.", counter: "Extra points" },
};

interface Dot {
  stage: Stage;
  x: number;
  y: number;
  step: number;
  total: number;
  sampling: boolean;
  sampleMs: number;
  /** Head sweep: the achieved head movement is still short of the target range. */
  more: boolean;
}

const INTRO: Dot = { stage: "intro", x: 0.5, y: 0.5, step: 0, total: 0, sampling: false, sampleMs: 0, more: false };

/**
 * Full-viewport calibration (about 35 s):
 *
 *   A   9 grid points, head still
 *   A2  head sweep: eyes on 3 dots while the head turns and nods
 *   B   5 held-out check points, never used for fitting
 *   C   optional: 2 extra points where the check was worst, then 3 new check points
 *
 * Blink frames and frames without exactly one face are skipped; a point is
 * extended if too few usable frames arrived, so a brief face loss does not
 * fail the calibration. Esc cancels; S skips the optional round.
 */
export function CalibrationRunner({
  onDone,
  onCancel,
}: {
  onDone: (result: FitResult) => void;
  onCancel: () => void;
}) {
  const [dot, setDot] = useState<Dot>(INTRO);
  const faces = useCvStore((s) => s.faceCount);
  const skipRef = useRef<() => void>(() => {});
  // Rendered only after a user action (client-side), so window is available.
  const [viewport] = useState(() =>
    typeof window === "undefined" ? { w: 0, h: 0 } : { w: window.innerWidth, h: window.innerHeight },
  );

  useEffect(() => {
    const collector = new CalibrationCollector();
    const signal = { cancelled: false };
    const adaptiveRound = { active: false, skipped: false };
    const cfg = CV_CONFIG.calibration;
    const view = { width: window.innerWidth, height: window.innerHeight };
    const display = { screen: { x: window.screenX, y: window.screenY }, dpr: window.devicePixelRatio || 1 };
    skipRef.current = () => {
      if (adaptiveRound.active) adaptiveRound.skipped = true;
    };

    const collectPoint = async (
      stage: Stage,
      index: number,
      [x, y]: readonly [number, number],
      step: number,
      total: number,
      role: "train" | "validation",
    ) => {
      collector.setPoint(index, { x, y }, role);
      setDot({ stage, x, y, step, total, sampling: false, sampleMs: cfg.sampleMs, more: false });
      await sleep(cfg.settleMs, signal);
      if (signal.cancelled) return;
      collector.setCollecting(true);
      setDot((d) => ({ ...d, sampling: true }));
      const started = performance.now();
      await sleep(cfg.sampleMs, signal);
      while (
        !signal.cancelled &&
        collector.count(index) < cfg.minFramesPerPoint &&
        performance.now() - started < cfg.sampleMs + cfg.maxExtensionMs
      ) {
        await sleep(100, signal);
      }
      collector.setCollecting(false);
    };

    const run = async () => {
      await sleep(900, signal);

      // A: 9-point grid.
      for (let i = 0; i < cfg.points.length && !signal.cancelled; i++) {
        await collectPoint("grid", i, cfg.points[i], i + 1, cfg.points.length, "train");
      }

      // A2: head sweep. Each target is its own leave-one-out group.
      const sweep = cfg.headSweep;
      let extension = sweep.maxExtensionMs;
      for (let k = 0; k < sweep.points.length && !signal.cancelled; k++) {
        const index = sweep.groupBase + k;
        const [x, y] = sweep.points[k];
        collector.setPoint(index, { x, y }, "train");
        setDot({ stage: "sweep", x, y, step: k + 1, total: sweep.points.length, sampling: false, sampleMs: sweep.sampleMs, more: false });
        await sleep(sweep.settleMs, signal);
        if (signal.cancelled) return;
        collector.setCollecting(true);
        setDot((d) => ({ ...d, sampling: true }));
        await sleep(sweep.sampleMs, signal);
        const short = () => {
          const r = headRange(collector.samplesOf(index));
          return r.yawRange < sweep.minYawRangeDeg || r.pitchRange < sweep.minPitchRangeDeg;
        };
        while (!signal.cancelled && extension > 0 && short()) {
          setDot((d) => ({ ...d, more: true }));
          await sleep(100, signal);
          extension -= 100;
        }
        collector.setCollecting(false);
      }
      if (signal.cancelled) return;
      const sweepGroups = new Set(sweep.points.map((_, k) => sweep.groupBase + k));
      const headSweep = headRange(collector.train.filter((s) => sweepGroups.has(s.pointIndex)));

      // B: held-out validation.
      const validation = cfg.validation;
      for (let k = 0; k < validation.points.length && !signal.cancelled; k++) {
        await collectPoint("validation", validation.groupBase + k, validation.points[k], k + 1, validation.points.length, "validation");
      }
      if (signal.cancelled) return;

      const input: CalibrationInput = { train: collector.train, validation: collector.validation, viewport: view, display, headSweep };
      let result = fitCalibration(input);

      // C: one optional adaptive round where the check was clearly worst.
      const worst = result.model ? adaptiveTarget(result.model.validation, view) : null;
      if (worst) {
        adaptiveRound.active = true;
        const extra = adaptivePoints(worst.target);
        const fresh = revalidationPoints(worst.target);
        const total = extra.length + fresh.length;
        for (let j = 0; j < extra.length && !signal.cancelled && !adaptiveRound.skipped; j++) {
          await collectPoint("adaptive", cfg.adaptive.groupBase + j, extra[j], j + 1, total, "train");
        }
        for (let j = 0; j < fresh.length && !signal.cancelled && !adaptiveRound.skipped; j++) {
          await collectPoint("adaptive", cfg.adaptive.revalidationGroupBase + j, fresh[j], extra.length + j + 1, total, "validation");
        }
        adaptiveRound.active = false;
        if (signal.cancelled) return;
        if (!adaptiveRound.skipped) {
          const worstIndex = validation.points.findIndex(([x, y]) => x === worst.target.x && y === worst.target.y);
          result = fitCalibration({
            ...input,
            train: collector.train,
            validation: collector.validation,
            adaptive: true,
            // The worst point chose where to add training data, so it no longer counts as independent.
            excludeValidationGroups: worstIndex >= 0 ? [validation.groupBase + worstIndex] : [],
          });
        }
      }
      if (!signal.cancelled) onDone(result);
    };
    void run();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        signal.cancelled = true;
        onCancel();
      } else if (e.key.toLowerCase() === "s" && adaptiveRound.active) {
        e.preventDefault();
        adaptiveRound.skipped = true;
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

  const copy = STAGE_COPY[dot.stage];
  const showDot = dot.stage !== "intro" && viewport.w > 0;
  return (
    <div
      className="fixed inset-0 z-[90] cursor-none select-none bg-canvas"
      role="dialog"
      aria-modal="true"
      aria-label="Gaze calibration"
    >
      <div className="pointer-events-none absolute left-1/2 top-5 w-[min(92vw,640px)] -translate-x-1/2 text-center">
        <p className="text-[13px] text-fg-muted" aria-live="polite">
          {dot.stage === "sweep" && dot.more
            ? "A little more: turn your head a bit further left and right, then nod."
            : copy.instruction}
        </p>
        {dot.stage === "sweep" && (
          <p aria-hidden className="mt-2 flex items-center justify-center gap-3 text-intel motion-reduce:hidden">
            <MoveHorizontal className="size-4 motion-safe:animate-pulse" />
            <MoveVertical className="size-4 motion-safe:animate-pulse" />
          </p>
        )}
        <p className="mt-1 font-mono text-[11px] text-fg-subtle">
          {dot.stage === "intro" ? copy.counter : `${copy.counter} ${dot.step} / ${dot.total}`} · Esc to cancel
          {dot.stage === "adaptive" ? " · S to skip" : ""}
        </p>
      </div>

      {dot.stage === "adaptive" && (
        <button
          type="button"
          onClick={() => skipRef.current()}
          className="absolute bottom-6 right-6 cursor-auto rounded-md border border-line-strong bg-raised px-3 py-1.5 text-[12.5px] text-fg-muted hover:text-fg"
        >
          Skip extra points
        </button>
      )}

      {faces !== 1 && dot.stage !== "intro" && (
        <p className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 rounded-md border border-warn/40 bg-warn/10 px-3 py-1.5 text-[13px] text-warn">
          {faces > 1 ? "More than one face in view" : "Face not detected: stay in view of the camera"}
        </p>
      )}

      {showDot && (
        <div
          aria-hidden
          className="absolute size-0 transition-[left,top] duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
          style={{ left: dot.x * viewport.w, top: dot.y * viewport.h }}
        >
          <span
            key={`ring-${dot.stage}-${dot.step}`}
            className={cn(
              "absolute left-0 top-0 size-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-intel/70 motion-reduce:transition-none",
              dot.sampling
                ? "scale-[0.35] opacity-40 transition-[scale,opacity] ease-linear motion-reduce:scale-100"
                : "scale-100 opacity-100",
            )}
            style={{ transitionDuration: dot.sampling ? `${dot.sampleMs}ms` : "0ms" }}
          />
          <span className="absolute left-0 top-0 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-intel shadow-[0_0_24px_rgba(206,215,227,0.8)]" />
          <span className="absolute left-0 top-0 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-canvas" />
        </div>
      )}
    </div>
  );
}
