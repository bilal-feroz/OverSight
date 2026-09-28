/**
 * The judging demo (README / docs/DEMO.md) replayed end to end with SYNTHETIC
 * gaze trajectories through the real tracker, engine and policy:
 *
 *   #1-#2 routine, read attentively      -> NORMAL
 *   #3-#4 routine, rushed                -> NORMAL or NUDGE (low risk never blocks)
 *   #5    "Deploy Database Configuration", title glanced for 1.3 s -> PAUSE on the deletion
 *   re-review of the isolated sentence   -> satisfied after 1-2 s of looking
 *
 * With a good calibration and a steady head. The trajectories are scripted,
 * not recorded: this pins behavior, it does not measure accuracy.
 */
import { describe, expect, it } from "vitest";
import type { ApprovalRecord, ReviewSnapshot } from "@/types/attention";
import { computeBaseline } from "@/lib/attention/baseline";
import type { Evaluation } from "@/lib/attention/evaluate";
import { acknowledgeManually, createReReview, manualAckToken } from "@/lib/attention/rereview";
import { focusRegionFor } from "@/lib/attention/targets";
import {
  CAMERA_OFF,
  approve,
  center,
  openReview,
  pauseLayout,
  play,
  recordOf,
  trajectory,
  type Segment,
  type SimReview,
} from "./sim/gaze-sim";

const NOISE = { noisePx: 22, smoothing: true };

/** Same rule as session-store: dwell per word on visible targets, gaze mode only. */
function dwellPerWord(snapshot: ReviewSnapshot, evaluation: Evaluation): number | null {
  if (evaluation.assessment.mode !== "gaze") return null;
  const visible = snapshot.targets.filter((t) => t.visibleMs > 0);
  const words = visible.reduce((a, t) => a + t.words, 0);
  return words ? visible.reduce((a, t) => a + t.dwellMs, 0) / words : null;
}

/** Title, summary, reasoning, the key detail, then the rest of the consequences. */
function attentiveRead(r: SimReview, scale = 1): Segment[] {
  const at = (id: string) => r.rect(id);
  const key = r.targetIds[0];
  const others = r.layout.regions
    .filter((g) => g.meta.label === "Consequence" && g.meta.id !== key)
    .map((g) => g.meta.id);
  const seq: Segment[] = [
    { kind: "read", line: at("title"), ms: 700 * scale },
    { kind: "move", to: center(at("summary")) },
    { kind: "read", line: at("summary"), ms: 1300 * scale },
    { kind: "move", to: center(at("reasoning")) },
    { kind: "read", line: at("reasoning"), ms: 1700 * scale },
    { kind: "move", to: center(at(key)) },
    { kind: "read", line: at(key), ms: 2200 * scale },
  ];
  for (const id of others) seq.push({ kind: "move", to: center(at(id)) }, { kind: "read", line: at(id), ms: 500 * scale });
  return seq;
}

/** The demo with calibration error `sigma` px (noise on the estimate scales with it). */
function runDemo(sigma = 60) {
  const history: ApprovalRecord[] = [];
  const decide = (id: string, script: (r: SimReview) => Segment[], seed: number) => {
    const baseline = computeBaseline(history);
    const r = openReview(id, { baseline, signal: { gazeSigmaPx: { x: sigma, y: sigma } } });
    const frames = trajectory(script(r), {
      viewport: r.layout.viewport,
      ...NOISE,
      noisePx: sigma === 60 ? NOISE.noisePx : sigma * 0.35,
      sigmaPx: { x: sigma, y: sigma },
      seed,
      start: center(r.rect("title")),
    });
    play(r.session, r.geo, frames);
    const snapshot = r.session.snapshot();
    const evaluation = approve(r, { baseline, history });
    return { r, snapshot, evaluation, baseline };
  };

  const routine: Array<[string, (r: SimReview) => Segment[]]> = [
    ["weekly-report", (r) => attentiveRead(r)],
    ["dependency-patch", (r) => attentiveRead(r, 0.85)],
    [
      "tls-renewal",
      (r) => [
        { kind: "read", line: r.rect("title"), ms: 900 },
        { kind: "move", to: center(r.rect("summary")) },
        { kind: "read", line: r.rect("summary"), ms: 700 },
        { kind: "move", to: center(r.rect(r.targetIds[0])) },
        { kind: "dwell", at: center(r.rect(r.targetIds[0])), ms: 600 },
      ],
    ],
    [
      "preview-scale-down",
      (r) => [
        { kind: "read", line: r.rect("title"), ms: 900 },
        { kind: "move", to: center(r.rect("summary")) },
        { kind: "dwell", at: center(r.rect("summary")), ms: 450 },
      ],
    ],
  ];
  const steps = routine.map(([id, script], i) => {
    const step = decide(id, script, 10 + i);
    history.push(recordOf(step.r, step.evaluation, dwellPerWord(step.snapshot, step.evaluation)));
    return step;
  });
  const trap = decide("db-config", (r) => [{ kind: "read", line: r.rect("title"), ms: 1300 }], 99);
  return { steps, trap, history };
}

describe("judging demo holds across realistic calibration error", () => {
  for (const sigma of [80, 100]) {
    it(`sigma ${sigma} px: routine passes, the trap pauses on conclusive gaze evidence`, () => {
      const { steps, trap } = runDemo(sigma);
      expect(steps[0].evaluation.decision.level).toBe("NORMAL");
      expect(steps[1].evaluation.decision.level).toBe("NORMAL");
      for (const s of steps.slice(2)) expect(["NORMAL", "NUDGE"]).toContain(s.evaluation.decision.level);
      const { assessment, decision } = trap.evaluation;
      expect(decision.level).toBe("PAUSE");
      expect(assessment.trust.level).toBe("high");
      expect(assessment.targetCoverage[0].strength).toBe("not-observed");
      expect(decision.reasons.map((x) => x.text).join("\n")).toMatch(/received almost no visual attention/);
    });
  }
});

describe("judging demo on synthetic trajectories", () => {
  it("routine approvals pass: attentive reviews NORMAL, rushed ones at most a nudge", () => {
    const { steps } = runDemo();
    expect(steps[0].evaluation.decision.level).toBe("NORMAL");
    expect(steps[1].evaluation.decision.level).toBe("NORMAL");
    for (const s of steps.slice(2)) expect(["NORMAL", "NUDGE"]).toContain(s.evaluation.decision.level);
    // Two attentive reviews form a personal baseline before the trap.
    expect(computeBaseline(runDemo().history).source).toBe("personal");
  });

  it("the trap, approved after a 1.3 s glance at the title, pauses on the deletion", () => {
    const { trap } = runDemo();
    const { assessment, decision, patternAfter } = trap.evaluation;
    expect(trap.r.analysis.overallRisk).toBe("CRITICAL");
    expect(decision.level).toBe("PAUSE");
    expect(decision.verification).toBe("gaze");
    expect(assessment.criticalCoverage).toBe(0);
    const focus = focusRegionFor(trap.r.request, trap.r.analysis, assessment.targetCoverage[0].id);
    expect(focus.statement).toBe("2,431 customer records will be permanently deleted.");
    const texts = decision.reasons.map((x) => x.text).join("\n");
    expect(texts).toMatch(/received almost no visual attention/);
    expect(texts).toMatch(/below your baseline/);
    // The session reports the decline that led here.
    expect(patternAfter.detected).toBe(true);
    expect(texts).toMatch(/declined across \d+ consecutive approvals/);
  });

  it("gaze re-review of the isolated sentence is satisfied after 1-2 s of looking", () => {
    const { trap } = runDemo();
    const r = trap.r;
    const required = trap.snapshot.targets.find((t) => t.id === "impact-2")!.requiredDwellMs;
    r.session.startReReview(createReReview("review:impact-2", required, "gaze"));
    r.geo.layout = pauseLayout(r.layout, r.request.id, "impact-2", "CRITICAL");
    const review = r.geo.layout.regions[0].rect;
    const t0 = r.geo.t;
    const frames = trajectory(
      [
        { kind: "move", to: center(review), ms: 120 },
        { kind: "read", line: review, ms: 3000, fixations: 10 },
      ],
      { viewport: r.layout.viewport, ...NOISE, seed: 7, startT: t0, start: { x: 700, y: 120 } },
    );
    let satisfiedAt: number | null = null;
    for (const f of frames) {
      play(r.session, r.geo, [f]);
      if (satisfiedAt === null && r.session.reReview?.satisfied) satisfiedAt = f.t - t0;
    }
    expect(satisfiedAt).not.toBeNull();
    expect(satisfiedAt!).toBeGreaterThanOrEqual(900);
    expect(satisfiedAt!).toBeLessThanOrEqual(2000);
  });

  it("manual acknowledgement of the key quantity works", () => {
    const token = manualAckToken("2,431 customer records will be permanently deleted.");
    const state = createReReview("review:impact-2", 1170, "manual");
    expect(acknowledgeManually(state, { typed: "2431", expectedToken: token }).satisfied).toBe(true);
    expect(acknowledgeManually(state, { typed: "2341", expectedToken: token }).satisfied).toBe(false);
  });

  it("camera off: the fast critical approval pauses and asks for manual verification", () => {
    const r = openReview("db-config", { signal: CAMERA_OFF });
    play(r.session, r.geo, [], 1300);
    const { decision } = approve(r);
    expect(decision.level).toBe("PAUSE");
    expect(decision.verification).toBe("manual");
  });
});
