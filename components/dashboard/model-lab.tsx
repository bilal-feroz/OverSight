"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Download, FlaskConical, Play, Square, Trash2, Upload } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Stat } from "@/components/ui/misc";
import { trainAdvisoryModel } from "@/lib/ml/advisory";
import { reportMarkdown, type EvaluationReport } from "@/lib/ml/evaluate";
import { FEATURE_DESCRIPTIONS, FEATURE_NAMES, FEATURE_SCHEMA_VERSION, type FeatureName } from "@/lib/ml/features";
import {
  clearDataset,
  datasetToFile,
  getDatasetSnapshot,
  getServerDatasetSnapshot,
  importDataset,
  loadLegacyDataset,
  parseDatasetFile,
  storeClassifier,
  subscribeDataset,
} from "@/lib/ml/dataset";
import { activationStatus, topCoefficients, type ModelMetadata } from "@/lib/ml/logistic";
import { CONDITIONS, CONDITION_COUNTS, CONDITION_NAMES, isParticipantCode } from "@/lib/ml/protocol";
import { useSessionStore } from "@/lib/store/session-store";
import { cn } from "@/lib/utils";

const PLAN_LENGTH = CONDITIONS.reduce((a, c) => a + CONDITION_COUNTS[c], 0);

export function ModelLab() {
  const collection = useSessionStore((s) => s.collection);
  const startCollection = useSessionStore((s) => s.startCollection);
  const stopCollection = useSessionStore((s) => s.stopCollection);
  const classifier = useSessionStore((s) => s.classifier);
  const setClassifier = useSessionStore((s) => s.setClassifier);
  const refreshDatasetSize = useSessionStore((s) => s.refreshDatasetSize);
  const entries = useSyncExternalStore(subscribeDataset, getDatasetSnapshot, getServerDatasetSnapshot);
  const [participant, setParticipant] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [legacyCount, setLegacyCount] = useState(() => (typeof window === "undefined" ? 0 : loadLegacyDataset().length));
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const summary = useMemo(() => {
    const byCondition = Object.fromEntries(CONDITIONS.map((c) => [c, 0])) as Record<(typeof CONDITIONS)[number], number>;
    for (const e of entries) byCondition[e.condition] += 1;
    const low = entries.filter((e) => e.label === "LOW_ATTENTION").length;
    return {
      total: entries.length,
      low,
      attentive: entries.length - low,
      participants: new Set(entries.map((e) => e.participant)).size,
      sessions: new Set(entries.map((e) => e.sessionId)).size,
      byCondition,
    };
  }, [entries]);

  const codeValid = isParticipantCode(participant);

  const start = () => {
    const error = startCollection(participant);
    setMessage(error ?? `Collection session started for ${participant.trim().toUpperCase()}. Open the console to begin.`);
  };

  const train = () => {
    try {
      const result = trainAdvisoryModel(entries, { label: "Model lab", bootstrap: 500 });
      setReport(result.report);
      if (result.model) {
        storeClassifier(result.model);
        setClassifier(result.model);
      }
      setMessage(result.status.active ? "Advisory model activated." : `Advisory model not activated: ${result.status.reason}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Evaluation failed.");
    }
  };

  const downloadReport = () => {
    if (!report) return;
    const blob = new Blob([reportMarkdown(report)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `oversight-evaluation-${report.sizes.entries}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportDataset = () => {
    const blob = new Blob([JSON.stringify(datasetToFile(entries), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `oversight-dataset-v2-${entries.length}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImport = async (file: File) => {
    try {
      const parsed = parseDatasetFile(await file.text());
      const added = importDataset(parsed);
      refreshDatasetSize();
      setLegacyCount(loadLegacyDataset().length);
      setMessage(
        parsed.version === 1
          ? `Imported ${added} legacy v1 reviews (read-only: not used for v2 models).`
          : `Imported ${added} new reviews (duplicates skipped).`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed.");
    }
  };

  const status = activationStatus(classifier);

  return (
    <AppShell>
      <main id="main" className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1080px] px-5 py-8 md:px-8">
          <div className="eyebrow">Model lab · Layer 2</div>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-0.02em]">Behavioral attention classifier</h1>
          <p className="mt-2 max-w-[76ch] text-[14px] leading-relaxed text-fg-muted">
            A small, explainable model that could learn low-attention approval patterns from reviews collected with a
            counterbalanced protocol. It ships <strong className="text-fg">untrained</strong>: there is no public dataset
            for this task, and OverSight does not invent one. Until a model passes a grouped evaluation on real
            participants, the deterministic engine decides alone. Even then the classifier is advisory: it can raise
            intervention sensitivity, never lower it.
          </p>

          <section className="mt-6 grid gap-3 md:grid-cols-4" aria-label="Dataset status">
            <Stat
              label="Advisory model"
              value={
                <span className={status.active ? "text-safe" : classifier ? "text-warn" : "text-fg-muted"}>
                  {status.active ? "Active" : classifier ? "Not activated" : "Untrained"}
                </span>
              }
              hint={status.active ? "may raise concern, never lower it" : "deterministic engine decides"}
            />
            <Stat label="Reviews collected" value={summary.total} hint={`${summary.attentive} attentive · ${summary.low} low-attention`} />
            <Stat label="Participants" value={summary.participants} hint={`${summary.sessions} session${summary.sessions === 1 ? "" : "s"}`} />
            <Stat
              label="Legacy v1 reviews"
              value={legacyCount}
              hint={legacyCount ? "read-only, not used for v2" : "none imported"}
            />
          </section>

          <section className="mt-6 rounded-xl border border-line bg-raised p-5" aria-label="Data collection">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold">
              <FlaskConical className="size-4 text-intel" aria-hidden /> 1 · Collect reviews
            </h2>
            <p className="mt-1.5 max-w-[76ch] text-[13px] leading-relaxed text-fg-muted">
              A collection session walks one participant through {PLAN_LENGTH} requests in counterbalanced blocks (
              {CONDITIONS.map((c) => `${CONDITION_COUNTS[c]} ${CONDITION_NAMES[c].toLowerCase()}`).join(", ")}). The block
              order comes from a Latin square keyed by the participant code and scenarios are shuffled within the
              session. The console shows the instruction for each request; interventions are recorded but not enforced.
            </p>
            <p className="mt-2 max-w-[76ch] rounded-md border border-line bg-surface px-3 py-2 text-[12.5px] leading-relaxed text-fg-muted">
              <strong className="text-fg">Notice and consent.</strong> Only derived numbers are stored, in this browser:
              no video, images, face landmarks, names, emails or clock times (time is counted from the start of the
              session). Participants are identified by a code you choose, such as P03. Tell each participant what is
              recorded and get their consent before starting; clear the data when the study ends.
            </p>

            {collection ? (
              <div className="mt-4 flex flex-wrap items-center gap-3 text-[13px]" role="status">
                <Badge tone="intel" className="font-mono">
                  {collection.participant} · {Math.min(collection.index + 1, collection.plan.length)} / {collection.plan.length}
                </Badge>
                <Link href="/console">
                  <Button variant="primary" size="sm">
                    <Play aria-hidden /> Continue in console
                  </Button>
                </Link>
                <Button variant="ghost" size="sm" onClick={stopCollection}>
                  <Square aria-hidden /> Stop session
                </Button>
              </div>
            ) : (
              <form
                className="mt-4 flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (codeValid) start();
                }}
              >
                <label className="text-[13px] text-fg-muted">
                  Participant code
                  <input
                    value={participant}
                    onChange={(e) => setParticipant(e.target.value)}
                    placeholder="P03"
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={participant.length > 0 && !codeValid}
                    aria-describedby="participant-hint"
                    className="mt-1.5 block h-9 w-40 rounded-md border border-line-strong bg-canvas px-3 font-mono text-sm uppercase text-fg outline-none focus:border-intel"
                  />
                </label>
                <Button type="submit" variant="primary" size="sm" disabled={!codeValid}>
                  <Play aria-hidden /> Start collection session
                </Button>
                <span id="participant-hint" className="w-full text-[12px] text-fg-subtle">
                  Letters then digits (for example P03). Never a name or email.
                </span>
              </form>
            )}

            <dl className="mt-4 grid grid-cols-2 gap-2 text-center sm:grid-cols-5">
              {CONDITIONS.map((c) => (
                <div key={c} className="rounded-md border border-line bg-surface px-2 py-1.5">
                  <dt className="text-[10px] uppercase tracking-[0.1em] text-fg-subtle">{CONDITION_NAMES[c]}</dt>
                  <dd className="font-mono text-[13px] tabular text-fg">{summary.byCondition[c]}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={exportDataset} disabled={!entries.length}>
                <Download aria-hidden /> Export dataset
              </Button>
              <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload aria-hidden /> Import dataset
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onImport(f);
                  e.target.value = "";
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  clearDataset();
                  refreshDatasetSize();
                  setLegacyCount(0);
                  setMessage("Dataset cleared.");
                }}
                disabled={!entries.length && !legacyCount}
              >
                <Trash2 aria-hidden /> Clear
              </Button>
              {message && (
                <span className="self-center text-[12.5px] text-fg-muted" role="status">
                  {message}
                </span>
              )}
            </div>
          </section>

          <section className="mt-4 rounded-xl border border-line bg-raised p-5" aria-label="Evaluation and training">
            <h2 className="text-[15px] font-semibold">2 · Evaluate and train (grouped)</h2>
            <p className="mt-1.5 max-w-[76ch] text-[13px] leading-relaxed text-fg-muted">
              Runs the grouped evaluation of <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[12px] text-fg">docs/EVALUATION.md</code>{" "}
              (leave one participant out), then fits logistic regression on all reviews with calibration and thresholds
              from out-of-fold predictions. The model is activated only if it passes the pre-registered rule: at least 5
              participants, a false-intervention rate within 1 point of the rules, and at least 20% fewer missed
              dangerous approvals with a participant-bootstrap interval above zero. The same code runs from the command
              line: <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[12px] text-fg">npm run evaluate -- dataset.json</code>
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button variant="primary" size="sm" onClick={train} disabled={summary.low === 0 || summary.attentive === 0}>
                Evaluate and train on {summary.total} reviews
              </Button>
              {report && (
                <Button variant="secondary" size="sm" onClick={downloadReport}>
                  <Download aria-hidden /> Evaluation report
                </Button>
              )}
              {classifier && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    storeClassifier(null);
                    setClassifier(null);
                    setMessage("Classifier removed. The deterministic engine decides alone.");
                  }}
                >
                  Remove model
                </Button>
              )}
            </div>
            {classifier && (
              <p className={cn("mt-3 text-[13px]", status.active ? "text-safe" : "text-warn")} role="status">
                {status.active ? "Advisory model active." : "Advisory model not activated."} {status.reason}
              </p>
            )}
            {(report || classifier?.metadata) && <GroupedMetrics report={report} classifierMeta={classifier?.metadata ?? null} />}
            {classifier && (
              <div className="mt-5">
                <h3 className="eyebrow mb-2">Most influential features</h3>
                <ul className="space-y-1.5">
                  {topCoefficients(classifier, 6).map((c) => (
                    <li key={c.name} className="flex items-center justify-between gap-4 text-[13px]">
                      <span className="text-fg">
                        {c.name}
                        <span className="ml-2 text-[12px] text-fg-subtle">{FEATURE_DESCRIPTIONS[c.name as FeatureName] ?? ""}</span>
                      </span>
                      <Badge tone={c.weight > 0 ? "warn" : "safe"} className="font-mono">
                        {c.weight > 0 ? "+" : ""}
                        {c.weight.toFixed(2)} {c.weight > 0 ? "→ low attention" : "→ attentive"}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          <section className="mt-4 rounded-xl border border-line bg-raised p-5" aria-label="Features">
            <h2 className="text-[15px] font-semibold">Stored features (derived numbers only, schema v{FEATURE_SCHEMA_VERSION})</h2>
            <dl className="mt-3 grid gap-x-8 gap-y-2 text-[12.5px] md:grid-cols-2">
              {FEATURE_NAMES.map((name) => (
                <div key={name}>
                  <dt className="font-mono text-fg">{name}</dt>
                  <dd className="text-fg-muted">{FEATURE_DESCRIPTIONS[name]}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </main>
    </AppShell>
  );
}

const num = (v: number | null | undefined, digits = 2) => (v == null || !Number.isFinite(v) ? "n/a" : v.toFixed(digits));
const rate = (v: number | null | undefined) => (v == null ? "n/a" : `${(v * 100).toFixed(1)}%`);

/** Grouped (out-of-fold) evidence only: never training accuracy. */
function GroupedMetrics({
  report,
  classifierMeta,
}: {
  report: EvaluationReport | null;
  classifierMeta: ModelMetadata | null;
}) {
  const decision = report?.decision ?? classifierMeta?.decision ?? null;
  return (
    <div className="mt-5 space-y-4 text-[13px]">
      {report && (
        <p className="text-fg-muted">
          Leave-one-{report.grouping}-out · {report.sizes.entries} reviews · {report.sizes.participants} participants ·{" "}
          {report.sizes.sessions} sessions
        </p>
      )}
      {report?.warnings.map((w) => (
        <p key={w} className="rounded-md border border-warn/35 bg-warn/[0.07] px-3 py-2 text-[12.5px] text-warn">
          {w}
        </p>
      ))}
      {report && (
        <table className="w-full text-left text-[12.5px]">
          <caption className="eyebrow mb-2 text-left">Out-of-fold discrimination (positive = low attention)</caption>
          <thead className="text-fg-subtle">
            <tr>
              <th className="py-1 font-normal">Model</th>
              <th className="py-1 font-normal">PR-AUC</th>
              <th className="py-1 font-normal">ROC-AUC</th>
              <th className="py-1 font-normal">Brier</th>
            </tr>
          </thead>
          <tbody className="font-mono text-fg">
            {[...report.rules, ...report.models].map((m) => (
              <tr key={m.id} className="border-t border-line">
                <td className="py-1.5 pr-3 font-sans text-fg-muted">{m.name}</td>
                {m.discrimination ? (
                  <>
                    <td>{num(m.discrimination.prAuc)}</td>
                    <td>{num(m.discrimination.rocAuc)}</td>
                    <td>{num(m.discrimination.brier)}</td>
                  </>
                ) : (
                  <td colSpan={3} className="font-sans text-fg-subtle">
                    insufficient data
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {decision && (
        <div>
          <h3 className="eyebrow mb-1.5">Pre-registered rule</h3>
          <p className="text-fg-muted">
            False interventions: rules {rate(decision.firRules)}, with model {rate(decision.firModel)}. Missed dangerous
            approvals: rules {rate(decision.mdarRules)}, with model {rate(decision.mdarModel)}. Relative reduction{" "}
            {decision.relativeReduction == null ? "n/a" : `${(decision.relativeReduction * 100).toFixed(0)}%`}
            {decision.interval ? ` (95% CI ${(decision.interval[0] * 100).toFixed(0)}% to ${(decision.interval[1] * 100).toFixed(0)}%)` : ""}.
          </p>
          <p className={cn("mt-1 font-medium", decision.adopt ? "text-safe" : "text-fg")}>
            {decision.adopt ? "Passes: the advisory model may be used." : "Ship rules only."}
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-fg-muted">
            {decision.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
