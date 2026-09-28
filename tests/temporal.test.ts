import { describe, expect, it } from "vitest";
import type { ApprovalRecord, ReviewSnapshot } from "@/types/attention";
import { DEFAULT_BASELINE, computeBaseline, expectedLatencyMs } from "@/lib/attention/baseline";
import { ATTENTION_CONFIG } from "@/lib/attention/config";
import { evaluateApproval, type Evaluation } from "@/lib/attention/evaluate";
import { assessPattern } from "@/lib/attention/pattern";
import { cusumSeries, temporalFeatures, type TemporalPoint } from "@/lib/attention/temporal";
import { snapshot, target } from "./helpers";

const WORDS = 25;

function record(e: Evaluation, i: number): ApprovalRecord {
  const a = e.assessment;
  return {
    id: `r${i}`,
    requestId: `q${i}`,
    title: "x",
    risk: "LOW",
    decidedAt: 0,
    latencyMs: a.latencyMs,
    expectedLatencyMs: a.expectedLatencyMs,
    latencyRatio: a.latencyRatio,
    attentionScore: a.attentionScore,
    thoroughness: a.thoroughness,
    criticalCoverage: a.criticalCoverage,
    mode: a.mode,
    intervention: e.decision.level,
    sensitivity: e.decision.sensitivity,
    outcome: "approved",
    dwellPerWordMs: a.mode === "gaze" ? 1400 / 15 : null,
    expectedWords: WORDS,
    reasons: [],
    features: [],
  };
}

/** Runs a sequence of approvals through the real engine, carrying baseline and history like the session store. */
function session(snaps: Partial<ReviewSnapshot>[], risk: "LOW" | "MEDIUM" = "LOW") {
  const history: ApprovalRecord[] = [];
  const out: Evaluation[] = [];
  snaps.forEach((s, i) => {
    const e = evaluateApproval({
      snapshot: snapshot(s),
      risk,
      baseline: computeBaseline(history),
      history,
      expectedWords: WORDS,
    });
    out.push(e);
    history.push(record(e, i));
  });
  return { out, history };
}

const attentive = (ms: number): Partial<ReviewSnapshot> => ({
  elapsedMs: ms,
  targets: [target({ severity: "LOW", dwellMs: 1600, visibleMs: ms, fixations: 3, sweep: 0.8 })],
});
const glance = (ms: number): Partial<ReviewSnapshot> => ({
  elapsedMs: ms,
  targets: [target({ severity: "LOW", dwellMs: 0, visibleMs: ms })],
});
const cameraOff: Partial<ReviewSnapshot> = {
  gazeSource: "none",
  calibrated: false,
  calibrationQuality: null,
  frames: { total: 0, face: 0, multiFace: 0, facing: 0, gaze: 0, onScreen: 0 },
};

describe("thoroughness breaks the pattern circularity", () => {
  it("the session pattern does not depend on the pattern weight", () => {
    const weights = ATTENTION_CONFIG.weights.gaze as { pattern: number };
    const original = weights.pattern;
    const run = () => session([attentive(7000), attentive(6500), glance(2600), glance(1500), glance(1300)]).out;
    try {
      const a = run();
      weights.pattern = 0.6;
      const b = run();
      for (let i = 0; i < a.length; i++) {
        expect(b[i].patternAfter).toEqual(a[i].patternAfter);
        expect(b[i].assessment.thoroughness).toBe(a[i].assessment.thoroughness);
      }
      // The attention score (display and policy) still carries the pattern component.
      expect(b[4].assessment.attentionScore).not.toBe(a[4].assessment.attentionScore);
    } finally {
      weights.pattern = original;
    }
  });

  it("thoroughness is the attention evidence without the pattern component", () => {
    const history = [0.95, 0.9, 0.6, 0.35].map((s) => ({ attentionScore: s, thoroughness: s, latencyRatio: 0.3 }));
    const calm = evaluateApproval({ snapshot: snapshot(attentive(7000)), risk: "LOW", baseline: DEFAULT_BASELINE, history: [], expectedWords: WORDS });
    const rushed = evaluateApproval({ snapshot: snapshot(attentive(7000)), risk: "LOW", baseline: DEFAULT_BASELINE, history, expectedWords: WORDS });
    expect(rushed.assessment.thoroughness).toBe(calm.assessment.thoroughness);
    expect(rushed.assessment.attentionScore).toBeLessThan(calm.assessment.attentionScore);
  });
});

describe("temporal features and the CUSUM speed-up detector", () => {
  const latencies = [8.1, 7.4, 6.0, 4.2, 2.0, 1.1];
  const expected = 7.0;
  // Thoroughness eases down but never enough for the decline or streak criteria on their own.
  const thorough = [0.9, 0.9, 0.85, 0.8, 0.75, 0.68];
  const points: TemporalPoint[] = latencies.map((s, i) => ({ thoroughness: thorough[i], latencyRatio: s / expected }));

  it("detects a series like 8.1 -> 7.4 -> 6.0 -> 4.2 -> 2.0 -> 1.1 s", () => {
    const cusum = cusumSeries(points);
    expect(cusum[2]).toBe(0);
    expect(cusum[5]).toBeGreaterThan(ATTENTION_CONFIG.temporal.cusumH);
    const f = temporalFeatures(points);
    expect(f.cusumAlarm).toBe(true);
    expect(f.logLatencySlope).toBeLessThan(0);
    expect(f.index).toBe(6);
    const p = assessPattern(points);
    expect(p.detected).toBe(true);
    expect(p.trigger).toBe("speedup");
    expect(p.message).toBe("Approvals have become steadily faster than the review baseline.");
    expect(p.message).not.toMatch(/tired|fatigue|exhaust/i);
    // Without the speed-up the same thoroughness series is not flagged.
    expect(assessPattern(points.map((q) => ({ ...q, latencyRatio: 1 }))).detected).toBe(false);
  });

  it("summarises recent evidence", () => {
    const f = temporalFeatures([
      { thoroughness: 0.9, latencyRatio: 1, coverage: 1, notObserved: 0 },
      { thoroughness: 0.4, latencyRatio: 0.4, coverage: 0.2, notObserved: 1 },
      { thoroughness: 0.3, latencyRatio: 0.3, coverage: null, notObserved: 0 },
      { thoroughness: 0.2, latencyRatio: 0.2, coverage: 0, notObserved: 1 },
    ]);
    expect(f.rapidStreak).toBe(3);
    expect(f.coverageMean).toBeCloseTo(0.4, 6);
    expect(f.notObservedRecent).toBe(2);
    expect(f.logLatencyMedian).toBeCloseTo((Math.log(0.4) + Math.log(0.3)) / 2, 6);
  });

  it("a consistently fast reader is not flagged", () => {
    // Reads everything, at 55% of the default pace, request after request.
    const { out, history } = session(Array.from({ length: 8 }, () => attentive(2700)));
    expect(computeBaseline(history).source).toBe("personal");
    for (const e of out) {
      expect(e.patternAfter.detected).toBe(false);
      expect(e.decision.level).toBe("NORMAL");
    }
    // Once the baseline is personal, the same pace is simply the expected pace.
    expect(out[7].assessment.latencyRatio).toBeGreaterThan(0.9);
    expect(temporalFeatures(out.map((e) => ({ thoroughness: e.assessment.thoroughness, latencyRatio: e.assessment.latencyRatio }))).cusumAlarm).toBe(false);
  });

  it("two attentive approvals clear a detected pattern, with and without the camera", () => {
    for (const mode of ["gaze", "behavioral"] as const) {
      const extra = mode === "behavioral" ? cameraOff : {};
      const snaps = [7000, 6500, 2600, 1500, 1300, 1100, 7000, 7200, 3600].map((ms, i) =>
        ({ ...(i < 2 || i >= 6 ? attentive(ms) : glance(ms)), ...extra }) as Partial<ReviewSnapshot>,
      );
      const { out } = session(snaps);
      expect(out[5].patternAfter.detected).toBe(true);
      expect(out[7].patternAfter.detected).toBe(false);
      // The speed-up detector restarts at the recovery, so one quicker approval does not re-trigger it.
      expect(out[8].patternAfter.detected).toBe(false);
    }
  });
});

describe("overhead + per-word baseline", () => {
  it("does not over-expect long requests from a baseline built on short ones", () => {
    // Two careful approvals of short (10-word) requests at 3.0 s.
    const short = (ms: number) => ({ ...record(evaluateApproval({ snapshot: snapshot(attentive(ms)), risk: "LOW", baseline: DEFAULT_BASELINE, history: [], expectedWords: 10 }), ms), expectedWords: 10, latencyMs: ms });
    const baseline = computeBaseline([short(3000), short(3000)]);
    const pace = baseline.msPerWordLatency!;
    expect(pace).toBeCloseTo((3000 - 1200) / 10, 6);
    // A 40-word request read in 8 s is at the reviewer's usual pace...
    expect(8000 / expectedLatencyMs(40, baseline)).toBeGreaterThan(0.9);
    // ...where a pure per-word model (3000 ms / 10 words) would have called it 33% fast.
    expect(8000 / (40 * (3000 / 10))).toBeLessThan(0.7);
    // Short requests are dominated by the fixed overhead, not stretched per word.
    expect(expectedLatencyMs(3, baseline)).toBeCloseTo(ATTENTION_CONFIG.latency.overheadMs + 3 * pace, 6);
  });
});
