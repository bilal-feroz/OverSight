"use client";

import Link from "next/link";
import { Activity, Eye, LockKeyhole, ScanText } from "lucide-react";
import type { ApprovalRecord, SessionPattern } from "@/types/attention";
import type { SemanticAnalysis } from "@/types/semantic";
import { InterventionBadge, RiskBadge } from "@/components/approval/risk-badge";
import { ReasonIcon } from "@/components/approval/pause-view";
import { Dot } from "@/components/ui/badge";
import { Progress } from "@/components/ui/misc";
import { thoroughnessOf } from "@/lib/attention/baseline";
import { regionRegistry } from "@/lib/attention/registry";
import { reReviewProgress } from "@/lib/attention/rereview";
import { RISK_DESCRIPTION, isDecisionCritical } from "@/lib/risk/levels";
import { useCvStore } from "@/lib/store/cv-store";
import { useLiveStore } from "@/lib/store/live-store";
import { useSessionStore } from "@/lib/store/session-store";
import { cn, formatPct } from "@/lib/utils";

function PanelSection({
  title,
  icon: Icon,
  children,
  aside,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <section className="border-b border-line px-5 py-4" aria-label={title}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[12.5px] font-medium text-fg">
          <Icon className="size-3.5 text-intel" aria-hidden />
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function IntelligencePanel() {
  const active = useSessionStore((s) => s.active);
  const item = useSessionStore((s) => s.queue.find((q) => q.id === s.active?.itemId) ?? null);
  const records = useSessionStore((s) => s.records);
  const pattern = useSessionStore((s) => s.pattern);
  const provider = useSessionStore((s) => s.provider);

  return (
    <aside
      aria-label="OverSight intelligence"
      className="flex w-full shrink-0 flex-col border-t border-line bg-base lg:w-[360px] lg:overflow-y-auto lg:border-l lg:border-t-0"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <span className="eyebrow">OverSight intelligence</span>
        <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-safe">
          <LockKeyhole className="size-3" aria-hidden /> On-device
        </span>
      </div>

      {item?.analysis ? (
        <SemanticSection analysis={item.analysis} providerModel={provider?.kind === "ai" ? provider.model : undefined} />
      ) : (
        <PanelSection title="Semantic analysis" icon={ScanText}>
          <p className="text-[13px] text-fg-muted">{item ? "Analyzing the proposed action…" : "No request selected."}</p>
        </PanelSection>
      )}

      <LiveSection analysis={item?.analysis ?? null} phase={active?.phase ?? null} manual={active?.manual ?? false} />
      <PatternSection pattern={pattern} records={records} />
      <LastDecision records={records} />

      <div className="mt-auto px-5 py-4 text-[12px] leading-relaxed text-fg-subtle">
        <p className="text-fg-muted">Video never leaves this device.</p>
        <p>We monitor the approval interaction, not the employee.</p>
        <Link href="/how-it-works#privacy" className="mt-1 inline-block text-fg-subtle underline underline-offset-2 hover:text-fg">
          Privacy architecture
        </Link>
      </div>
    </aside>
  );
}

function SemanticSection({ analysis, providerModel }: { analysis: SemanticAnalysis; providerModel?: string }) {
  const critical = analysis.criticalRegions.filter((r) => isDecisionCritical(r.severity));
  const keyDetails = analysis.criticalRegions.filter((r) => !isDecisionCritical(r.severity));
  return (
    <PanelSection title="Semantic analysis" icon={ScanText} aside={<RiskBadge risk={analysis.overallRisk} />}>
      <p className="text-[12px] text-fg-subtle">{RISK_DESCRIPTION[analysis.overallRisk]}</p>
      <p className="mt-2 text-[13px] leading-relaxed text-fg/90">{analysis.rationale}</p>
      <div className="mt-3 space-y-2">
        {[...critical, ...keyDetails].map((r) => (
          <div
            key={r.fieldId}
            className={cn(
              "rounded-lg border px-3 py-2",
              isDecisionCritical(r.severity) ? "border-critical/30 bg-critical/[0.05]" : "border-intel/25 bg-intel/[0.04]",
            )}
          >
            <div
              className={cn(
                "font-mono text-[10px] uppercase tracking-[0.14em]",
                isDecisionCritical(r.severity) ? "text-critical" : "text-intel",
              )}
            >
              {isDecisionCritical(r.severity) ? "Decision-critical" : "Key detail"} · {r.reason}
            </div>
            <p className="mt-1 text-[13px] leading-snug text-fg">{r.statement}</p>
          </div>
        ))}
      </div>
      {analysis.notableRegions.length > 0 && (
        <p className="mt-2 text-[12px] text-fg-subtle">
          +{analysis.notableRegions.length} other flagged item{analysis.notableRegions.length > 1 ? "s" : ""} (shown, not
          enforced)
        </p>
      )}
      <p className="mt-3 font-mono text-[10.5px] text-fg-subtle">
        {analysis.provider.kind === "ai"
          ? `Analyzer: ${providerModel ?? analysis.provider.model} + deterministic floor`
          : "Analyzer: deterministic rule engine"}
        {analysis.provider.fallbackReason ? ` · ${analysis.provider.fallbackReason}` : ""}
      </p>
    </PanelSection>
  );
}

function LiveSection({
  analysis,
  phase,
  manual,
}: {
  analysis: SemanticAnalysis | null;
  phase: string | null;
  manual: boolean;
}) {
  const live = useLiveStore();
  const cameraStatus = useCvStore((s) => s.cameraStatus);
  const source = useCvStore((s) => s.source);
  const calibration = useCvStore((s) => s.calibration);
  const faceCount = useCvStore((s) => s.faceCount);
  const stale = useCvStore((s) => s.calibrationStale);

  const dwell = live.targets.reduce((a, t) => a + t.dwellMs, 0);
  const required = live.targets.reduce((a, t) => a + t.requiredDwellMs, 0);
  const regionLabel = live.regionId
    ? (regionRegistry.get(live.regionId, live.approvalId ?? undefined)?.meta.label ?? live.regionId)
    : live.gazeActive
      ? live.onCard
        ? "Request (between regions)"
        : "Outside the request"
      : "No gaze estimate";

  const signal =
    source === "simulated"
      ? { text: "Simulated (pointer)", tone: "warn" as const }
      : source === "none"
        ? { text: cameraStatus === "denied" ? "Camera denied" : "Camera off", tone: "neutral" as const }
        : !calibration
          ? { text: "Not calibrated", tone: "warn" as const }
          : faceCount > 1
            ? { text: "Multiple faces · unreliable", tone: "warn" as const }
            : faceCount === 0
              ? { text: "Face not detected · paused", tone: "neutral" as const }
              : stale
                ? { text: "Recalibration recommended", tone: "warn" as const }
                : {
                    text: calibration.quality === "good" ? "Good" : calibration.quality === "fair" ? "Fair" : "Recalibration recommended",
                    tone: calibration.quality === "poor" ? ("warn" as const) : ("safe" as const),
                  };

  const inReReview = (phase === "refocus" || phase === "paused") && live.reReview && !manual;
  const gazeOff = live.coverage === null;
  const criticalWord = analysis && isDecisionCritical(analysis.overallRisk) ? "Critical" : "Key detail";

  return (
    <PanelSection
      title="Live attention"
      icon={Eye}
      aside={
        <span className="inline-flex items-center gap-1.5 text-[11.5px] text-fg-muted">
          <Dot tone={signal.tone} /> {signal.text}
        </span>
      }
    >
      {inReReview && live.reReview ? (
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-[12.5px] text-fg-muted">Re-review of missed consequence</span>
            <span className="font-mono text-[13px] tabular text-fg">{formatPct(reReviewProgress(live.reReview))}</span>
          </div>
          <Progress className="mt-2" value={reReviewProgress(live.reReview)} tone={live.reReview.satisfied ? "safe" : "critical"} label="Re-review progress" />
        </div>
      ) : (
        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-[12.5px] text-fg-muted">{criticalWord} coverage</span>
            <span className="font-mono text-[13px] tabular text-fg">{gazeOff ? "n/a" : formatPct(live.coverage ?? 0)}</span>
          </div>
          <Progress
            className="mt-2"
            value={live.coverage ?? 0}
            tone={gazeOff ? "neutral" : (live.coverage ?? 0) >= 0.6 ? "safe" : "intel"}
            label={`${criticalWord} coverage`}
          />
          <p className="mt-1.5 font-mono text-[11px] text-fg-subtle">
            {gazeOff
              ? "Gaze evidence unavailable; interaction timing only"
              : `${(dwell / 1000).toFixed(1)} s of ${(required / 1000).toFixed(1)} s expected dwell`}
          </p>
        </div>
      )}
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
        <dt className="text-fg-subtle">Time on request</dt>
        <dd className="text-right font-mono tabular text-fg-muted">{(live.elapsedMs / 1000).toFixed(1)} s</dd>
        <dt className="text-fg-subtle">Gaze on</dt>
        <dd className="truncate text-right text-fg-muted">{source === "none" ? "n/a" : regionLabel}</dd>
      </dl>
    </PanelSection>
  );
}

const LEVEL_BAR: Record<string, string> = {
  NORMAL: "bg-safe/80",
  NUDGE: "bg-warn/80",
  REFOCUS: "bg-warn",
  PAUSE: "bg-critical",
};

function PatternSection({ pattern, records }: { pattern: SessionPattern; records: ApprovalRecord[] }) {
  const recent = records.slice(-10);
  const statusTone =
    pattern.status === "degradation" ? "critical" : pattern.status === "declining" ? "warn" : pattern.status === "stable" ? "safe" : "neutral";
  return (
    <PanelSection
      title="Session pattern"
      icon={Activity}
      aside={
        <Link href="/session" className="text-[11.5px] text-fg-subtle underline-offset-2 hover:text-fg hover:underline">
          Details
        </Link>
      }
    >
      {recent.length === 0 ? (
        <p className="text-[12.5px] text-fg-subtle">Attention trend appears after the first decision.</p>
      ) : (
        <div
          className="flex h-16 items-end gap-1.5"
          role="img"
          aria-label={`Review thoroughness per approval: ${recent.map((r) => Math.round(thoroughnessOf(r) * 100)).join(", ")}`}
        >
          {recent.map((r) => (
            <div key={r.id} className="flex max-w-[28px] flex-1 flex-col items-center justify-end gap-1">
              <span className="font-mono text-[9.5px] tabular text-fg-subtle">{Math.round(thoroughnessOf(r) * 100)}</span>
              <div
                className={cn("w-full max-w-[18px] rounded-t-[3px]", LEVEL_BAR[r.intervention] ?? "bg-safe/80")}
                style={{ height: `${Math.max(4, thoroughnessOf(r) * 40)}px` }}
              />
            </div>
          ))}
        </div>
      )}
      <p
        className={cn(
          "mt-3 flex items-start gap-2 text-[12.5px]",
          statusTone === "critical" ? "text-critical" : statusTone === "warn" ? "text-warn" : "text-fg-muted",
        )}
      >
        <Dot tone={statusTone} className="mt-1.5" />
        <span>
          {pattern.status === "degradation" && <span className="font-semibold">Attention degradation detected. </span>}
          {pattern.message}
        </span>
      </p>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
        <MiniStat label="Rapid streak" value={String(pattern.rapidStreak)} />
        <MiniStat label="Pattern" value={formatPct(pattern.fatigueScore)} />
        <MiniStat label="Decisions" value={String(records.length)} />
      </dl>
    </PanelSection>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-raised px-2 py-1.5">
      <dt className="text-[10px] uppercase tracking-[0.1em] text-fg-subtle">{label}</dt>
      <dd className="font-mono text-[13px] tabular text-fg">{value}</dd>
    </div>
  );
}

function LastDecision({ records }: { records: ApprovalRecord[] }) {
  const last = records[records.length - 1];
  return (
    <PanelSection title="Last decision" icon={ScanText} aside={last ? <InterventionBadge level={last.intervention} /> : undefined}>
      {!last ? (
        <p className="text-[12.5px] text-fg-subtle">No decisions yet.</p>
      ) : (
        <>
          <p className="truncate text-[13px] text-fg">{last.title}</p>
          <p className="font-mono text-[11px] text-fg-subtle">
            {last.outcome.replace(/_/g, " ")} · attention {formatPct(last.attentionScore)} · {(last.latencyMs / 1000).toFixed(1)} s
          </p>
          <ul className="mt-2 space-y-1">
            {last.reasons.slice(0, 3).map((r) => (
              <li key={r.code} className="flex gap-2 text-[12px] leading-snug text-fg-muted">
                <ReasonIcon tone={r.tone} />
                <span>{r.text}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </PanelSection>
  );
}
