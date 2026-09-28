/**
 * SYNTHETIC schema-v2 dataset entries for evaluation tests. They exercise the
 * evaluation pipeline; they are not data about people and are never results.
 */
import type { RiskLevel } from "@/types/approval";
import type { DatasetEntry, PolicyInput } from "@/lib/ml/dataset";
import { FEATURE_NAMES, FEATURE_SCHEMA_VERSION } from "@/lib/ml/features";
import { collectionPlan, labelForCondition, type Condition } from "@/lib/ml/protocol";
import { APP_VERSION, POLICY_VERSION } from "@/lib/version";
import { gaussian, rng } from "./gaze-sim";

type Values = Partial<Record<string, number | null>>;

export interface EntryInput {
  participant: string;
  sessionId: string;
  order: number;
  condition: Condition;
  risk: RiskLevel;
  values: Values;
  assessment?: Partial<PolicyInput["assessment"]>;
  pattern?: Partial<PolicyInput["pattern"]>;
}

export function syntheticEntry(e: EntryInput): DatasetEntry {
  const assessment: PolicyInput["assessment"] = {
    mode: "gaze",
    attentionScore: 0.8,
    behavioralScore: 0.8,
    thoroughness: 0.8,
    criticalCoverage: 0.9,
    targetCoverage: [{ id: "impact-2", coverage: 0.9, visible: true, conclusive: true, strength: "strong" }],
    targetsNeverVisible: 0,
    latencyRatio: 1,
    anomaly: 0,
    trustLevel: "high",
    ...e.assessment,
  };
  return {
    schemaVersion: 2,
    sessionId: e.sessionId,
    participant: e.participant,
    scenarioId: `scenario-${e.order % 11}`,
    condition: e.condition,
    label: labelForCondition(e.condition),
    risk: e.risk,
    order: e.order,
    tRelMs: e.order * 9000,
    calibration: { version: 2, quality: "good", medianPx: 45, p90Px: 90, sigmaPx: { x: 40, y: 42 } },
    trust: { level: assessment.trustLevel, confidence: 0.9, effectiveFps: 28, postureOutRatio: 0 },
    features: { schemaVersion: FEATURE_SCHEMA_VERSION, values: e.values },
    outcome: { thoroughness: assessment.thoroughness, level: "NORMAL", mode: assessment.mode },
    policyInput: {
      assessment,
      pattern: { n: e.order + 1, detected: false, fatigueScore: 0, rapidStreak: 0, cusum: 0, status: "stable", trigger: null, ...e.pattern },
    },
    policyVersion: POLICY_VERSION,
    appVersion: APP_VERSION,
  };
}

const SCENARIOS = Array.from({ length: 11 }, (_, i) => `s${i}`);
const RISKS: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

/**
 * Labels that depend only on the counterbalanced order: every feature is
 * noise except the approval index. A leak-free grouped evaluation must find
 * no signal (AUC near 0.5).
 */
export function orderOnlyDataset(participants: number, seed = 1): DatasetEntry[] {
  const rand = rng(seed);
  return Array.from({ length: participants }, (_, p) => {
    const code = `P${String(p + 1).padStart(2, "0")}`;
    return collectionPlan(code, SCENARIOS, seed * 100 + p).map((step) =>
      syntheticEntry({
        participant: code,
        sessionId: `session-${code}-0001`,
        order: step.order,
        condition: step.condition,
        risk: RISKS[step.order % 4],
        values: Object.fromEntries(
          FEATURE_NAMES.map((n) => [n, n === "approvalIndex" ? step.order : gaussian(rand)]),
        ),
      }),
    );
  }).flat();
}

/**
 * Features that carry the label (coverage and latency), with a policy that
 * misses some low-attention approvals. For exercising the report only.
 */
export function signalDataset(participants: number, seed = 2): DatasetEntry[] {
  const rand = rng(seed);
  return Array.from({ length: participants }, (_, p) => {
    const code = `P${String(p + 1).padStart(2, "0")}`;
    return collectionPlan(code, SCENARIOS, seed * 100 + p).map((step) => {
      const low = labelForCondition(step.condition) === "LOW_ATTENTION";
      const coverage = Math.min(1, Math.max(0, (low ? 0.3 : 0.8) + gaussian(rand) * 0.2));
      const latency = Math.exp((low ? -0.8 : 0) + gaussian(rand) * 0.3);
      const risk = RISKS[(step.order + p) % 4];
      return syntheticEntry({
        participant: code,
        sessionId: `session-${code}-0001`,
        order: step.order,
        condition: step.condition,
        risk,
        values: Object.fromEntries(
          FEATURE_NAMES.map((n) => [
            n,
            n === "conclusiveCoverage" ? coverage : n === "logLatencyRatio" ? Math.log(latency) : n === "approvalIndex" ? step.order : gaussian(rand) * 0.5,
          ]),
        ),
        assessment: {
          criticalCoverage: coverage,
          targetCoverage: [{ id: "impact-2", coverage, visible: true, conclusive: true }],
          attentionScore: 0.2 + 0.7 * coverage,
          behavioralScore: 0.2 + 0.7 * coverage,
          thoroughness: 0.2 + 0.7 * coverage,
          latencyRatio: latency,
          anomaly: Math.max(0, Math.min(1, 0.6 - latency)),
          trustLevel: rand() < 0.3 ? "medium" : "high",
        },
      });
    });
  }).flat();
}
