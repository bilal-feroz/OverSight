"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { evaluateReview, type ReviewEvaluation } from "@/lib/attention/review-evaluation";
import { evidenceStrength } from "@/lib/attention/regions";
import { reviewController } from "@/lib/attention/review-controller";
import { regionRegistry } from "@/lib/attention/registry";
import { getGazeHub } from "@/lib/cv/gaze-hub";
import { isSimulationAllowed } from "@/lib/cv/simulated";
import { InterventionBadge } from "@/components/approval/risk-badge";
import { Switch } from "@/components/ui/misc";
import { useCvStore } from "@/lib/store/cv-store";
import { useLiveStore } from "@/lib/store/live-store";
import { useSessionStore } from "@/lib/store/session-store";
import { useUiStore } from "@/lib/store/ui-store";
import { formatPct } from "@/lib/utils";

const NA = "n/a";
const f2 = (v: number | undefined | null, d = 2) => (v === undefined || v === null || Number.isNaN(v) ? NA : v.toFixed(d));

/**
 * Developer diagnostics (D): raw signals, geometry and a live "if approved now"
 * preview computed exactly like the real decision (approvals-only history,
 * advisory ML included).
 */
export function DiagnosticsPanel() {
  const setDiagnostics = useUiStore((s) => s.setDiagnostics);
  const cv = useCvStore();
  const live = useLiveStore();
  const pattern = useSessionStore((s) => s.pattern);
  const baseline = useSessionStore((s) => s.baseline);
  const [preview, setPreview] = useState<ReviewEvaluation | null>(null);
  const [bounds, setBounds] = useState<string>(NA);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const session = reviewController.session;
      const { queue, active, records, baseline: b, classifier } = useSessionStore.getState();
      const item = queue.find((q) => q.id === active?.itemId);
      if (!session || !item?.analysis || active?.phase !== "reviewing") {
        setPreview(null);
      } else {
        setPreview(
          evaluateReview(session.snapshot(), {
            request: item.request,
            analysis: item.analysis,
            records,
            baseline: b,
            classifier,
          }),
        );
      }
      const target = session?.targetIds[0];
      const el = target ? regionRegistry.get(target, session?.approvalId)?.el : undefined;
      if (el) {
        const r = el.getBoundingClientRect();
        setBounds(`${target} [${Math.round(r.left)}, ${Math.round(r.top)}, ${Math.round(r.width)}×${Math.round(r.height)}]`);
      } else setBounds(NA);
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  const vw = typeof window !== "undefined" ? window.innerWidth : 0;
  const vh = typeof window !== "undefined" ? window.innerHeight : 0;
  const gazePx = cv.gaze ? `${Math.round(cv.gaze.x * vw)}, ${Math.round(cv.gaze.y * vh)}` : NA;

  return (
    <div
      role="region"
      aria-label="Developer diagnostics"
      className="fixed bottom-4 left-4 z-50 max-h-[72vh] w-[340px] overflow-y-auto rounded-xl border border-line-strong bg-canvas/95 font-mono text-[11px] text-fg-muted shadow-2xl backdrop-blur"
    >
      <div className="sticky top-0 flex items-center justify-between border-b border-line bg-canvas/95 px-3 py-2">
        <span className="uppercase tracking-[0.14em] text-intel">Diagnostics</span>
        <button type="button" onClick={() => setDiagnostics(false)} aria-label="Close diagnostics" className="text-fg-subtle hover:text-fg">
          <X className="size-3.5" />
        </button>
      </div>
      <Group title="Camera">
        <Row k="status" v={`${cv.cameraStatus}${cv.delegate ? ` · ${cv.delegate}` : ""}`} />
        <Row k="source" v={cv.source} />
        <Row k="fps · inference" v={`${f2(cv.fps, 0)} · ${f2(cv.inferenceMs, 1)} ms`} />
        <Row k="faces" v={String(cv.faceCount)} />
      </Group>
      <Group title="Eye / head features">
        <Row k="iris h · v" v={`${f2(cv.iris?.h, 3)} · ${f2(cv.iris?.v, 3)}`} />
        <Row k="openness · blink" v={`${f2(cv.iris?.openness, 3)} · ${cv.blink ? "yes" : "no"}`} />
        <Row k="yaw · pitch · roll" v={`${f2(cv.head?.yaw, 1)}° · ${f2(cv.head?.pitch, 1)}° · ${f2(cv.head?.roll, 1)}°`} />
      </Group>
      <Group title="Gaze">
        <Row k="normalized (smoothed)" v={cv.gaze ? `${f2(cv.gaze.x, 3)}, ${f2(cv.gaze.y, 3)}` : NA} />
        <Row k="normalized (raw)" v={cv.gazeRaw ? `${f2(cv.gazeRaw.x, 3)}, ${f2(cv.gazeRaw.y, 3)}` : NA} />
        <Row k="viewport px" v={gazePx} />
        <Row
          k="calibration"
          v={
            cv.calibration
              ? `${cv.calibration.quality} · σ ${Math.round(cv.calibration.sigmaPx.x)}×${Math.round(cv.calibration.sigmaPx.y)} px${cv.calibration.version < 2 ? " · legacy" : ""}${cv.calibrationStale ? " · stale" : ""}`
              : "none"
          }
        />
        {cv.calibration?.validation && (
          <Row
            k="held-out error"
            v={`median ${Math.round(cv.calibration.validation.medianPx)} · p90 ${Math.round(cv.calibration.validation.p90Px)} · jitter ${Math.round(cv.calibration.validation.precisionPx)} px`}
          />
        )}
        {cv.calibration?.headSweep && (
          <Row
            k="head sweep"
            v={`yaw ${f2(cv.calibration.headSweep.yawRange, 0)}° · pitch ${f2(cv.calibration.headSweep.pitchRange, 0)}°`}
          />
        )}
        <Row k="hit margin" v={reviewController.session ? `${Math.round(reviewController.session.gazeMarginPx.x)}×${Math.round(reviewController.session.gazeMarginPx.y)} px` : NA} />
        <Row k="drift correction" v={`${cv.driftPx.x >= 0 ? "+" : ""}${cv.driftPx.x}, ${cv.driftPx.y >= 0 ? "+" : ""}${cv.driftPx.y} px`} />
      </Group>
      <Group title="Uncertainty">
        {(() => {
          const est = live.estimate ?? getGazeHub().latest?.estimate ?? null;
          return (
            <>
              <Row k="sigma x · y" v={est ? `${Math.round(est.sigmaX)} · ${Math.round(est.sigmaY)} px` : NA} />
              <Row k="confidence" v={est ? formatPct(est.confidence) : NA} />
              <Row k="posture z" v={est ? f2(est.postureZ, 2) : NA} />
            </>
          );
        })()}
      </Group>
      <Group title="Regions">
        <Row k="critical bounds" v={bounds} />
        <Row k="gaze on (max weight)" v={live.regionId ?? NA} />
        {live.targets.map((t) => {
          const coverage = Math.min(1, t.dwellMs / Math.max(1, t.requiredDwellMs));
          const strength = evidenceStrength({ visible: t.visible, conclusive: t.conclusive, coverage, fixations: t.fixations });
          return (
            <div key={t.id}>
              <Row k={`dwell ${t.id}`} v={`${Math.round(t.dwellMs)} / ${Math.round(t.requiredDwellMs)} ms`} />
              <Row
                k="  w · strength · s"
                v={`${f2(t.weight)} · ${strength} · ${t.separation === null ? NA : `${f2(t.separation, 1)} σ`}`}
              />
            </div>
          );
        })}
      </Group>
      <Group title="If approved now">
        {preview ? (
          <>
            <PreviewRows preview={preview} />
          </>
        ) : (
          <p className="py-0.5 text-fg-subtle">Open a request to preview.</p>
        )}
      </Group>
      <Group title="Session">
        <Row k="pattern · fatigue" v={`${pattern.status} · ${f2(pattern.fatigueScore)}`} />
        <Row k="decline run · slope" v={`${pattern.declineRun} · ${f2(pattern.slope, 3)}`} />
        <Row k="rapid streak · speed-up cusum" v={`${pattern.rapidStreak} · ${f2(pattern.cusum)}`} />
        <Row
          k="baseline"
          v={
            baseline.source === "personal"
              ? `${Math.round(baseline.overheadMs)} ms + ${Math.round(baseline.msPerWordLatency ?? 0)} ms/word · ${Math.round(baseline.msPerWordDwell ?? 0)} ms/word dwell`
              : "default"
          }
        />
      </Group>
      {isSimulationAllowed() && (
        <div className="border-t border-line px-3 py-2.5 font-sans text-[12px]">
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="text-fg">Simulated gaze (pointer)</span>
              <span className="block text-[11px] text-warn">Development only. Labeled everywhere when on.</span>
            </span>
            <Switch
              checked={cv.simulated}
              onChange={(on) => getGazeHub().setSimulated(on)}
              label="Simulated gaze"
            />
          </label>
        </div>
      )}
    </div>
  );
}

function PreviewRows({ preview }: { preview: ReviewEvaluation }) {
  const { assessment, decision } = preview.evaluation;
  const trust = assessment.trust;
  return (
    <>
      <div className="flex items-center justify-between py-0.5">
        <span>decision</span>
        <InterventionBadge level={decision.level} />
      </div>
      <Row k="gaze trust" v={`${trust.level} · ${formatPct(trust.confidence)} · ${f2(trust.effectiveFps, 0)} fps`} />
      <Row k="gaze · behavioral level" v={`${decision.gazeLevel ?? NA} · ${decision.behavioralLevel}`} />
      <Row k="separation" v={trust.separation === null ? NA : `${f2(trust.separation, 1)} σ`} />
      {trust.reasons.map((r) => (
        <p key={r.code} className="py-0.5 font-sans text-[11px] leading-snug text-warn">
          {r.text}
        </p>
      ))}
      <Row k="attention score" v={formatPct(assessment.attentionScore)} />
      <Row k="coverage" v={assessment.criticalCoverage === null ? NA : formatPct(assessment.criticalCoverage)} />
      <Row
        k="latency / expected"
        v={`${f2(assessment.latencyMs / 1000, 1)} / ${f2(assessment.expectedLatencyMs / 1000, 1)} s`}
      />
      <Row k="anomaly" v={f2(assessment.anomaly)} />
      <Row k="sensitivity" v={`${f2(decision.sensitivity)}×`} />
      <Row k="classifier" v={preview.ml === null ? "not active" : formatPct(preview.ml)} />
      <Row k="mode · signal" v={`${assessment.mode} · ${assessment.confidence}`} />
      {assessment.components.map((c) => (
        <Row key={c.key} k={`  ${c.key}`} v={c.available ? `${f2(c.value)} × ${f2(c.weight)}` : NA} />
      ))}
    </>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line px-3 py-2">
      <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-fg-subtle">{title}</div>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="truncate whitespace-pre">{k}</span>
      <span className="truncate text-right text-fg">{v}</span>
    </div>
  );
}
