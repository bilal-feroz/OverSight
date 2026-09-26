/**
 * Labeled review dataset for the behavioral classifier. Stored only in this
 * browser (localStorage) and exportable as JSON. Contains derived numbers
 * only; see FEATURE_NAMES.
 */
import type { RiskLevel } from "@/types/approval";
import type { InterventionLevel } from "@/types/attention";
import { FEATURE_NAMES } from "./features";
import type { AttentionClassifier, AttentionLabel } from "./logistic";

export interface DatasetEntry {
  features: number[];
  label: AttentionLabel;
  createdAt: number;
  requestId: string;
  risk: RiskLevel;
  deterministicScore: number;
  deterministicLevel: InterventionLevel;
}

export interface DatasetFile {
  kind: "oversight-attention-dataset";
  version: 1;
  featureNames: string[];
  entries: DatasetEntry[];
}

const DATASET_KEY = "oversight.dataset.v1";
const MODEL_KEY = "oversight.classifier.v1";

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadDataset(): DatasetEntry[] {
  const raw = storage()?.getItem(DATASET_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as DatasetFile;
    if (parsed.kind !== "oversight-attention-dataset" || !Array.isArray(parsed.entries)) return [];
    if (parsed.featureNames.join() !== FEATURE_NAMES.join()) return [];
    return parsed.entries;
  } catch {
    return [];
  }
}

export function saveDataset(entries: DatasetEntry[]) {
  const file: DatasetFile = {
    kind: "oversight-attention-dataset",
    version: 1,
    featureNames: [...FEATURE_NAMES],
    entries,
  };
  storage()?.setItem(DATASET_KEY, JSON.stringify(file));
  notifyDataset();
}

// Minimal external store so React can subscribe with useSyncExternalStore.
let snapshot: DatasetEntry[] | null = null;
const listeners = new Set<() => void>();
const EMPTY: DatasetEntry[] = [];

function notifyDataset() {
  snapshot = null;
  for (const l of listeners) l();
}

export function subscribeDataset(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDatasetSnapshot(): DatasetEntry[] {
  if (snapshot === null) snapshot = loadDataset();
  return snapshot;
}

export function getServerDatasetSnapshot(): DatasetEntry[] {
  return EMPTY;
}

export function appendDatasetEntry(entry: DatasetEntry): DatasetEntry[] {
  const entries = [...loadDataset(), entry];
  saveDataset(entries);
  return entries;
}

export function clearDataset() {
  storage()?.removeItem(DATASET_KEY);
  notifyDataset();
}

export function datasetToFile(entries: DatasetEntry[]): DatasetFile {
  return { kind: "oversight-attention-dataset", version: 1, featureNames: [...FEATURE_NAMES], entries };
}

export function parseDatasetFile(text: string): DatasetEntry[] {
  const parsed = JSON.parse(text) as DatasetFile;
  if (parsed.kind !== "oversight-attention-dataset") throw new Error("Not an OverSight dataset file.");
  if (parsed.featureNames.join() !== FEATURE_NAMES.join()) {
    throw new Error("Dataset was recorded with a different feature set.");
  }
  return parsed.entries.filter(
    (e) =>
      Array.isArray(e.features) &&
      e.features.length === FEATURE_NAMES.length &&
      (e.label === "ATTENTIVE" || e.label === "LOW_ATTENTION"),
  );
}

export function loadStoredClassifier(): AttentionClassifier | null {
  const raw = storage()?.getItem(MODEL_KEY);
  if (!raw) return null;
  try {
    const model = JSON.parse(raw) as AttentionClassifier;
    return model.featureNames.join() === FEATURE_NAMES.join() ? model : null;
  } catch {
    return null;
  }
}

export function storeClassifier(model: AttentionClassifier | null) {
  if (!model) storage()?.removeItem(MODEL_KEY);
  else storage()?.setItem(MODEL_KEY, JSON.stringify(model));
}

/** A model trained with scripts/train-attention-model.ts (written to public/models). */
export async function fetchBundledClassifier(): Promise<AttentionClassifier | null> {
  try {
    const res = await fetch("/api/classifier", { cache: "no-store" });
    if (!res.ok) return null;
    const { model } = (await res.json()) as { model: AttentionClassifier | null };
    return model?.featureNames?.join() === FEATURE_NAMES.join() ? model : null;
  } catch {
    return null;
  }
}
