/**
 * Labeled review dataset (schema v2) for honest, grouped evaluation.
 *
 * Stored only in this browser (localStorage) and exportable as JSON. Each
 * entry holds derived numbers only: no video, images, landmarks, names,
 * emails or absolute timestamps. Participants are pseudonymous codes chosen
 * by the operator; time is relative to the start of the collection session.
 * Entries carry what the deterministic policy consumed, so an evaluation can
 * replay decisions with and without an ML probability (lib/ml/replay.ts).
 *
 * Legacy v1 files remain readable, read-only; they are never mixed into v2.
 */
import { z } from "zod";
import type { RiskLevel } from "@/types/approval";
import type {
  AttentionAssessment,
  AttentionLabel,
  InterventionLevel,
  ReviewSnapshot,
  SessionPattern,
  TrustLevel,
} from "@/types/attention";
import type { CalibrationQuality } from "@/types/cv";
import { APP_VERSION, POLICY_VERSION } from "@/lib/version";
import { FEATURE_NAMES, FEATURE_SCHEMA_VERSION, LEGACY_V1_FEATURE_NAMES, type NamedFeatures } from "./features";
import type { AttentionClassifier } from "./logistic";
import { isParticipantCode, labelForCondition, type Condition } from "./protocol";

export const DATASET_SCHEMA_VERSION = 2;

/** What decideIntervention consumes, kept so decisions can be replayed. */
export interface PolicyInput {
  assessment: {
    mode: "gaze" | "behavioral";
    attentionScore: number;
    behavioralScore: number;
    thoroughness: number;
    criticalCoverage: number | null;
    targetCoverage: { id: string; coverage: number; visible: boolean; conclusive?: boolean; strength?: string }[];
    targetsNeverVisible: number;
    latencyRatio: number;
    anomaly: number;
    trustLevel: TrustLevel;
  };
  pattern: {
    n: number;
    detected: boolean;
    fatigueScore: number;
    rapidStreak: number;
    cusum: number;
    status: SessionPattern["status"];
    trigger: SessionPattern["trigger"];
  };
}

export interface DatasetEntry {
  schemaVersion: 2;
  /** Random id of one collection session. */
  sessionId: string;
  /** Pseudonymous participant code, e.g. "P03". */
  participant: string;
  scenarioId: string;
  condition: Condition;
  label: AttentionLabel;
  risk: RiskLevel;
  /** Index within the collection session. */
  order: number;
  /** ms since the collection session started. */
  tRelMs: number;
  calibration: {
    version: number;
    quality: CalibrationQuality;
    medianPx: number | null;
    p90Px: number | null;
    sigmaPx: { x: number; y: number };
  } | null;
  trust: { level: TrustLevel; confidence: number; effectiveFps: number; postureOutRatio: number };
  features: { schemaVersion: number; values: Partial<Record<string, number | null>> };
  outcome: { thoroughness: number; level: InterventionLevel; mode: "gaze" | "behavioral" };
  policyInput: PolicyInput;
  policyVersion: string;
  appVersion: string;
}

export interface DatasetFile {
  kind: "oversight-attention-dataset";
  schemaVersion: 2;
  featureSchemaVersion: number;
  featureNames: string[];
  entries: DatasetEntry[];
}

/** v1 entry (instructed labels, row-level CV era). Read-only. */
export interface LegacyDatasetEntry {
  features: number[];
  label: AttentionLabel;
  createdAt: number;
  requestId: string;
  risk: RiskLevel;
  deterministicScore: number;
  deterministicLevel: InterventionLevel;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const RISKS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const LEVELS = ["NORMAL", "NUDGE", "REFOCUS", "PAUSE"] as const;
const TRUST = ["high", "medium", "low", "none"] as const;
const CONDITION_VALUES = ["ATTENTIVE", "RAPID_APPROVAL", "LOW_ATTENTION", "DISTRACTED", "CAMERA_UNCERTAIN"] as const;
const num = z.number().finite();

const EntrySchema = z
  .object({
    schemaVersion: z.literal(2),
    sessionId: z.string().min(8).max(64),
    participant: z.string().refine(isParticipantCode, "participant must be a pseudonymous code such as P03"),
    scenarioId: z.string().min(1).max(80),
    condition: z.enum(CONDITION_VALUES),
    label: z.enum(["ATTENTIVE", "LOW_ATTENTION"]),
    risk: z.enum(RISKS),
    order: z.number().int().min(0),
    // Relative time only: an absolute epoch timestamp would be far larger than a session.
    tRelMs: num.min(0).max(24 * 3600 * 1000),
    calibration: z
      .object({
        version: num,
        quality: z.enum(["good", "fair", "poor"]),
        medianPx: num.nullable(),
        p90Px: num.nullable(),
        sigmaPx: z.object({ x: num, y: num }),
      })
      .nullable(),
    trust: z.object({ level: z.enum(TRUST), confidence: num, effectiveFps: num, postureOutRatio: num }),
    features: z.object({ schemaVersion: num, values: z.record(z.string(), num.nullable()) }),
    outcome: z.object({ thoroughness: num, level: z.enum(LEVELS), mode: z.enum(["gaze", "behavioral"]) }),
    policyInput: z.object({
      assessment: z.object({
        mode: z.enum(["gaze", "behavioral"]),
        attentionScore: num,
        behavioralScore: num,
        thoroughness: num,
        criticalCoverage: num.nullable(),
        targetCoverage: z.array(
          z.object({
            id: z.string(),
            coverage: num,
            visible: z.boolean(),
            conclusive: z.boolean().optional(),
            strength: z.string().optional(),
          }),
        ),
        targetsNeverVisible: num,
        latencyRatio: num,
        anomaly: num,
        trustLevel: z.enum(TRUST),
      }),
      pattern: z.object({
        n: num,
        detected: z.boolean(),
        fatigueScore: num,
        rapidStreak: num,
        cusum: num,
        status: z.enum(["insufficient", "stable", "declining", "degradation"]),
        trigger: z.enum(["decline", "rapid", "speedup", "strength"]).nullable(),
      }),
    }),
    policyVersion: z.string(),
    appVersion: z.string(),
  })
  .strict()
  .refine((e) => e.label === labelForCondition(e.condition), "label does not match the condition");

const FileSchema = z.object({
  kind: z.literal("oversight-attention-dataset"),
  schemaVersion: z.literal(2),
  featureSchemaVersion: num,
  featureNames: z.array(z.string()),
  entries: z.array(EntrySchema),
});

// ---------------------------------------------------------------------------
// Building entries
// ---------------------------------------------------------------------------

export interface EntryContext {
  sessionId: string;
  participant: string;
  scenarioId: string;
  condition: Condition;
  risk: RiskLevel;
  order: number;
  tRelMs: number;
  calibration: DatasetEntry["calibration"];
  snapshot: ReviewSnapshot;
  assessment: AttentionAssessment;
  decisionLevel: InterventionLevel;
  pattern: SessionPattern;
  features: NamedFeatures;
}

export function buildDatasetEntry(c: EntryContext): DatasetEntry {
  const a = c.assessment;
  return {
    schemaVersion: 2,
    sessionId: c.sessionId,
    participant: c.participant,
    scenarioId: c.scenarioId,
    condition: c.condition,
    label: labelForCondition(c.condition),
    risk: c.risk,
    order: c.order,
    tRelMs: Math.max(0, Math.round(c.tRelMs)),
    calibration: c.calibration,
    trust: {
      level: a.trust.level,
      confidence: a.trust.confidence,
      effectiveFps: a.trust.effectiveFps,
      postureOutRatio: c.snapshot.postureOutRatio ?? 0,
    },
    features: { schemaVersion: FEATURE_SCHEMA_VERSION, values: { ...c.features } },
    outcome: { thoroughness: a.thoroughness, level: c.decisionLevel, mode: a.mode },
    policyInput: {
      assessment: {
        mode: a.mode,
        attentionScore: a.attentionScore,
        behavioralScore: a.behavioralScore,
        thoroughness: a.thoroughness,
        criticalCoverage: a.criticalCoverage,
        targetCoverage: a.targetCoverage.map((t) => ({
          id: t.id,
          coverage: t.coverage,
          visible: t.visible,
          ...(t.conclusive === undefined ? {} : { conclusive: t.conclusive }),
          ...(t.strength === undefined ? {} : { strength: t.strength }),
        })),
        targetsNeverVisible: a.targetsNeverVisible,
        latencyRatio: a.latencyRatio,
        anomaly: a.anomaly,
        trustLevel: a.trust.level,
      },
      pattern: {
        n: c.pattern.n,
        detected: c.pattern.detected,
        fatigueScore: c.pattern.fatigueScore,
        rapidStreak: c.pattern.rapidStreak,
        cusum: c.pattern.cusum,
        status: c.pattern.status,
        trigger: c.pattern.trigger,
      },
    },
    policyVersion: POLICY_VERSION,
    appVersion: APP_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const DATASET_KEY = "oversight.dataset.v2";
const LEGACY_DATASET_KEY = "oversight.dataset.v1";
const MODEL_KEY = "oversight.classifier.v2";

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function datasetToFile(entries: readonly DatasetEntry[]): DatasetFile {
  return {
    kind: "oversight-attention-dataset",
    schemaVersion: 2,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    featureNames: [...FEATURE_NAMES],
    entries: [...entries],
  };
}

export function loadDataset(): DatasetEntry[] {
  const raw = storage()?.getItem(DATASET_KEY);
  if (!raw) return [];
  try {
    const parsed = FileSchema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data.entries as DatasetEntry[]) : [];
  } catch {
    return [];
  }
}

/** Legacy v1 entries (read-only; shown, never used for v2 models). */
export function loadLegacyDataset(): LegacyDatasetEntry[] {
  const raw = storage()?.getItem(LEGACY_DATASET_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { entries?: LegacyDatasetEntry[] };
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch {
    return [];
  }
}

export function saveDataset(entries: readonly DatasetEntry[]) {
  storage()?.setItem(DATASET_KEY, JSON.stringify(datasetToFile(entries)));
  notifyDataset();
}

function saveLegacy(entries: readonly LegacyDatasetEntry[]) {
  storage()?.setItem(
    LEGACY_DATASET_KEY,
    JSON.stringify({ kind: "oversight-attention-dataset", version: 1, featureNames: [...LEGACY_V1_FEATURE_NAMES], entries }),
  );
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

/** Clears v2 and legacy entries. */
export function clearDataset() {
  storage()?.removeItem(DATASET_KEY);
  storage()?.removeItem(LEGACY_DATASET_KEY);
  notifyDataset();
}

export type ParsedDataset = { version: 2; entries: DatasetEntry[] } | { version: 1; entries: LegacyDatasetEntry[] };

/** Validates an exported file: v2 is checked field by field; v1 is accepted read-only. */
export function parseDatasetFile(text: string): ParsedDataset {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Not a JSON file.");
  }
  const kind = (json as { kind?: unknown } | null)?.kind;
  if (kind !== "oversight-attention-dataset") throw new Error("Not an OverSight dataset file.");
  const version = (json as { schemaVersion?: unknown; version?: unknown }).schemaVersion ?? (json as { version?: unknown }).version;
  if (version === 1) {
    const legacy = json as { featureNames?: string[]; entries?: LegacyDatasetEntry[] };
    if (legacy.featureNames?.join() !== LEGACY_V1_FEATURE_NAMES.join()) throw new Error("Unknown v1 feature set.");
    const entries = (legacy.entries ?? []).filter(
      (e) =>
        Array.isArray(e.features) &&
        e.features.length === LEGACY_V1_FEATURE_NAMES.length &&
        (e.label === "ATTENTIVE" || e.label === "LOW_ATTENTION"),
    );
    return { version: 1, entries };
  }
  const parsed = FileSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid dataset: ${issue?.path.join(".") || "file"}: ${issue?.message ?? "schema mismatch"}`);
  }
  return { version: 2, entries: parsed.data.entries as DatasetEntry[] };
}

/** Imports a parsed file: v2 entries are merged (duplicates skipped); v1 entries are kept apart, read-only. */
export function importDataset(parsed: ParsedDataset): number {
  if (parsed.version === 1) {
    saveLegacy([...loadLegacyDataset(), ...parsed.entries]);
    return parsed.entries.length;
  }
  const existing = loadDataset();
  const key = (e: DatasetEntry) => `${e.sessionId}#${e.order}`;
  const seen = new Set(existing.map(key));
  const fresh = parsed.entries.filter((e) => !seen.has(key(e)));
  saveDataset([...existing, ...fresh]);
  return fresh.length;
}

// ---------------------------------------------------------------------------
// Classifier storage
// ---------------------------------------------------------------------------

const sameFeatures = (model: AttentionClassifier) => model.featureNames.join() === FEATURE_NAMES.join();

export function loadStoredClassifier(): AttentionClassifier | null {
  const raw = storage()?.getItem(MODEL_KEY);
  if (!raw) return null;
  try {
    const model = JSON.parse(raw) as AttentionClassifier;
    return sameFeatures(model) ? model : null;
  } catch {
    return null;
  }
}

export function storeClassifier(model: AttentionClassifier | null) {
  if (!model) storage()?.removeItem(MODEL_KEY);
  else storage()?.setItem(MODEL_KEY, JSON.stringify(model));
}

/** A model trained with scripts/train-attention-model.ts (served by /api/classifier). */
export async function fetchBundledClassifier(): Promise<AttentionClassifier | null> {
  try {
    const res = await fetch("/api/classifier", { cache: "no-store" });
    if (!res.ok) return null;
    const { model } = (await res.json()) as { model: AttentionClassifier | null };
    return model?.featureNames && sameFeatures(model) ? model : null;
  } catch {
    return null;
  }
}
