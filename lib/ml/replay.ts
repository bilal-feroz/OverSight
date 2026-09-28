/**
 * Replays the deterministic policy on a stored dataset entry, with or without
 * an ML probability, so an evaluation can compare "rules only" with
 * "rules + advisory model" on exactly the evidence each decision saw.
 */
import type { AttentionAssessment, GazeTrust, InterventionDecision, SessionPattern } from "@/types/attention";
import { decideIntervention, type MlInfluence } from "@/lib/risk/intervention";
import type { DatasetEntry, PolicyInput } from "./dataset";

export function replayAssessment(a: PolicyInput["assessment"]): AttentionAssessment {
  const trust: GazeTrust = {
    level: a.trustLevel,
    confidence: 0,
    reasons: [],
    effectiveFps: 0,
    stale: false,
    simulated: false,
    calibrationQuality: null,
    separation: null,
  };
  return {
    mode: a.mode,
    attentionScore: a.attentionScore,
    thoroughness: a.thoroughness,
    behavioralScore: a.behavioralScore,
    trust,
    confidence: a.mode === "gaze" ? "high" : "low",
    confidenceValue: 0,
    criticalCoverage: a.criticalCoverage,
    targetCoverage: a.targetCoverage.map((t) => ({
      id: t.id,
      coverage: t.coverage,
      visible: t.visible,
      conclusive: t.conclusive,
    })),
    targetsMissed: 0,
    targetsNeverVisible: a.targetsNeverVisible,
    latencyMs: 0,
    expectedLatencyMs: 0,
    latencyRatio: a.latencyRatio,
    anomaly: a.anomaly,
    components: [],
    reasons: [],
  };
}

export function replayPattern(p: PolicyInput["pattern"]): SessionPattern {
  return {
    n: p.n,
    scores: [],
    declineRun: 0,
    drop: 0,
    slope: 0,
    rapidStreak: p.rapidStreak,
    latencyTrend: 0,
    cusum: p.cusum,
    fatigueScore: p.fatigueScore,
    status: p.status,
    detected: p.detected,
    trigger: p.trigger,
    message: "",
  };
}

/** The policy's decision for a stored entry; `ml` adds the advisory model's influence. */
export function replayDecision(entry: DatasetEntry, ml?: MlInfluence | null): InterventionDecision {
  return decideIntervention(replayAssessment(entry.policyInput.assessment), {
    risk: entry.risk,
    pattern: replayPattern(entry.policyInput.pattern),
    ml: ml ?? null,
  });
}
