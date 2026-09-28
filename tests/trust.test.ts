import { afterEach, describe, expect, it, vi } from "vitest";
import type { RiskLevel } from "@/types/approval";
import type { AttentionAssessment, InterventionLevel, ReviewSnapshot, SessionPattern, TrustLevel } from "@/types/attention";
import { INTERVENTION_ORDER } from "@/types/attention";
import { DEFAULT_BASELINE } from "@/lib/attention/baseline";
import { assessSignal } from "@/lib/attention/engine";
import { evaluateApproval } from "@/lib/attention/evaluate";
import { assessPattern } from "@/lib/attention/pattern";
import { assessGazeTrust } from "@/lib/attention/trust";
import { isCalibrationStale } from "@/lib/cv/calibration";
import { getGazeHub } from "@/lib/cv/gaze-hub";
import { isSimulationAllowed } from "@/lib/cv/simulated";
import { THRESHOLDS, computeSensitivity, decideIntervention } from "@/lib/risk/intervention";
import { useCvStore } from "@/lib/store/cv-store";
import { snapshot, target, trustOf } from "./helpers";
import { center, openReview, play, trajectory } from "./sim/gaze-sim";

const RISKS: RiskLevel[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const ORDER = INTERVENTION_ORDER;

function trustFor(snap: ReviewSnapshot) {
  return assessGazeTrust(snap, assessSignal(snap));
}

describe("gaze trust levels", () => {
  const cases: Array<[string, Partial<ReviewSnapshot>, TrustLevel]> = [
    ["good calibration, 30 fps, one face", {}, "high"],
    ["fair calibration", { calibrationQuality: "fair" }, "medium"],
    ["poor calibration", { calibrationQuality: "poor" }, "low"],
    ["stale calibration", { calibrationStale: true }, "none"],
    ["legacy calibration", { legacyCalibration: true }, "medium"],
    ["7 gaze frames per second", { effectiveFps: 7 }, "medium"],
    ["3 gaze frames per second", { effectiveFps: 3 }, "low"],
    ["camera off", { gazeSource: "none", calibrated: false, calibrationQuality: null }, "none"],
    ["not calibrated", { calibrated: false, calibrationQuality: null }, "none"],
    ["face lost most of the time", { frames: { total: 39, face: 4, multiFace: 0, facing: 4, gaze: 4, onScreen: 4 } }, "none"],
    ["second face in view", { frames: { total: 39, face: 20, multiFace: 19, facing: 20, gaze: 39, onScreen: 39 } }, "none"],
    ["face tracking intermittent", { frames: { total: 40, face: 22, multiFace: 0, facing: 14, gaze: 22, onScreen: 22 } }, "medium"],
  ];
  for (const [name, overrides, level] of cases) {
    it(`${name} => ${level}`, () => {
      const trust = trustFor(snapshot(overrides));
      expect(trust.level).toBe(level);
      if (level !== "high" && level !== "none") expect(trust.reasons.length).toBeGreaterThan(0);
      expect(trust.confidence).toBeGreaterThanOrEqual(0);
      expect(trust.confidence).toBeLessThanOrEqual(1);
    });
  }

  it("uses gaze only at high or medium trust", () => {
    const run = (overrides: Partial<ReviewSnapshot>) =>
      evaluateApproval({
        snapshot: snapshot({ targets: [target({ dwellMs: 40 })], ...overrides }),
        risk: "CRITICAL",
        baseline: DEFAULT_BASELINE,
        history: [],
        expectedWords: 25,
      }).assessment;
    expect(run({}).mode).toBe("gaze");
    expect(run({ calibrationQuality: "fair" }).mode).toBe("gaze");
    expect(run({ calibrationQuality: "poor" }).mode).toBe("behavioral");
    expect(run({ calibrationStale: true }).mode).toBe("behavioral");
  });
});

/**
 * Frozen copy of the pre-V2 policy (level only), used as the oracle for
 * "with high trust, results equal today's".
 */
function legacyLevel(a: AttentionAssessment, risk: RiskLevel, pattern: SessionPattern): InterventionLevel {
  const sens = computeSensitivity(pattern, null);
  const up = (t: number) => Math.min(0.95, t * sens);
  const down = (t: number) => t / sens;
  let level: InterventionLevel = "NORMAL";
  const cov = a.criticalCoverage;
  const allNeverVisible = a.targetCoverage.length > 0 && a.targetsNeverVisible === a.targetCoverage.length;
  const G = THRESHOLDS.gaze;
  const B = THRESHOLDS.behavioral;
  if (a.mode === "gaze" && cov !== null) {
    if (risk === "CRITICAL") {
      if (cov < up(G.CRITICAL.pauseCoverage)) level = "PAUSE";
      else if (cov < up(G.CRITICAL.refocusCoverage) || a.attentionScore < up(G.CRITICAL.refocusScore)) level = "REFOCUS";
      else if (a.attentionScore < up(G.CRITICAL.nudgeScore)) level = "NUDGE";
    } else if (risk === "HIGH") {
      if (cov < up(G.HIGH.pauseCoverage) && (a.anomaly >= down(G.HIGH.pauseAnomaly) || a.attentionScore < up(G.HIGH.pauseScore)))
        level = "PAUSE";
      else if (cov < up(G.HIGH.refocusCoverage) || a.attentionScore < up(G.HIGH.refocusScore)) level = "REFOCUS";
      else if (a.attentionScore < up(G.HIGH.nudgeScore)) level = "NUDGE";
    } else if (risk === "MEDIUM") {
      if (cov < up(G.MEDIUM.refocusCoverage) && a.attentionScore < up(G.MEDIUM.refocusScore) && a.anomaly >= down(G.MEDIUM.refocusAnomaly))
        level = "REFOCUS";
      else if (a.attentionScore < up(G.MEDIUM.nudgeScore) || cov < up(G.MEDIUM.nudgeCoverage)) level = "NUDGE";
    } else if (pattern.detected && a.attentionScore < up(G.LOW.nudgeScore)) level = "NUDGE";
  } else if (allNeverVisible && (risk === "HIGH" || risk === "CRITICAL")) {
    level = "REFOCUS";
  } else if (risk === "CRITICAL") {
    if (a.latencyRatio < up(B.CRITICAL.pauseLatency) || a.anomaly >= down(B.CRITICAL.pauseAnomaly)) level = "PAUSE";
    else if (a.latencyRatio < up(B.CRITICAL.refocusLatency)) level = "REFOCUS";
    else level = "NUDGE";
  } else if (risk === "HIGH") {
    if (a.latencyRatio < up(B.HIGH.refocusLatency) || a.anomaly >= down(B.HIGH.refocusAnomaly)) level = "REFOCUS";
    else if (a.attentionScore < up(B.HIGH.nudgeScore)) level = "NUDGE";
  } else if (risk === "MEDIUM") {
    if (a.latencyRatio < up(B.MEDIUM.nudgeLatency)) level = "NUDGE";
  } else if (pattern.detected && a.latencyRatio < up(B.LOW.nudgeLatency)) level = "NUDGE";
  if (a.targetsNeverVisible > 0 && (risk === "HIGH" || risk === "CRITICAL") && ORDER[level] < ORDER.REFOCUS) level = "REFOCUS";
  return level;
}

function* assessments(): Generator<AttentionAssessment> {
  for (const cov of [0, 0.1, 0.2, 0.3, 0.5, 0.7, 1])
    for (const score of [0.15, 0.4, 0.55, 0.7, 0.95])
      for (const latencyRatio of [0.1, 0.3, 0.45, 0.8, 1.3])
        for (const anomaly of [0, 0.55, 0.9])
          for (const neverVisible of [0, 1]) {
            yield {
              mode: "gaze",
              attentionScore: score,
              behavioralScore: Math.min(1, score + 0.1),
              trust: trustOf("high"),
              confidence: "high",
              confidenceValue: 0.9,
              criticalCoverage: neverVisible ? null : cov,
              targetCoverage: [{ id: "t", coverage: cov, visible: !neverVisible }],
              targetsMissed: 0,
              targetsNeverVisible: neverVisible,
              latencyMs: latencyRatio * 5000,
              expectedLatencyMs: 5000,
              latencyRatio,
              anomaly,
              components: [],
              reasons: [],
            };
          }
}

describe("evidence fusion", () => {
  const patterns = [
    assessPattern([]),
    assessPattern([0.95, 0.9, 0.6, 0.35].map((s) => ({ attentionScore: s, latencyRatio: 0.3 }))),
  ];

  it("with high trust the decision equals the pre-V2 policy", () => {
    let n = 0;
    for (const a of assessments())
      for (const risk of RISKS)
        for (const pattern of patterns) {
          expect(decideIntervention(a, { risk, pattern }).level).toBe(legacyLevel(a, risk, pattern));
          n++;
        }
    expect(n).toBeGreaterThan(5000);
  });

  it("below high trust the level never falls below the behavioral floor, and gaze alone never pauses", () => {
    for (const trust of ["medium", "low", "none"] as TrustLevel[])
      for (const base of assessments())
        for (const risk of RISKS)
          for (const pattern of patterns) {
            // What the engine produces at this trust: gaze only at medium.
            const a: AttentionAssessment =
              trust === "medium"
                ? { ...base, trust: trustOf(trust) }
                : { ...base, mode: "behavioral", criticalCoverage: null, attentionScore: base.behavioralScore, trust: trustOf(trust) };
            const d = decideIntervention(a, { risk, pattern });
            expect(ORDER[d.level]).toBeGreaterThanOrEqual(ORDER[d.behavioralLevel]);
            if (d.level === "PAUSE") expect(d.behavioralLevel).toBe("PAUSE");
            if (ORDER[d.level] >= ORDER.REFOCUS) expect(d.verification).toBe(trust === "medium" ? "gaze" : "manual");
          }
  });

  it("the behavioral mode is unchanged from the pre-V2 policy", () => {
    for (const base of assessments())
      for (const risk of RISKS)
        for (const pattern of patterns) {
          const a: AttentionAssessment = {
            ...base,
            mode: "behavioral",
            criticalCoverage: null,
            attentionScore: base.behavioralScore,
            trust: trustOf("none"),
          };
          expect(decideIntervention(a, { risk, pattern }).level).toBe(legacyLevel(a, risk, pattern));
        }
  });

  it("a fast CRITICAL approval intervenes at every trust level", () => {
    const fast: Partial<ReviewSnapshot> = { elapsedMs: 1300, targets: [target({ dwellMs: 40 })] };
    const variants: Array<[TrustLevel, Partial<ReviewSnapshot>]> = [
      ["high", {}],
      ["medium", { calibrationQuality: "fair" }],
      ["low", { calibrationQuality: "poor" }],
      ["none", { calibrationStale: true }],
      ["none", { gazeSource: "none", calibrated: false, calibrationQuality: null, frames: { total: 0, face: 0, multiFace: 0, facing: 0, gaze: 0, onScreen: 0 } }],
    ];
    for (const [level, overrides] of variants) {
      const { assessment, decision } = evaluateApproval({
        snapshot: snapshot({ ...fast, ...overrides }),
        risk: "CRITICAL",
        baseline: DEFAULT_BASELINE,
        history: [],
        expectedWords: 25,
      });
      expect(assessment.trust.level).toBe(level);
      expect(ORDER[decision.level]).toBeGreaterThanOrEqual(ORDER.REFOCUS);
    }
  });

  it("a stale or poor calibration can no longer produce a gaze-judged PAUSE", () => {
    // Slow approval (well over the expected time), gaze says the consequence got nothing.
    for (const overrides of [{ calibrationStale: true }, { calibrationQuality: "poor" as const }]) {
      const { assessment, decision } = evaluateApproval({
        snapshot: snapshot({ elapsedMs: 9000, targets: [target({ dwellMs: 0, visibleMs: 9000 })], ...overrides }),
        risk: "CRITICAL",
        baseline: DEFAULT_BASELINE,
        history: [],
        expectedWords: 25,
      });
      expect(assessment.mode).toBe("behavioral");
      expect(decision.level).not.toBe("PAUSE");
      expect(assessment.reasons.map((r) => r.code)).not.toContain("coverage-none");
    }
    // The same review with a good calibration is paused on gaze evidence.
    const good = evaluateApproval({
      snapshot: snapshot({ elapsedMs: 9000, targets: [target({ dwellMs: 0, visibleMs: 9000 })] }),
      risk: "CRITICAL",
      baseline: DEFAULT_BASELINE,
      history: [],
      expectedWords: 25,
    });
    expect(good.decision.level).toBe("PAUSE");
  });

  it("medium trust caps a gaze-only pause at REFOCUS and explains why", () => {
    const { decision } = evaluateApproval({
      snapshot: snapshot({ elapsedMs: 9000, calibrationQuality: "fair", targets: [target({ dwellMs: 0, visibleMs: 9000 })] }),
      risk: "CRITICAL",
      baseline: DEFAULT_BASELINE,
      history: [],
      expectedWords: 25,
    });
    expect(decision.gazeLevel).toBe("PAUSE");
    expect(decision.level).toBe("REFOCUS");
    expect(decision.verification).toBe("gaze");
    const codes = decision.reasons.map((r) => r.code);
    expect(codes).toContain("trust-fair");
    expect(codes).toContain("confirm");
  });
});

describe("calibration staleness", () => {
  const model = {
    viewport: { width: 1440, height: 900 },
    screen: { x: 100, y: 50 },
    dpr: 2,
  };
  const at = (screen: { x: number; y: number }, dpr = 2, viewport = model.viewport) => ({ viewport, screen, dpr });

  it("goes stale when the window moves more than 40 px", () => {
    expect(isCalibrationStale(model, at({ x: 120, y: 60 }))).toBe(false);
    expect(isCalibrationStale(model, at({ x: 150, y: 50 }))).toBe(true);
  });

  it("goes stale when the zoom / devicePixelRatio changes", () => {
    expect(isCalibrationStale(model, at(model.screen, 2))).toBe(false);
    expect(isCalibrationStale(model, at(model.screen, 2.5))).toBe(true);
  });

  it("still goes stale on a resize, and ignores fields a v1 model never stored", () => {
    expect(isCalibrationStale(model, at(model.screen, 2, { width: 1440, height: 760 }))).toBe(true);
    expect(isCalibrationStale({ viewport: model.viewport }, at({ x: 900, y: 900 }, 1))).toBe(false);
  });
});

describe("frame rate", () => {
  it("a 5 fps camera no longer under-counts dwell by more than 20%", () => {
    const r = openReview("db-config");
    const critical = r.rect("impact-2");
    play(r.session, r.geo, trajectory([{ kind: "dwell", at: center(critical), ms: 3000 }], { viewport: r.layout.viewport, fps: 5 }), 3000);
    const snap = r.session.snapshot();
    const truth = 3000 - 500; // gaze on the target after the orientation delay
    expect(Math.abs(snap.targets[0].dwellMs - truth) / truth).toBeLessThan(0.2);
    expect(snap.effectiveFps).toBeCloseTo(5, 0);
    // ...and the slow camera lowers trust instead.
    expect(trustFor(snap).level).toBe("medium");
  });
});

describe("simulated gaze", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is refused in production builds", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isSimulationAllowed()).toBe(false);
    getGazeHub().setSimulated(true);
    expect(useCvStore.getState().simulated).toBe(false);
    expect(getGazeHub().source).toBe("none");
    // Even a simulated snapshot is not evidence there.
    expect(trustFor(snapshot({ gazeSource: "simulated" })).level).toBe("none");
  });

  it("stays available, and labeled, in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isSimulationAllowed()).toBe(true);
    const trust = trustFor(snapshot({ gazeSource: "simulated" }));
    expect(trust.simulated).toBe(true);
    expect(assessSignal(snapshot({ gazeSource: "simulated" })).notes.map((n) => n.code)).toContain("simulated");
  });
});

describe("separability", () => {
  const rects = (sigmaGap: number) => {
    // Title and summary at the top; the critical line `sigmaGap` px below the summary.
    const title = { left: 24, top: 110, width: 694, height: 30, role: "context" as const, label: "Title" };
    const summary = { left: 24, top: 140, width: 694, height: 32, role: "context" as const, label: "Summary" };
    const critical = { left: 24, top: 172 + sigmaGap, width: 694, height: 64, role: "target" as const, label: "Consequence" };
    return { title, summary, "impact-3": critical };
  };

  it("caps trust at low when gaze error is too large to tell the critical line from the title/summary", () => {
    const wide = trustFor(snapshot({ regionRects: rects(300), gazeSigmaPx: { x: 60, y: 200 } }));
    expect(wide.separation).toBeCloseTo(1.5, 5);
    expect(wide.level).toBe("low");
    expect(wide.reasons.map((r) => r.code)).toContain("trust-separation");
  });

  it("keeps high trust when the layout separates them at the measured error", () => {
    const ok = trustFor(snapshot({ regionRects: rects(300), gazeSigmaPx: { x: 60, y: 80 } }));
    expect(ok.separation).toBeCloseTo(3.75, 5);
    expect(ok.level).toBe("high");
  });
});
