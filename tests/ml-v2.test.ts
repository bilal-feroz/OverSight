/**
 * Advisory ML: bounded influence and the activation gate. Synthetic inputs
 * only; no model is trained on real data here or shipped.
 */
import { describe, expect, it } from "vitest";
import type { RiskLevel } from "@/types/approval";
import type { AttentionAssessment, TrustLevel } from "@/types/attention";
import { INTERVENTION_ORDER } from "@/types/attention";
import { assessPattern } from "@/lib/attention/pattern";
import { advisoryInfluence } from "@/lib/attention/review-evaluation";
import { trainAdvisoryModel } from "@/lib/ml/advisory";
import { FEATURE_NAMES, type NamedFeatures } from "@/lib/ml/features";
import { activationStatus, type AttentionClassifier } from "@/lib/ml/logistic";
import { decideIntervention } from "@/lib/risk/intervention";
import { POLICY_VERSION } from "@/lib/version";
import { trustOf } from "./helpers";
import { signalDataset } from "./sim/dataset-sim";
import { rng } from "./sim/gaze-sim";

const RISKS: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const TRUST: TrustLevel[] = ["high", "medium", "low", "none"];
const ORDER = INTERVENTION_ORDER;

function randomAssessment(rand: () => number): AttentionAssessment {
  const trust = trustOf(TRUST[Math.floor(rand() * 4)]);
  const gaze = trust.level === "high" || trust.level === "medium";
  const cov = rand();
  const score = rand();
  const neverVisible = rand() < 0.1 ? 1 : 0;
  return {
    mode: gaze ? "gaze" : "behavioral",
    attentionScore: score,
    thoroughness: score,
    behavioralScore: rand(),
    trust,
    confidence: gaze ? "high" : "low",
    confidenceValue: trust.confidence,
    criticalCoverage: gaze && !neverVisible ? cov : null,
    targetCoverage: [{ id: "t", coverage: cov, visible: !neverVisible }],
    targetsMissed: 0,
    targetsNeverVisible: neverVisible,
    latencyMs: 0,
    expectedLatencyMs: 0,
    latencyRatio: rand() * 2,
    anomaly: rand(),
    components: [],
    reasons: [],
  };
}

describe("advisory ML influence is bounded", () => {
  const patterns = [assessPattern([]), assessPattern([0.95, 0.9, 0.6, 0.35, 0.2].map((s) => ({ thoroughness: s, latencyRatio: 0.3 })))];

  it("never lowers a level, and never pauses unless the rules already intervened", () => {
    const rand = rng(99);
    for (let i = 0; i < 4000; i++) {
      const a = randomAssessment(rand);
      const risk = RISKS[Math.floor(rand() * 4)];
      const pattern = patterns[Math.floor(rand() * 2)];
      const rules = decideIntervention(a, { risk, pattern });
      const ml = { probability: rand(), tauSens: 0.5 + rand() * 0.4, tauVerify: 0.5 + rand() * 0.45 };
      const withMl = decideIntervention(a, { risk, pattern, ml });
      expect(ORDER[withMl.level]).toBeGreaterThanOrEqual(ORDER[rules.level]);
      if (ORDER[rules.level] < ORDER.REFOCUS) expect(ORDER[withMl.level]).toBeLessThanOrEqual(ORDER.REFOCUS);
    }
  });

  it("escalates only to REFOCUS, with manual verification, when gaze trust is below high", () => {
    const a: AttentionAssessment = { ...randomAssessment(rng(1)), mode: "behavioral", criticalCoverage: null, trust: trustOf("low"), latencyRatio: 1.4, anomaly: 0, behavioralScore: 0.9, targetsNeverVisible: 0, targetCoverage: [{ id: "t", coverage: 0, visible: true }] };
    const calm = assessPattern([]);
    expect(decideIntervention(a, { risk: "MEDIUM", pattern: calm }).level).toBe("NORMAL");
    const escalated = decideIntervention(a, { risk: "MEDIUM", pattern: calm, ml: { probability: 0.97, tauSens: 0.75, tauVerify: 0.85 } });
    expect(escalated.level).toBe("REFOCUS");
    expect(escalated.verification).toBe("manual");
    expect(escalated.reasons.map((r) => r.code)).toContain("ml");
    // Not below the threshold, not for LOW risk, not at high trust.
    expect(decideIntervention(a, { risk: "MEDIUM", pattern: calm, ml: { probability: 0.8, tauSens: 0.75, tauVerify: 0.85 } }).level).toBe("NORMAL");
    expect(decideIntervention(a, { risk: "LOW", pattern: calm, ml: { probability: 0.99, tauSens: 0.75, tauVerify: 0.85 } }).level).toBe("NORMAL");
    const high = { ...a, mode: "gaze" as const, criticalCoverage: 0.9, trust: trustOf("high"), attentionScore: 0.9 };
    expect(decideIntervention(high, { risk: "MEDIUM", pattern: calm, ml: { probability: 0.99, tauSens: 0.75, tauVerify: 0.85 } }).level).toBe("NORMAL");
  });
});

describe("activation gate", () => {
  const features = Object.fromEntries(FEATURE_NAMES.map((n) => [n, 0.5])) as NamedFeatures;
  const base: AttentionClassifier = {
    version: 1,
    featureNames: [...FEATURE_NAMES],
    mean: FEATURE_NAMES.map(() => 0),
    std: FEATURE_NAMES.map(() => 1),
    weights: [0, ...FEATURE_NAMES.map(() => 0.1)],
    lambda: 1,
    positiveLabel: "LOW_ATTENTION",
    trainedAt: 0,
    samples: { total: 100, attentive: 50, lowAttention: 50 },
    metrics: { folds: 5, accuracy: 0.99, auc: 0.99, logLoss: 0.05 },
  };
  const meta = (adopt: boolean) => ({
    featureSchemaVersion: 2,
    policyVersion: POLICY_VERSION,
    grouping: "participant" as const,
    participants: 8,
    sessions: 8,
    rows: 144,
    metrics: { rocAuc: 0.8, prAuc: 0.85, brier: 0.15 },
    decision: { adopt, reasons: adopt ? ["All pre-registered conditions hold."] : ["Fewer than 5 participants."], firRules: 0.05, firModel: 0.05, mdarRules: 0.3, mdarModel: 0.2, relativeReduction: 0.33, interval: [0.1, 0.5] as [number, number] },
    platt: { a: 1, b: 0 },
    tauSens: 0.75,
    tauVerify: 0.85,
  });

  it("keeps a model trained without a grouped evaluation inactive, however good its row-level numbers", () => {
    const s = activationStatus(base);
    expect(s.active).toBe(false);
    expect(s.reason).toMatch(/grouped evaluation/);
    expect(advisoryInfluence(base, features)).toBeNull();
  });

  it("activates only a model whose evaluation passed, for this schema and policy", () => {
    expect(activationStatus({ ...base, metadata: meta(false) })).toMatchObject({ active: false });
    expect(activationStatus({ ...base, metadata: meta(false) }).reason).toMatch(/pre-registered rule/);
    expect(activationStatus({ ...base, metadata: { ...meta(true), policyVersion: "1.0" } }).active).toBe(false);
    expect(activationStatus({ ...base, metadata: { ...meta(true), featureSchemaVersion: 1 } }).active).toBe(false);
    const passing = { ...base, metadata: meta(true) };
    expect(activationStatus(passing).active).toBe(true);
    const influence = advisoryInfluence(passing, features)!;
    expect(influence.tauVerify).toBe(0.85);
    expect(influence.probability).toBeGreaterThan(0);
    expect(activationStatus(null).active).toBe(false);
  });

  it("with too few participants a trained model stays inactive and the app is rules-only", () => {
    const { model, status, report } = trainAdvisoryModel(signalDataset(3), { synthetic: true, bootstrap: 50 });
    expect(model).not.toBeNull();
    expect(model!.metrics).toBeNull();
    expect(model!.metadata!.decision.adopt).toBe(false);
    expect(status.active).toBe(false);
    expect(report.grouping).toBe("session");
    expect(advisoryInfluence(model, features)).toBeNull();
  });
});
