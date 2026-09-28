import { describe, expect, it } from "vitest";
import { computeSensitivity, decideIntervention } from "@/lib/risk/intervention";
import { assessPattern } from "@/lib/attention/pattern";
import type { AttentionAssessment } from "@/types/attention";
import { trustOf } from "./helpers";

function assessment(overrides: Partial<AttentionAssessment> = {}): AttentionAssessment {
  const mode = overrides.mode ?? "gaze";
  return {
    mode,
    attentionScore: overrides.attentionScore ?? 0.8,
    thoroughness: overrides.thoroughness ?? overrides.attentionScore ?? 0.8,
    behavioralScore: overrides.behavioralScore ?? overrides.attentionScore ?? 0.8,
    trust: trustOf(mode === "gaze" ? "high" : "none"),
    confidence: "high",
    confidenceValue: 0.9,
    criticalCoverage: 0.9,
    targetCoverage: [{ id: "t", coverage: 0.9, visible: true }],
    targetsMissed: 0,
    targetsNeverVisible: 0,
    latencyMs: 6000,
    expectedLatencyMs: 5000,
    latencyRatio: 1.2,
    anomaly: 0,
    components: [],
    reasons: [],
    ...overrides,
  };
}

const calm = assessPattern([]);

describe("intervention thresholds", () => {
  it("CRITICAL: pause below 25% coverage, refocus below 60%, allow above", () => {
    const level = (cov: number, score = 0.8) =>
      decideIntervention(assessment({ criticalCoverage: cov, attentionScore: score }), {
        risk: "CRITICAL",
        pattern: calm,
      }).level;
    expect(level(0.1)).toBe("PAUSE");
    expect(level(0.24)).toBe("PAUSE");
    expect(level(0.4)).toBe("REFOCUS");
    expect(level(0.7, 0.55)).toBe("NUDGE");
    expect(level(0.7)).toBe("NORMAL");
  });

  it("HIGH: near-zero coverage pauses only with anomalous behavior or a low score", () => {
    const decide = (a: Partial<AttentionAssessment>) =>
      decideIntervention(assessment(a), { risk: "HIGH", pattern: calm }).level;
    expect(decide({ criticalCoverage: 0.05, anomaly: 0.7, attentionScore: 0.5 })).toBe("PAUSE");
    expect(decide({ criticalCoverage: 0.05, anomaly: 0.1, attentionScore: 0.5 })).toBe("REFOCUS");
    expect(decide({ criticalCoverage: 0.3 })).toBe("REFOCUS");
    expect(decide({ criticalCoverage: 0.8, attentionScore: 0.5 })).toBe("NUDGE");
  });

  it("MEDIUM: nudges, refocuses only for near-zero coverage with anomaly", () => {
    const decide = (a: Partial<AttentionAssessment>) =>
      decideIntervention(assessment(a), { risk: "MEDIUM", pattern: calm }).level;
    expect(decide({ criticalCoverage: 0.2, attentionScore: 0.45 })).toBe("NUDGE");
    expect(decide({ criticalCoverage: 0.05, attentionScore: 0.3, anomaly: 0.8 })).toBe("REFOCUS");
    expect(decide({})).toBe("NORMAL");
  });

  it("LOW: never blocks", () => {
    for (const cov of [0, 0.1, 0.5]) {
      const level = decideIntervention(
        assessment({ criticalCoverage: cov, attentionScore: 0.05, anomaly: 1, latencyRatio: 0.05 }),
        { risk: "LOW", pattern: calm },
      ).level;
      expect(["NORMAL", "NUDGE"]).toContain(level);
    }
  });

  it("behavioral mode requires manual verification for fast critical approvals", () => {
    const d = decideIntervention(
      assessment({ mode: "behavioral", criticalCoverage: null, latencyRatio: 0.2, anomaly: 0.6 }),
      { risk: "CRITICAL", pattern: calm },
    );
    expect(d.level).toBe("PAUSE");
    expect(d.verification).toBe("manual");
  });

  it("a validated ML classifier can raise sensitivity but never lower it", () => {
    const base = computeSensitivity(calm, null);
    expect(computeSensitivity(calm, 0.1)).toBe(base);
    expect(computeSensitivity(calm, 0.9)).toBeGreaterThan(base);
    // Borderline case flips toward intervention only in the stricter direction.
    const borderline = assessment({ criticalCoverage: 0.26, attentionScore: 0.6 });
    expect(decideIntervention(borderline, { risk: "CRITICAL", pattern: calm }).level).toBe("REFOCUS");
    expect(
      decideIntervention(borderline, { risk: "CRITICAL", pattern: calm, mlProbability: 0.95 }).level,
    ).toBe("PAUSE");
    expect(
      decideIntervention(assessment(), { risk: "CRITICAL", pattern: calm, mlProbability: 0.01 }).level,
    ).toBe("NORMAL");
  });

  it("sensitivity is capped", () => {
    const worst = assessPattern(
      [0.99, 0.8, 0.6, 0.4, 0.2, 0.01].map((s) => ({ thoroughness: s, latencyRatio: 0.1 })),
    );
    expect(computeSensitivity(worst, 0.99)).toBeLessThanOrEqual(1.5);
  });
});
