"use client";

import { useEffect, useRef } from "react";
import { reviewController } from "@/lib/attention/review-controller";
import { regionRegistry } from "@/lib/attention/registry";
import type { ReviewSession } from "@/lib/attention/tracker";
import { heatmapPlan, type HeatmapState } from "@/lib/cv/perf";
import { useCvStore } from "@/lib/store/cv-store";
import { useLiveStore } from "@/lib/store/live-store";
import { formatPct } from "@/lib/utils";

const TICK_MS = 140;
/** Draw times are reported to diagnostics once a second, not every tick. */
const REPORT_MS = 1000;

/** One pre-rendered heat blob: radius in CSS px, pixels at device resolution. */
function blobSprite(radius: number, dpr: number): HTMLCanvasElement {
  const size = Math.max(2, Math.ceil(radius * 2 * dpr));
  const sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;
  const ctx = sprite.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(206,215,227,0.10)");
    g.addColorStop(1, "rgba(206,215,227,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return sprite;
}

/** Sizes a canvas to the card; resizing also clears it. */
function fit(canvas: HTMLCanvasElement, w: number, h: number, pw: number, ph: number) {
  if (canvas.width === pw && canvas.height === ph) return;
  canvas.width = pw;
  canvas.height = ph;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
}

/**
 * Judge-facing visualization over the approval card: soft gaze heatmap
 * (from derived gaze samples, not video), critical-region outlines with live
 * coverage, and the share of review attention per area.
 *
 * The heatmap accumulates: each tick stamps a pre-rendered blob for the new
 * samples only, and everything is redrawn only when the card is resized or a
 * new review starts. Outlines and labels live on a second, cheap layer.
 */
export function AttentionOverlay({ cardRef }: { cardRef: React.RefObject<HTMLElement | null> }) {
  const heatRef = useRef<HTMLCanvasElement>(null);
  const marksRef = useRef<HTMLCanvasElement>(null);
  const distribution = useLiveStore((s) => s.distribution);
  const coverage = useLiveStore((s) => s.coverage);
  const gazeActive = useLiveStore((s) => s.gazeActive);

  useEffect(() => {
    let heatState: HeatmapState | null = null;
    let sprite: { key: string; canvas: HTMLCanvasElement } | null = null;
    let lastSession: ReviewSession | null = null;
    let serial = 0;
    let drawTimes: number[] = [];
    let lastReport = performance.now();

    const report = (now: number) => {
      if (now - lastReport < REPORT_MS || drawTimes.length === 0) return;
      lastReport = now;
      const mean = drawTimes.reduce((a, b) => a + b, 0) / drawTimes.length;
      useCvStore.setState({ overlayDrawMs: { mean, max: Math.max(...drawTimes) } });
      drawTimes = [];
    };

    const draw = () => {
      const heat = heatRef.current;
      const marks = marksRef.current;
      const card = cardRef.current;
      if (!heat || !marks || !card) return;
      const started = performance.now();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = card.offsetWidth;
      const h = card.offsetHeight;
      const pw = Math.round(w * dpr);
      const ph = Math.round(h * dpr);
      fit(heat, w, h, pw, ph);
      fit(marks, w, h, pw, ph);
      const hctx = heat.getContext("2d");
      const mctx = marks.getContext("2d");
      if (!hctx || !mctx) return;
      mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.clearRect(0, 0, pw, ph);

      const session = reviewController.session;
      if (!session) {
        if (heatState) {
          hctx.setTransform(1, 0, 0, 1, 0, 0);
          hctx.clearRect(0, 0, pw, ph);
        }
        heatState = null;
        lastSession = null;
        return;
      }
      if (session !== lastSession) {
        lastSession = session;
        serial++;
      }

      // Heat: additive blobs, only for samples not drawn yet.
      const margin = session.gazeMarginPx;
      const radius = Math.max(34, Math.min(80, (margin.x + margin.y) * 0.9));
      const samples = session.gazeSamples;
      const key = `${serial}:${radius.toFixed(1)}:${dpr}`;
      const plan = heatmapPlan(heatState, { key, width: pw, height: ph, count: samples.length });
      if (plan.reset) {
        hctx.setTransform(1, 0, 0, 1, 0, 0);
        hctx.clearRect(0, 0, pw, ph);
      }
      if (plan.to > plan.from) {
        const spriteKey = `${radius.toFixed(1)}:${dpr}`;
        if (!sprite || sprite.key !== spriteKey) sprite = { key: spriteKey, canvas: blobSprite(radius, dpr) };
        hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        hctx.globalCompositeOperation = "lighter";
        for (let i = plan.from; i < plan.to; i++) {
          const s = samples[i];
          if (s.onCard) hctx.drawImage(sprite.canvas, s.x - radius, s.y - radius, radius * 2, radius * 2);
        }
        hctx.globalCompositeOperation = "source-over";
      }
      heatState = { key, width: pw, height: ph, drawn: plan.to };

      // Critical region outlines and live coverage labels.
      mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cardRect = card.getBoundingClientRect();
      const live = useLiveStore.getState();
      mctx.font = "600 10px ui-monospace, monospace";
      for (const id of session.targetIds) {
        const region = regionRegistry.get(id, session.approvalId);
        if (!region) continue;
        const r = region.el.getBoundingClientRect();
        const x = r.left - cardRect.left - 4;
        const y = r.top - cardRect.top - 4;
        mctx.setLineDash([6, 4]);
        mctx.lineWidth = 1.5;
        mctx.strokeStyle = "rgba(217,105,78,0.9)";
        mctx.strokeRect(x, y, r.width + 8, r.height + 8);
        mctx.setLineDash([]);
        const t = live.targets.find((tt) => tt.id === id);
        const pct = t ? Math.round(Math.min(1, t.dwellMs / Math.max(1, t.requiredDwellMs)) * 100) : 0;
        const label = `CRITICAL · ${pct}% COVERAGE`;
        const tw = mctx.measureText(label).width + 12;
        mctx.fillStyle = "rgba(217,105,78,0.95)";
        mctx.fillRect(x, y - 16, tw, 16);
        mctx.fillStyle = "#141312";
        mctx.fillText(label, x + 6, y - 5);
      }

      const now = performance.now();
      drawTimes.push(now - started);
      report(now);
    };

    const timer = window.setInterval(draw, TICK_MS);
    draw();
    return () => {
      window.clearInterval(timer);
      useCvStore.setState({ overlayDrawMs: null });
    };
  }, [cardRef]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden>
      <canvas ref={heatRef} className="absolute left-0 top-0" />
      <canvas ref={marksRef} className="absolute left-0 top-0" />
      <div className="absolute right-3 top-3 w-[230px] rounded-lg border border-line-strong bg-canvas/90 p-3 font-mono text-[11px] text-fg-muted shadow-xl backdrop-blur">
        <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-intel">
          <span>Observed attention</span>
          <span className={gazeActive ? "text-safe" : "text-fg-subtle"}>{gazeActive ? "live" : "no gaze"}</span>
        </div>
        <Row label="Critical coverage" value={coverage === null ? "n/a" : formatPct(coverage)} strong />
        <Row label="Gaze on critical" value={formatPct(distribution.critical)} />
        <Row label="Gaze on other content" value={formatPct(distribution.other)} />
        <Row label="Gaze off request" value={formatPct(distribution.offCard)} />
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span>{label}</span>
      <span className={strong ? "text-fg" : "text-fg-muted"}>{value}</span>
    </div>
  );
}
