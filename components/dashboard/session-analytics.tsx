"use client";

import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { LabelProps } from "recharts";
import { Download, OctagonAlert, RotateCcw, TriangleAlert } from "lucide-react";
import type { ApprovalRecord, InterventionLevel } from "@/types/attention";
import { AppShell } from "@/components/layout/app-shell";
import { InterventionBadge, RiskBadge } from "@/components/approval/risk-badge";
import { ReasonIcon } from "@/components/approval/pause-view";
import { Button } from "@/components/ui/button";
import { Stat } from "@/components/ui/misc";
import { ATTENTION_CONFIG } from "@/lib/attention/config";
import { median } from "@/lib/math/stats";
import { INTERVENTION_DESCRIPTION } from "@/lib/risk/levels";
import { useSessionStore } from "@/lib/store/session-store";
import { cn, formatPct } from "@/lib/utils";

interface Datum {
  n: number;
  label: string;
  title: string;
  score: number;
  coverage: number | null;
  ratio: number;
  latency: number;
  expected: number;
  level: InterventionLevel;
  outcome: string;
  mode: string;
}

const AXIS = { stroke: "#45403d", fontSize: 11, fill: "#b5ae9f" };
const STATUS_FILL: Record<InterventionLevel, string> = {
  NORMAL: "#7fa89c",
  NUDGE: "#d8b163",
  REFOCUS: "#d8b163",
  PAUSE: "#d9694e",
};

function toData(records: ApprovalRecord[]): Datum[] {
  return records.map((r, i) => ({
    n: i + 1,
    label: `#${i + 1}`,
    title: r.title,
    score: Math.round(r.attentionScore * 100),
    coverage: r.criticalCoverage === null ? null : Math.round(r.criticalCoverage * 100),
    ratio: Math.round(Math.min(2, r.latencyRatio) * 100),
    latency: r.latencyMs / 1000,
    expected: r.expectedLatencyMs / 1000,
    level: r.intervention,
    outcome: r.outcome.replace(/_/g, " "),
    mode: r.mode,
  }));
}

export function SessionAnalytics() {
  const records = useSessionStore((s) => s.records);
  const pattern = useSessionStore((s) => s.pattern);
  const baseline = useSessionStore((s) => s.baseline);
  const criticalOnly = useSessionStore((s) => s.criticalOnly);
  const reset = useSessionStore((s) => s.reset);
  const data = toData(records);

  const interventions = records.filter((r) => r.intervention === "REFOCUS" || r.intervention === "PAUSE");
  const coverageValues = records.map((r) => r.criticalCoverage).filter((v): v is number => v !== null);
  const maxStreak = records.reduce(
    (acc, r) => {
      const cur = r.latencyRatio < ATTENTION_CONFIG.latency.rapidRatio ? acc.cur + 1 : 0;
      return { cur, max: Math.max(acc.max, cur) };
    },
    { cur: 0, max: 0 },
  ).max;
  const lastSensitivity = records[records.length - 1]?.sensitivity ?? 1;

  const exportJson = () => {
    const blob = new Blob(
      [JSON.stringify({ kind: "oversight-session", exportedAt: new Date().toISOString(), records }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `oversight-session-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell>
      <main id="main" className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1180px] px-5 py-8 md:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="eyebrow">Session analytics</div>
              <h1 className="mt-2 text-[30px] font-semibold tracking-[-0.02em]">Review attention across approvals</h1>
              <p className="mt-2 max-w-[74ch] text-[14px] leading-relaxed text-fg-muted">
                How visual attention to decision-critical content changed across this session. This view exists to
                explain OverSight&apos;s decisions. It is not a productivity or performance measure, and it says nothing
                about how tired anyone is.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={exportJson} disabled={!records.length}>
                <Download aria-hidden /> Export derived data
              </Button>
              <Button variant="ghost" size="sm" onClick={reset}>
                <RotateCcw aria-hidden /> Reset
              </Button>
            </div>
          </div>

          {records.length === 0 ? (
            <div className="mt-8 rounded-xl border border-line bg-raised px-6 py-14 text-center">
              <p className="text-[15px] text-fg">No decisions recorded yet.</p>
              <p className="mt-1 text-[13px] text-fg-muted">Review a few requests in the console; the trend builds here.</p>
              <Link href="/console" className="mt-5 inline-block">
                <Button variant="primary">Open console</Button>
              </Link>
            </div>
          ) : (
            <>
              {pattern.detected ? (
                <div className="mt-6 flex items-start gap-3 rounded-xl border border-critical/40 bg-critical/[0.06] px-5 py-4" role="status">
                  <OctagonAlert className="mt-0.5 size-5 shrink-0 text-critical" aria-hidden />
                  <div>
                    <p className="font-mono text-[12px] font-semibold uppercase tracking-[0.18em] text-critical">
                      Attention degradation detected
                    </p>
                    <p className="mt-1 text-[16px] font-medium text-fg">{pattern.message}</p>
                    <p className="mt-1 text-[13px] text-fg-muted">
                      A pattern in review behavior, not a judgement about the reviewer. Intervention sensitivity is{" "}
                      {lastSensitivity.toFixed(2)}×
                      {criticalOnly ? " and critical-only review mode is on." : "."}
                    </p>
                  </div>
                </div>
              ) : pattern.status === "declining" ? (
                <div className="mt-6 flex items-start gap-3 rounded-xl border border-warn/35 bg-warn/[0.06] px-5 py-4" role="status">
                  <TriangleAlert className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
                  <p className="text-[14px] text-fg">{pattern.message}</p>
                </div>
              ) : null}

              <section aria-label="Key figures" className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <Stat label="Decisions" value={records.length} hint={`${records.filter((r) => r.outcome.startsWith("rejected")).length} rejected`} />
                <Stat
                  label="Interventions"
                  value={interventions.length}
                  hint={`${records.filter((r) => r.intervention === "PAUSE").length} paused · ${records.filter((r) => r.intervention === "REFOCUS").length} refocused`}
                />
                <Stat label="Median review time" value={`${(median(records.map((r) => r.latencyMs)) / 1000).toFixed(1)} s`} hint={baseline.source === "personal" ? "vs personal baseline" : "baseline pending"} />
                <Stat label="Mean critical coverage" value={coverageValues.length ? formatPct(coverageValues.reduce((a, b) => a + b, 0) / coverageValues.length) : "n/a"} hint={`${coverageValues.length} with gaze evidence`} />
                <Stat label="Longest rapid streak" value={maxStreak} hint={`< ${Math.round(ATTENTION_CONFIG.latency.rapidRatio * 100)}% of expected time`} />
                <Stat
                  label="Pattern"
                  value={<span className={cn(pattern.detected ? "text-critical" : pattern.status === "declining" ? "text-warn" : "text-fg")}>{pattern.status === "degradation" ? "Degrading" : pattern.status === "declining" ? "Declining" : pattern.status === "stable" ? "Stable" : "Building"}</span>}
                  hint={`strength ${formatPct(pattern.fatigueScore)}`}
                />
              </section>

              <ChartCard
                title="Attention evidence per approval"
                subtitle="Deterministic attention score (0 to 100). Status markers show where OverSight intervened."
                className="mt-4"
              >
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={data} margin={{ top: 28, right: 8, left: -12, bottom: 0 }} barCategoryGap="28%">
                    <CartesianGrid vertical={false} stroke="#2c2927" />
                    <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#45403d" }} tick={AXIS} />
                    <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickLine={false} axisLine={false} tick={AXIS} width={44} />
                    <Tooltip cursor={{ fill: "rgba(181,174,159,0.06)" }} content={(p) => <ChartTooltip active={p.active} payload={p.payload} kind="score" />} />
                    <Bar dataKey="score" radius={[4, 4, 0, 0]} maxBarSize={24} fill="#ced7e3" isAnimationActive={false}>
                      {data.map((d) => (
                        <Cell key={d.n} fill={d.level === "NORMAL" ? "#ced7e3" : STATUS_FILL[d.level]} fillOpacity={d.level === "NORMAL" ? 0.85 : 1} />
                      ))}
                      <LabelList dataKey="score" content={(p) => <CapLabel {...p} data={data} />} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <Legend />
              </ChartCard>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <ChartCard title="Critical-region coverage" subtitle="Gaze dwell on decision-critical content vs. required dwell.">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={data} margin={{ top: 12, right: 8, left: -12, bottom: 0 }} barCategoryGap="28%">
                      <CartesianGrid vertical={false} stroke="#2c2927" />
                      <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#45403d" }} tick={AXIS} />
                      <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tickLine={false} axisLine={false} tick={AXIS} width={44} unit="%" />
                      <Tooltip cursor={{ fill: "rgba(181,174,159,0.06)" }} content={(p) => <ChartTooltip active={p.active} payload={p.payload} kind="coverage" />} />
                      <Bar dataKey="coverage" radius={[4, 4, 0, 0]} maxBarSize={24} fill="#ced7e3" fillOpacity={0.85} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
                <ChartCard title="Review time vs. expected" subtitle="Approval latency as % of the expected review time for that request (capped at 200%).">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={data} margin={{ top: 12, right: 8, left: -12, bottom: 0 }} barCategoryGap="28%">
                      <CartesianGrid vertical={false} stroke="#2c2927" />
                      <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#45403d" }} tick={AXIS} />
                      <YAxis domain={[0, 200]} ticks={[0, 45, 100, 200]} tickLine={false} axisLine={false} tick={AXIS} width={44} unit="%" />
                      <ReferenceLine y={100} stroke="#8a8378" label={{ value: "expected", position: "insideTopRight", fill: "#b5ae9f", fontSize: 10 }} />
                      <ReferenceLine y={45} stroke="#d8b163" strokeDasharray="4 4" strokeOpacity={0.7} label={{ value: "rapid", position: "insideBottomRight", fill: "#b5ae9f", fontSize: 10 }} />
                      <Tooltip cursor={{ fill: "rgba(181,174,159,0.06)" }} content={(p) => <ChartTooltip active={p.active} payload={p.payload} kind="latency" />} />
                      <Bar dataKey="ratio" radius={[4, 4, 0, 0]} maxBarSize={24} fill="#b5ae9f" fillOpacity={0.75} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>

              <section aria-label="Decisions table" className="mt-4 overflow-hidden rounded-xl border border-line bg-raised">
                <div className="flex items-center justify-between border-b border-line px-5 py-3">
                  <h2 className="text-[13.5px] font-medium">Decisions</h2>
                  <span className="text-[12px] text-fg-subtle">Derived numbers only · stored in this browser session</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[920px] text-left text-[12.5px]">
                    <thead className="text-fg-subtle">
                      <tr className="border-b border-line">
                        {["#", "Request", "Risk", "Review time", "Expected", "Coverage", "Attention", "Intervention", "Outcome", "Top reason"].map((h) => (
                          <th key={h} scope="col" className="px-4 py-2.5 font-medium">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((r, i) => (
                        <tr key={r.id} className="border-b border-line/60 last:border-0">
                          <td className="px-4 py-2.5 font-mono tabular text-fg-subtle">{i + 1}</td>
                          <td className="max-w-[220px] truncate px-4 py-2.5 text-fg">{r.title}</td>
                          <td className="px-4 py-2.5"><RiskBadge risk={r.risk} /></td>
                          <td className="px-4 py-2.5 font-mono tabular">{(r.latencyMs / 1000).toFixed(1)} s</td>
                          <td className="px-4 py-2.5 font-mono tabular text-fg-muted">{(r.expectedLatencyMs / 1000).toFixed(1)} s</td>
                          <td className="px-4 py-2.5 font-mono tabular">{r.criticalCoverage === null ? "n/a" : formatPct(r.criticalCoverage)}</td>
                          <td className="px-4 py-2.5 font-mono tabular">{formatPct(r.attentionScore)}</td>
                          <td className="px-4 py-2.5"><InterventionBadge level={r.intervention} /></td>
                          <td className="px-4 py-2.5 text-fg-muted">{r.outcome.replace(/_/g, " ")}{r.label ? " · labeled" : ""}</td>
                          <td className="max-w-[300px] px-4 py-2.5 text-fg-muted">
                            {r.reasons[0] && (
                              <span className="flex gap-1.5">
                                <ReasonIcon tone={r.reasons[0].tone} />
                                <span className="line-clamp-2">{r.reasons[0].text}</span>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </AppShell>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-line bg-raised px-5 pb-4 pt-4", className)} aria-label={title}>
      <h2 className="text-[13.5px] font-medium text-fg">{title}</h2>
      <p className="mt-0.5 text-[12px] text-fg-subtle">{subtitle}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Legend() {
  const items: Array<{ color: string; label: string }> = [
    { color: "#ced7e3", label: "No intervention" },
    { color: "#d8b163", label: "Nudge / refocus" },
    { color: "#d9694e", label: "Paused" },
  ];
  return (
    <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-fg-muted" aria-label="Legend">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-3 rounded-sm" style={{ background: i.color }} aria-hidden />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Values are labeled selectively: first, last, lowest, and every intervention. */
function CapLabel(props: LabelProps & { index?: number; data: Datum[] }) {
  const { x, y, width, value, index, data } = props;
  if (index === undefined || value === undefined || value === null) return null;
  const d = data[index];
  const lowest = Math.min(...data.map((v) => v.score));
  const show = index === 0 || index === data.length - 1 || d.score === lowest || d.level !== "NORMAL";
  if (!show) return null;
  const cx = Number(x) + Number(width) / 2;
  const cy = Number(y) - 8;
  const tag = d.level === "PAUSE" ? "PAUSED" : d.level === "REFOCUS" ? "REFOCUS" : d.level === "NUDGE" ? "NUDGE" : null;
  return (
    <g>
      <text x={cx} y={cy} textAnchor="middle" fill="#faf6ee" fontSize={11.5}>
        {String(value)}
      </text>
      {tag && (
        <text x={cx} y={cy - 13} textAnchor="middle" fill="#b5ae9f" fontSize={9} letterSpacing="0.08em">
          {tag}
        </text>
      )}
    </g>
  );
}

function ChartTooltip({
  active,
  payload,
  kind,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
  kind: "score" | "coverage" | "latency";
}) {
  const d = payload?.[0]?.payload as Datum | undefined;
  if (!active || !d) return null;
  const value =
    kind === "score" ? `${d.score}` : kind === "coverage" ? (d.coverage === null ? "n/a" : `${d.coverage}%`) : `${d.latency.toFixed(1)} s`;
  const sub =
    kind === "latency"
      ? `expected ${d.expected.toFixed(1)} s (${d.ratio}%)`
      : kind === "score"
        ? INTERVENTION_DESCRIPTION[d.level]
        : d.mode === "gaze"
          ? "gaze evidence"
          : "no gaze evidence";
  return (
    <div className="rounded-lg border border-line-strong bg-canvas/95 px-3 py-2 text-[12px] shadow-xl">
      <div className="font-mono text-[15px] font-semibold text-fg">{value}</div>
      <div className="mt-0.5 max-w-[220px] truncate text-fg-muted">
        {d.label} · {d.title}
      </div>
      <div className="text-fg-subtle">{sub}</div>
    </div>
  );
}
