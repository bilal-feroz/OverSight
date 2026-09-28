import { describe, expect, it } from "vitest";
import { evaluateApproval } from "@/lib/attention/evaluate";
import { DEFAULT_BASELINE, computeBaseline, expectedLatencyMs } from "@/lib/attention/baseline";
import type { ApprovalRecord } from "@/types/attention";
import { attentiveSnapshot, snapshot, target } from "./helpers";

const TRAP_WORDS = 25; // title + summary + critical sentence

function run(
  snap = snapshot(),
  opts: { risk?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; history?: { attentionScore: number; latencyRatio: number }[] } = {},
) {
  return evaluateApproval({
    snapshot: snap,
    risk: opts.risk ?? "CRITICAL",
    baseline: DEFAULT_BASELINE,
    history: opts.history ?? [],
    expectedWords: TRAP_WORDS,
  });
}

describe("AttentionEngine + InterventionEngine", () => {
  it("high risk + low attention => PAUSE", () => {
    const { assessment, decision } = run(snapshot({ targets: [target({ dwellMs: 40 })] }));
    expect(assessment.mode).toBe("gaze");
    expect(assessment.criticalCoverage).toBeLessThan(0.05);
    expect(assessment.attentionScore).toBeLessThan(0.4);
    expect(decision.level).toBe("PAUSE");
    expect(decision.verification).toBe("gaze");
    const codes = decision.reasons.map((r) => r.code);
    expect(codes).toContain("coverage-none");
    expect(codes).toContain("latency");
    expect(codes).toContain("latency-baseline");
    expect(decision.reasons[0].tone).toBe("critical");
  });

  it("HIGH (not critical) risk pauses when coverage is near zero and the approval is anomalous", () => {
    const { decision } = run(snapshot({ targets: [target({ severity: "HIGH", dwellMs: 0 })] }), { risk: "HIGH" });
    expect(decision.level).toBe("PAUSE");
  });

  it("high risk + good attention => allow", () => {
    const { assessment, decision } = run(attentiveSnapshot());
    expect(assessment.criticalCoverage).toBe(1);
    expect(assessment.attentionScore).toBeGreaterThan(0.8);
    expect(decision.level).toBe("NORMAL");
    expect(decision.verification).toBe("none");
    expect(decision.reasons[0].tone).toBe("positive");
  });

  it("low risk + low attention => no excessive intervention", () => {
    const lowSnap = snapshot({ elapsedMs: 700, targets: [target({ severity: "LOW", dwellMs: 0 })] });
    expect(run(lowSnap, { risk: "LOW" }).decision.level).toBe("NORMAL");

    // Even inside a detected low-attention pattern, LOW risk is at most a nudge.
    const history = [0.95, 0.9, 0.6, 0.35].map((s) => ({ attentionScore: s, latencyRatio: 0.3 }));
    const { decision, patternAfter } = run(lowSnap, { risk: "LOW", history });
    expect(patternAfter.detected).toBe(true);
    expect(decision.level).toBe("NUDGE");
  });

  it("face unavailable => behavioral fallback, never an accusation of not reading", () => {
    const snap = snapshot({
      frames: { total: 39, face: 4, multiFace: 0, facing: 4, gaze: 4, onScreen: 4 },
      targets: [target({ dwellMs: 0 })],
    });
    const { assessment, decision } = run(snap);
    expect(assessment.mode).toBe("behavioral");
    expect(assessment.criticalCoverage).toBeNull();
    expect(assessment.confidence).toBe("low");
    const codes = assessment.reasons.map((r) => r.code);
    expect(codes).toContain("face-lost");
    expect(codes).not.toContain("coverage-none");
    // A fast critical approval still needs explicit, manual acknowledgement.
    expect(decision.level).toBe("PAUSE");
    expect(decision.verification).toBe("manual");
  });

  it("camera off => behavioral signals only", () => {
    const snap = snapshot({
      gazeSource: "none",
      calibrated: false,
      calibrationQuality: null,
      frames: { total: 0, face: 0, multiFace: 0, facing: 0, gaze: 0, onScreen: 0 },
    });
    const { assessment } = run(snap);
    expect(assessment.mode).toBe("behavioral");
    expect(assessment.components.map((c) => c.key)).toEqual(["latency", "visibility", "interaction", "pattern"]);
    expect(assessment.reasons.map((r) => r.code)).toContain("camera-off");
  });

  it("multiple faces => gaze evidence marked unreliable", () => {
    const snap = snapshot({ frames: { total: 39, face: 20, multiFace: 19, facing: 20, gaze: 39, onScreen: 39 } });
    const { assessment } = run(snap);
    expect(assessment.mode).toBe("behavioral");
    expect(assessment.reasons.map((r) => r.code)).toContain("multi-face");
  });

  it("critical region not visible => gaze is not penalized", () => {
    const snap = snapshot({ elapsedMs: 4000, targets: [target({ visibleMs: 0, dwellMs: 0 })] });
    const { assessment, decision } = run(snap);
    expect(assessment.criticalCoverage).toBeNull();
    const codes = assessment.reasons.map((r) => r.code);
    expect(codes).toContain("never-visible");
    expect(codes).not.toContain("coverage-none");
    expect(assessment.components.find((c) => c.key === "coverage")?.available).toBe(false);
    // The fix is to bring it on screen, not to accuse the reviewer.
    expect(decision.level).toBe("REFOCUS");
  });

  it("rapid approval streak => behavioral anomaly and sensitivity increase", () => {
    const snap = snapshot({ elapsedMs: 1500, targets: [target({ dwellMs: 700, visibleMs: 1500 })] });
    const calm = run(snap, { history: [] });
    const rapidHistory = [0.9, 0.8, 0.7, 0.6].map((s) => ({ attentionScore: s, latencyRatio: 0.25 }));
    const rushed = run(snap, { history: rapidHistory });
    expect(rushed.assessment.anomaly).toBeGreaterThan(calm.assessment.anomaly);
    expect(rushed.decision.sensitivity).toBeGreaterThan(calm.decision.sensitivity);
    expect(rushed.decision.reasons.map((r) => r.code)).toContain("streak");
  });

  it("repeated rapid approvals escalate the intervention for the same evidence", () => {
    // Partial attention on a HIGH-risk consequence: acceptable in a calm session...
    const snap = snapshot({
      elapsedMs: 3200,
      targets: [target({ severity: "HIGH", dwellMs: 700, visibleMs: 3200, fixations: 1, sweep: 0.4 })],
    });
    const calm = run(snap, { risk: "HIGH" });
    // ...but not after a run of rubber-stamped approvals.
    const history = [0.92, 0.85, 0.6, 0.4, 0.3].map((s) => ({ attentionScore: s, latencyRatio: 0.3 }));
    const rushed = run(snap, { risk: "HIGH", history });
    const order = { NORMAL: 0, NUDGE: 1, REFOCUS: 2, PAUSE: 3 } as const;
    expect(order[rushed.decision.level]).toBeGreaterThan(order[calm.decision.level]);
  });

  it("simulated gaze is labeled in the reasons", () => {
    const { assessment } = run(attentiveSnapshot({ gazeSource: "simulated" }));
    expect(assessment.reasons.map((r) => r.code)).toContain("simulated");
  });
});

describe("personal baseline", () => {
  const record = (latencyMs: number, words: number, score: number, dwellPerWordMs: number): ApprovalRecord => ({
    id: `r-${latencyMs}`,
    requestId: "x",
    title: "x",
    risk: "LOW",
    decidedAt: 0,
    latencyMs,
    expectedLatencyMs: 0,
    latencyRatio: 1,
    attentionScore: score,
    thoroughness: score,
    criticalCoverage: 1,
    mode: "gaze",
    intervention: "NORMAL",
    sensitivity: 1,
    outcome: "approved",
    dwellPerWordMs,
    expectedWords: words,
    reasons: [],
    features: [],
  });

  it("uses defaults until two attentive reviews exist", () => {
    expect(computeBaseline([record(6000, 30, 0.9, 100)]).source).toBe("default");
  });

  it("models review time as overhead + per-word pace from attentive approvals only, frozen after five", () => {
    const baseline = computeBaseline([
      record(6000, 30, 0.9, 100), // (6000 - 1200) / 30 = 160 ms/word
      record(9000, 30, 0.95, 120), // 260
      record(1000, 30, 0.2, 10), // rubber-stamped: ignored
      record(7500, 30, 0.9, 110), // 210
      record(4200, 30, 0.9, 90), // 100
      record(5700, 30, 0.9, 95), // 150
      record(3000, 30, 0.9, 50), // 6th attentive: baseline already frozen
    ]);
    expect(baseline.source).toBe("personal");
    expect(baseline.samples).toBe(5);
    expect(baseline.overheadMs).toBe(1200);
    expect(baseline.msPerWordLatency).toBeCloseTo(160, 5);
    expect(baseline.msPerWordDwell).toBe(100);
    expect(expectedLatencyMs(24, baseline)).toBe(1200 + 24 * 160);
  });

  it("ignores approvals that needed an intervention", () => {
    const refocused = { ...record(6000, 30, 0.9, 100), intervention: "REFOCUS" as const };
    const nudged = { ...record(6500, 30, 0.9, 100), intervention: "NUDGE" as const };
    expect(computeBaseline([refocused, nudged, record(7000, 30, 0.9, 100)]).source).toBe("default");
  });
});
