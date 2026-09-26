"use client";

import { useEffect, useRef } from "react";
import { reviewController } from "@/lib/attention/review-controller";
import { regionRegistry } from "@/lib/attention/registry";
import { useLiveStore } from "@/lib/store/live-store";
import { formatPct } from "@/lib/utils";

/**
 * Judge-facing visualization over the approval card: soft gaze heatmap
 * (from derived gaze samples, not video), critical-region outlines with live
 * coverage, and the share of review attention per area.
 */
export function AttentionOverlay({ cardRef }: { cardRef: React.RefObject<HTMLElement | null> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const distribution = useLiveStore((s) => s.distribution);
  const coverage = useLiveStore((s) => s.coverage);
  const gazeActive = useLiveStore((s) => s.gazeActive);

  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      const card = cardRef.current;
      const session = reviewController.session;
      if (!canvas || !card) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = card.offsetWidth;
      const h = card.offsetHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!session) return;

      // Heat: additive radial blobs per derived gaze sample.
      const margin = session.gazeMarginPx;
      const radius = Math.max(34, Math.min(80, (margin.x + margin.y) * 0.9));
      ctx.globalCompositeOperation = "lighter";
      for (const s of session.gazeSamples) {
        if (!s.onCard) continue;
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, radius);
        g.addColorStop(0, "rgba(206,215,227,0.10)");
        g.addColorStop(1, "rgba(206,215,227,0)");
        ctx.fillStyle = g;
        ctx.fillRect(s.x - radius, s.y - radius, radius * 2, radius * 2);
      }
      ctx.globalCompositeOperation = "source-over";

      // Critical region outlines.
      const cardRect = card.getBoundingClientRect();
      const live = useLiveStore.getState();
      for (const id of session.targetIds) {
        const region = regionRegistry.get(id, session.approvalId);
        if (!region) continue;
        const r = region.el.getBoundingClientRect();
        const x = r.left - cardRect.left - 4;
        const y = r.top - cardRect.top - 4;
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(217,105,78,0.9)";
        ctx.strokeRect(x, y, r.width + 8, r.height + 8);
        ctx.setLineDash([]);
        const t = live.targets.find((tt) => tt.id === id);
        const pct = t ? Math.round(Math.min(1, t.dwellMs / Math.max(1, t.requiredDwellMs)) * 100) : 0;
        const label = `CRITICAL · ${pct}% COVERAGE`;
        ctx.font = "600 10px ui-monospace, monospace";
        const tw = ctx.measureText(label).width + 12;
        ctx.fillStyle = "rgba(217,105,78,0.95)";
        ctx.fillRect(x, y - 16, tw, 16);
        ctx.fillStyle = "#141312";
        ctx.fillText(label, x + 6, y - 5);
      }
    };
    const timer = window.setInterval(draw, 140);
    draw();
    return () => window.clearInterval(timer);
  }, [cardRef]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden>
      <canvas ref={canvasRef} className="absolute left-0 top-0" />
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
