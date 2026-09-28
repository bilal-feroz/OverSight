import { describe, expect, it } from "vitest";
import { DEFAULT_BASELINE } from "@/lib/attention/baseline";
import { evaluateApproval } from "@/lib/attention/evaluate";
import { buildDatasetEntry, datasetToFile, parseDatasetFile, type DatasetEntry } from "@/lib/ml/dataset";
import { FEATURE_NAMES, LEGACY_V1_FEATURE_NAMES, extractFeatures } from "@/lib/ml/features";
import {
  CONDITIONS,
  CONDITION_COUNTS,
  blockOrder,
  collectionPlan,
  isParticipantCode,
  labelForCondition,
  normalizeParticipant,
  type Condition,
} from "@/lib/ml/protocol";
import { snapshot, target } from "./helpers";

function entry(condition: Condition = "RAPID_APPROVAL", order = 3): DatasetEntry {
  const snap = snapshot({ targets: [target({ dwellMs: 40 })] });
  const e = evaluateApproval({ snapshot: snap, risk: "CRITICAL", baseline: DEFAULT_BASELINE, history: [], expectedWords: 25 });
  return buildDatasetEntry({
    sessionId: "3f2b8c9e-1a4d-4c1e-9f7a-2b6d8e0c4a11",
    participant: "P03",
    scenarioId: "db-config",
    condition,
    risk: "CRITICAL",
    order,
    tRelMs: 184_250,
    calibration: { version: 2, quality: "good", medianPx: 42, p90Px: 81, sigmaPx: { x: 38, y: 41 } },
    snapshot: snap,
    assessment: e.assessment,
    decisionLevel: e.decision.level,
    pattern: e.patternAfter,
    features: extractFeatures(snap, e.assessment, [], "CRITICAL"),
  });
}

const fileText = (entries: DatasetEntry[] | object[]) =>
  JSON.stringify({ ...datasetToFile([]), entries });

describe("dataset v2 schema", () => {
  it("round-trips a valid export", () => {
    const e = entry();
    const parsed = parseDatasetFile(JSON.stringify(datasetToFile([e])));
    expect(parsed.version).toBe(2);
    expect(parsed.entries).toEqual([e]);
    expect(e.label).toBe("LOW_ATTENTION");
    expect(e.features.schemaVersion).toBe(2);
    expect(Object.keys(e.features.values).sort()).toEqual([...FEATURE_NAMES].sort());
    // Missing evidence is recorded as missing, not as zero.
    const noGaze = extractFeatures(
      snapshot({ gazeSource: "none", calibrated: false, calibrationQuality: null }),
      evaluateApproval({ snapshot: snapshot({ gazeSource: "none", calibrated: false, calibrationQuality: null }), risk: "LOW", baseline: DEFAULT_BASELINE, history: [], expectedWords: 25 }).assessment,
      [],
      "LOW",
    );
    expect(noGaze.conclusiveCoverage).toBeNull();
    expect(noGaze.coverageAvailable).toBe(0);
  });

  it("rejects identifying or malformed entries", () => {
    const base = entry() as unknown as Record<string, unknown>;
    const bad: Array<[string, Record<string, unknown>]> = [
      ["an email as participant", { ...base, participant: "jane.doe@example.com" }],
      ["a name as participant", { ...base, participant: "Jane Doe" }],
      ["an absolute timestamp field", { ...base, createdAt: 1_790_000_000_000 }],
      ["an epoch time in tRelMs", { ...base, tRelMs: 1_790_000_000_000 }],
      ["a label that contradicts the condition", { ...base, label: "ATTENTIVE" }],
      ["an unknown condition", { ...base, condition: "TIRED" }],
    ];
    for (const [, e] of bad) expect(() => parseDatasetFile(fileText([e]))).toThrow(/Invalid dataset/);
    expect(() => parseDatasetFile("{}")).toThrow(/Not an OverSight dataset/);
  });

  it("contains no absolute timestamps", () => {
    const e = entry();
    const walk = (v: unknown, key = ""): void => {
      expect(["createdAt", "decidedAt", "timestamp", "date", "time"]).not.toContain(key);
      if (typeof v === "number") expect(Math.abs(v)).toBeLessThan(1e11);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
    };
    walk(e);
    expect(e.tRelMs).toBe(184_250);
  });

  it("still reads legacy v1 files, read-only", () => {
    const v1 = {
      kind: "oversight-attention-dataset",
      version: 1,
      featureNames: [...LEGACY_V1_FEATURE_NAMES],
      entries: [
        {
          features: LEGACY_V1_FEATURE_NAMES.map(() => 0.5),
          label: "ATTENTIVE",
          createdAt: 1_700_000_000_000,
          requestId: "weekly-report",
          risk: "LOW",
          deterministicScore: 0.9,
          deterministicLevel: "NORMAL",
        },
        { features: [1, 2], label: "ATTENTIVE" },
      ],
    };
    const parsed = parseDatasetFile(JSON.stringify(v1));
    expect(parsed.version).toBe(1);
    expect(parsed.entries).toHaveLength(1);
  });
});

describe("collection protocol", () => {
  const scenarios = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"];

  it("accepts pseudonymous codes only", () => {
    expect(isParticipantCode("P03")).toBe(true);
    expect(isParticipantCode(" p3 ")).toBe(true);
    expect(normalizeParticipant(" p3 ")).toBe("P3");
    for (const bad of ["Jane Doe", "jane@example.com", "P0003x", "03", "", "PPPP1"]) expect(isParticipantCode(bad)).toBe(false);
  });

  it("labels conditions: careful reviews are attentive even with poor tracking", () => {
    expect(labelForCondition("ATTENTIVE")).toBe("ATTENTIVE");
    expect(labelForCondition("CAMERA_UNCERTAIN")).toBe("ATTENTIVE");
    for (const c of ["RAPID_APPROVAL", "LOW_ATTENTION", "DISTRACTED"] as const) expect(labelForCondition(c)).toBe("LOW_ATTENTION");
  });

  it("orders condition blocks by a Latin square across participants", () => {
    const orders = ["P01", "P02", "P03", "P04", "P05"].map(blockOrder);
    for (const o of orders) expect([...o].sort()).toEqual([...CONDITIONS].sort());
    for (let pos = 0; pos < CONDITIONS.length; pos++) {
      expect(new Set(orders.map((o) => o[pos])).size).toBe(CONDITIONS.length);
    }
    expect(blockOrder("P06")).toEqual(blockOrder("P01"));
  });

  it("builds the planned counts in contiguous blocks with a per-session scenario shuffle", () => {
    const plan = collectionPlan("P02", scenarios, 42);
    expect(plan).toHaveLength(18);
    expect(plan.map((s) => s.order)).toEqual(plan.map((_, i) => i));
    for (const c of CONDITIONS) expect(plan.filter((s) => s.condition === c)).toHaveLength(CONDITION_COUNTS[c]);
    // Blocks follow the participant's Latin-square row.
    const blocks = plan.map((s) => s.condition).filter((c, i, a) => i === 0 || a[i - 1] !== c);
    expect(blocks).toEqual(blockOrder("P02"));
    // Every scenario appears, never twice in a row, and the shuffle depends on the session seed.
    expect(new Set(plan.map((s) => s.scenarioId)).size).toBe(scenarios.length);
    for (let i = 1; i < plan.length; i++) expect(plan[i].scenarioId).not.toBe(plan[i - 1].scenarioId);
    expect(collectionPlan("P02", scenarios, 42)).toEqual(plan);
    expect(collectionPlan("P02", scenarios, 43).map((s) => s.scenarioId)).not.toEqual(plan.map((s) => s.scenarioId));
    expect(plan.map((s) => s.scenarioId).slice(0, scenarios.length)).not.toEqual(scenarios);
  });
});
