"use client";

import { useId } from "react";
import type { ReviewSnapshot } from "@/types/attention";
import { cn } from "@/lib/utils";

/**
 * Wireframe of the approval card as it was when Approve was clicked, with
 * the derived gaze samples as a heatmap. Shows at a glance where review
 * attention went and whether the critical region received any.
 */
export function EvidenceMap({
  snapshot,
  targetCoverage,
  className,
}: {
  snapshot: ReviewSnapshot;
  targetCoverage: { id: string; coverage: number }[];
  className?: string;
}) {
  const filterId = useId().replace(/:/g, "");
  const { width, height } = snapshot.cardSize;
  if (!width || !height) {
    return (
      <div className={cn("rounded-lg border border-line p-4 text-xs text-fg-muted", className)}>
        No layout captured for this review.
      </div>
    );
  }
  const coverage = new Map(targetCoverage.map((t) => [t.id, t.coverage]));
  const onCard = snapshot.gazeSamples.filter((s) => s.onCard);
  const regions = Object.entries(snapshot.regionRects);
  const radius = Math.max(40, Math.min(80, ((snapshot.gazeSigmaPx?.x ?? 60) + (snapshot.gazeSigmaPx?.y ?? 60)) * 0.3));

  return (
    <figure className={cn("m-0", className)}>
      <svg
        viewBox={`0 0 ${Math.round(width)} ${Math.round(height)}`}
        className="h-auto w-full rounded-lg border border-line bg-canvas"
        role="img"
        aria-label={`Attention evidence: ${onCard.length} gaze samples on the request; critical region coverage ${targetCoverage
          .map((t) => `${Math.round(t.coverage * 100)}%`)
          .join(", ")}.`}
      >
        <defs>
          <filter id={`blur-${filterId}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation={radius * 0.45} />
          </filter>
        </defs>
        {regions.map(([id, r]) => {
          const isTarget = coverage.has(id);
          return (
            <rect
              key={id}
              x={r.left}
              y={r.top}
              width={r.width}
              height={r.height}
              rx={6}
              fill={isTarget ? "rgba(217,105,78,0.10)" : "rgba(181,174,159,0.10)"}
              stroke={isTarget ? "rgba(217,105,78,0.95)" : "rgba(181,174,159,0.18)"}
              strokeWidth={isTarget ? 3 : 1}
              strokeDasharray={isTarget ? "10 6" : undefined}
            />
          );
        })}
        <g filter={`url(#blur-${filterId})`}>
          {onCard.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={radius * 0.55} fill="rgba(206,215,227,0.22)" />
          ))}
        </g>
        {regions
          .filter(([id]) => coverage.has(id))
          .map(([id, r]) => {
            const label = `CRITICAL · ${Math.round((coverage.get(id) ?? 0) * 100)}%`;
            const fontSize = Math.max(22, width / 24);
            return (
              <g key={`label-${id}`}>
                <rect
                  x={r.left}
                  y={Math.max(0, r.top - fontSize * 1.6)}
                  width={label.length * fontSize * 0.62 + 16}
                  height={fontSize * 1.45}
                  rx={4}
                  fill="rgba(217,105,78,0.95)"
                />
                <text
                  x={r.left + 8}
                  y={Math.max(0, r.top - fontSize * 1.6) + fontSize * 1.05}
                  fontSize={fontSize}
                  fontFamily="ui-monospace, monospace"
                  fontWeight={700}
                  fill="#141312"
                >
                  {label}
                </text>
              </g>
            );
          })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-fg-subtle">
        {targetCoverage.map((t) => (
          <span key={t.id} className="w-full font-mono text-[12px] text-critical">
            Critical region coverage: {Math.round(t.coverage * 100)}%
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-intel/80" /> Gaze estimate (derived, on-device)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm border border-dashed border-critical" /> Decision-critical region
        </span>
      </figcaption>
    </figure>
  );
}
