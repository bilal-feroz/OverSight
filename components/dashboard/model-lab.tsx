"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Download, FlaskConical, Trash2, Upload } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Stat, Switch } from "@/components/ui/misc";
import { FEATURE_DESCRIPTIONS, FEATURE_NAMES, type FeatureName } from "@/lib/ml/features";
import {
  clearDataset,
  datasetToFile,
  getDatasetSnapshot,
  getServerDatasetSnapshot,
  parseDatasetFile,
  saveDataset,
  storeClassifier,
  subscribeDataset,
} from "@/lib/ml/dataset";
import {
  MIN_EXAMPLES_PER_CLASS,
  isClassifierUsable,
  topCoefficients,
  trainClassifier,
} from "@/lib/ml/logistic";
import { useSessionStore } from "@/lib/store/session-store";
import { formatPct } from "@/lib/utils";

export function ModelLab() {
  const labeling = useSessionStore((s) => s.labeling);
  const setLabeling = useSessionStore((s) => s.setLabeling);
  const classifier = useSessionStore((s) => s.classifier);
  const setClassifier = useSessionStore((s) => s.setClassifier);
  const refreshDatasetSize = useSessionStore((s) => s.refreshDatasetSize);
  const entries = useSyncExternalStore(subscribeDataset, getDatasetSnapshot, getServerDatasetSnapshot);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => {
    const low = entries.filter((e) => e.label === "LOW_ATTENTION").length;
    return { total: entries.length, low, attentive: entries.length - low };
  }, [entries]);

  const agreement = useMemo(() => {
    if (!entries.length) return null;
    const correct = entries.filter((e) => {
      const predictedLow = e.deterministicLevel === "PAUSE" || e.deterministicLevel === "REFOCUS" || e.deterministicScore < 0.5;
      return predictedLow === (e.label === "LOW_ATTENTION");
    }).length;
    return correct / entries.length;
  }, [entries]);

  const train = () => {
    try {
      const model = trainClassifier(
        entries.map((e) => ({ features: e.features, label: e.label })),
        FEATURE_NAMES,
        1,
      );
      storeClassifier(model);
      setClassifier(model);
      setMessage(
        model.metrics
          ? `Trained on ${model.samples.total} reviews. Cross-validated AUC ${model.metrics.auc.toFixed(2)}.`
          : `Trained on ${model.samples.total} reviews. Too few examples to cross-validate yet.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Training failed.");
    }
  };

  const exportDataset = () => {
    const blob = new Blob([JSON.stringify(datasetToFile(entries), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `oversight-dataset-${entries.length}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importDataset = async (file: File) => {
    try {
      const imported = parseDatasetFile(await file.text());
      const merged = [...entries, ...imported];
      saveDataset(merged);
      refreshDatasetSize();
      setMessage(`Imported ${imported.length} labeled reviews.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed.");
    }
  };

  const usable = isClassifierUsable(classifier);

  return (
    <AppShell>
      <main id="main" className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1080px] px-5 py-8 md:px-8">
          <div className="eyebrow">Model lab · Layer 2</div>
          <h1 className="mt-2 text-[30px] font-semibold tracking-[-0.02em]">Behavioral attention classifier</h1>
          <p className="mt-2 max-w-[76ch] text-[14px] leading-relaxed text-fg-muted">
            A small, explainable logistic-regression model that learns low-attention approval patterns from reviews
            you label yourself. It ships <strong className="text-fg">untrained</strong>: there is no public dataset
            for this task, and OverSight does not invent one. Until it is trained and cross-validated on your own data,
            the deterministic engine decides alone. Even then the classifier is advisory: it can raise intervention
            sensitivity, never lower it.
          </p>

          <section className="mt-6 grid gap-3 md:grid-cols-4" aria-label="Model status">
            <Stat
              label="Status"
              value={
                <span className={usable ? "text-safe" : classifier ? "text-warn" : "text-fg-muted"}>
                  {usable ? "Validated" : classifier ? "Not validated" : "Untrained"}
                </span>
              }
              hint={usable ? "advisory; may raise sensitivity" : "deterministic engine decides"}
            />
            <Stat label="Labeled reviews" value={counts.total} hint={`${counts.attentive} attentive · ${counts.low} low-attention`} />
            <Stat
              label="Cross-validated AUC"
              value={classifier?.metrics ? classifier.metrics.auc.toFixed(2) : "n/a"}
              hint={classifier?.metrics ? `${classifier.metrics.folds}-fold · accuracy ${formatPct(classifier.metrics.accuracy)}` : "needs ≥ 3 per class"}
            />
            <Stat
              label="Deterministic agreement"
              value={agreement === null ? "n/a" : formatPct(agreement)}
              hint="rule engine vs. your labels"
            />
          </section>

          <section className="mt-6 rounded-xl border border-line bg-raised p-5" aria-label="Data collection">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-[66ch]">
                <h2 className="flex items-center gap-2 text-[15px] font-semibold">
                  <FlaskConical className="size-4 text-intel" aria-hidden /> 1 · Collect labeled reviews
                </h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-fg-muted">
                  With collection on, the console assigns each request a label and tells you how to review it:
                  <em> attentive</em> (review normally) or <em>low attention</em> (glance at the title and approve).
                  Labels are therefore instructed conditions, which is weak supervision; they are good for a prototype,
                  not for claims about real-world accuracy. Interventions are recorded but not enforced while
                  collecting. Only the {FEATURE_NAMES.length} derived features below are stored, in this browser.
                </p>
              </div>
              <label className="flex items-center gap-3 text-[13px]">
                Collection mode
                <Switch checked={labeling} onChange={setLabeling} label="Data collection mode" />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/console">
                <Button variant="primary" size="sm">Open console</Button>
              </Link>
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
                  if (f) void importDataset(f);
                  e.target.value = "";
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  clearDataset();
                  refreshDatasetSize();
                  setMessage("Dataset cleared.");
                }}
                disabled={!entries.length}
              >
                <Trash2 aria-hidden /> Clear
              </Button>
            </div>
          </section>

          <section className="mt-4 rounded-xl border border-line bg-raised p-5" aria-label="Training">
            <h2 className="text-[15px] font-semibold">2 · Train and validate</h2>
            <p className="mt-1.5 max-w-[76ch] text-[13px] leading-relaxed text-fg-muted">
              L2-regularized logistic regression (Newton / IRLS), stratified k-fold cross-validation. The model becomes
              active only with at least {MIN_EXAMPLES_PER_CLASS} examples per label and a cross-validated AUC of 0.70 or
              higher. The same code runs from the command line: <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[12px] text-fg">npm run train -- path/to/dataset.json</code>
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button variant="primary" size="sm" onClick={train} disabled={counts.low === 0 || counts.attentive === 0}>
                Train on {counts.total} reviews
              </Button>
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
              {message && <span className="text-[12.5px] text-fg-muted" role="status">{message}</span>}
            </div>

            {classifier && (
              <div className="mt-5">
                <h3 className="eyebrow mb-2">Most influential features</h3>
                <ul className="space-y-1.5">
                  {topCoefficients(classifier, 6).map((c) => (
                    <li key={c.name} className="flex items-center justify-between gap-4 text-[13px]">
                      <span className="text-fg">
                        {c.name}
                        <span className="ml-2 text-[12px] text-fg-subtle">
                          {FEATURE_DESCRIPTIONS[c.name as FeatureName] ?? ""}
                        </span>
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
            <h2 className="text-[15px] font-semibold">Stored features (derived numbers only)</h2>
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
