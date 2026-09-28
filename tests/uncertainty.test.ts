/**
 * Uncertainty-aware gaze evidence, driven by SYNTHETIC trajectories through
 * the real tracker, engine and policy (tests/sim/gaze-sim.ts).
 */
import { describe, expect, it } from "vitest";
import type { PostureModel } from "@/types/cv";
import { INTERVENTION_ORDER } from "@/types/attention";
import { assessSignal } from "@/lib/attention/engine";
import { evidenceStrength, softWeight } from "@/lib/attention/regions";
import { assessGazeTrust } from "@/lib/attention/trust";
import { CV_CONFIG } from "@/lib/cv/config";
import { gazeEstimate, postureInflation, postureZ } from "@/lib/cv/uncertainty";
import { approve, center, openReview, play, trajectory, type Segment, type SimReview } from "./sim/gaze-sim";

const sigmaOf = (s: number) => ({ x: s, y: s });

function review(sigma: number, opts: Parameters<typeof openReview>[1] = {}) {
  return openReview("db-config", { ...opts, signal: { gazeSigmaPx: sigmaOf(sigma), ...opts.signal } });
}

function run(r: SimReview, segments: Segment[], sigma: number, extra: Partial<Parameters<typeof trajectory>[1]> = {}) {
  const frames = trajectory(segments, {
    viewport: r.layout.viewport,
    noisePx: sigma * 0.35,
    smoothing: true,
    seed: 5,
    sigmaPx: sigmaOf(sigma),
    start: center(r.rect("title")),
    ...extra,
  });
  play(r.session, r.geo, frames);
  return approve(r);
}

describe("soft region evidence", () => {
  it("weights gaze by its distance from a region in sigma units", () => {
    const rect = { left: 100, top: 100, width: 200, height: 50 };
    expect(softWeight(rect, 150, 120, sigmaOf(60))).toBe(1);
    expect(softWeight(rect, 150, 210, sigmaOf(60))).toBeCloseTo(Math.exp(-0.5), 6);
    expect(softWeight(rect, 150, 270, sigmaOf(60))).toBeCloseTo(Math.exp(-2), 6);
    expect(evidenceStrength({ visible: true, conclusive: true, coverage: 0.7, fixations: 1 })).toBe("strong");
    expect(evidenceStrength({ visible: true, conclusive: true, coverage: 0.7, fixations: 0 })).toBe("partial");
    expect(evidenceStrength({ visible: true, conclusive: true, coverage: 0.1, fixations: 0 })).toBe("not-observed");
    expect(evidenceStrength({ visible: true, conclusive: false, coverage: 0, fixations: 0 })).toBe("inconclusive");
    expect(evidenceStrength({ visible: false, conclusive: true, coverage: 0, fixations: 0 })).toBe("not-visible");
  });

  it("gaze on the title with sigma 80: the consequence is not observed and the critical request pauses", () => {
    const r = review(80);
    const { assessment, decision } = run(r, [{ kind: "read", line: r.rect("title"), ms: 1300 }], 80);
    expect(assessment.criticalCoverage).toBeLessThan(0.05);
    expect(assessment.targetCoverage[0].conclusive).toBe(true);
    expect(assessment.targetCoverage[0].strength).toBe("not-observed");
    expect(decision.level).toBe("PAUSE");
    expect(decision.reasons.map((x) => x.text).join("\n")).toMatch(/received almost no visual attention/);
  });

  it("1.5 s on the critical line with sigma 80: strong evidence, NORMAL", () => {
    const r = review(80);
    const critical = r.rect("impact-2");
    const { assessment, decision } = run(
      r,
      [
        { kind: "read", line: r.rect("title"), ms: 400 },
        { kind: "move", to: center(critical) },
        { kind: "read", line: critical, ms: 1500, fixations: 6 },
      ],
      80,
    );
    expect(assessment.criticalCoverage).toBeGreaterThanOrEqual(0.6);
    expect(assessment.targetCoverage[0].strength).toBe("strong");
    expect(decision.level).toBe("NORMAL");
  });

  it("sigma 250: title and consequence cannot be told apart, gaze stays silent and behavior decides", () => {
    const r = review(250);
    const { assessment, decision } = run(r, [{ kind: "read", line: r.rect("title"), ms: 1300 }], 250);
    const target = assessment.targetCoverage[0];
    expect(target.conclusive).toBe(false);
    expect(target.strength).toBe("inconclusive");
    expect(target.separation).toBeLessThan(2);
    expect(assessment.trust.level).toBe("low");
    expect(assessment.mode).toBe("behavioral");
    const texts = decision.reasons.map((x) => x.text).join("\n");
    expect(texts).not.toMatch(/received almost no visual attention/);
    // A fast critical approval still needs at least a refocus, verified manually.
    expect(INTERVENTION_ORDER[decision.level]).toBeGreaterThanOrEqual(INTERVENTION_ORDER.REFOCUS);
    expect(decision.verification).toBe("manual");
  });

  it("critical region below the viewport: no gaze penalty", () => {
    const r = review(80, { layout: { viewport: { width: 1440, height: 520 } } });
    const { assessment, decision } = run(r, [{ kind: "read", line: r.rect("title"), ms: 3000 }], 80);
    expect(assessment.criticalCoverage).toBeNull();
    expect(assessment.targetCoverage[0].strength).toBe("not-visible");
    expect(assessment.reasons.map((x) => x.code)).not.toContain("coverage-none");
    expect(decision.level).toBe("REFOCUS");
  });

  it("a saccade crossing the critical line without stopping adds under 100 ms of dwell", () => {
    for (const seed of [1, 2, 3]) {
      const r = review(60);
      play(
        r.session,
        r.geo,
        trajectory(
          [
            { kind: "dwell", at: { x: 685, y: 300 }, ms: 900 },
            { kind: "move", to: { x: 685, y: 885 }, ms: 70 },
            { kind: "dwell", at: { x: 685, y: 885 }, ms: 900 },
          ],
          { viewport: r.layout.viewport, noisePx: 15, smoothing: true, seed, start: { x: 685, y: 300 } },
        ),
      );
      const dwell = r.session.snapshot().targets[0].dwellMs;
      expect(dwell).toBeLessThan(100);
      // The smoothed estimate lingers on the line for about 60-80 ms; the transit filter removes it.
      expect(dwell).toBeLessThan(20);
    }
  });

  it("a 5 fps stream stays within 20% of the true dwell", () => {
    const r = review(80);
    const critical = r.rect("impact-2");
    play(
      r.session,
      r.geo,
      trajectory([{ kind: "dwell", at: center(critical), ms: 3000 }], {
        viewport: r.layout.viewport,
        fps: 5,
        noisePx: 20,
        seed: 3,
        sigmaPx: sigmaOf(80),
        start: center(critical),
      }),
      3000,
    );
    const truth = 3000 - 500;
    expect(Math.abs(r.session.snapshot().targets[0].dwellMs - truth) / truth).toBeLessThan(0.2);
  });
});

describe("posture and per-frame uncertainty", () => {
  const posture: PostureModel = {
    keys: ["yaw", "pitch", "faceX", "faceY", "faceScale"],
    center: [0, 0, 0.5, 0.45, 0.09],
    scale: [2, 2, 0.01, 0.01, 0.005],
  };

  it("inflates sigma and lowers confidence as the head leaves the calibrated posture", () => {
    const at = (yaw: number) => ({
      irisH: 0.5, irisV: 0, openness: 0.3, bsH: 0, bsV: 0, yaw, pitch: 0, roll: 0, faceX: 0.5, faceY: 0.45, faceScale: 0.09, blink: false,
    });
    expect(postureZ(at(0), posture)).toBe(0);
    expect(postureInflation(1)).toBe(1);
    const z = postureZ(at(8), posture);
    expect(z).toBeGreaterThan(CV_CONFIG.uncertainty.postureZ0);
    const base = { x: 60, y: 60 };
    const still = gazeEstimate({ gaze: { x: 0.5, y: 0.5 }, viewport: { width: 1440, height: 900 }, base, faceCount: 1, postureZ: 0, held: false });
    const turned = gazeEstimate({ gaze: { x: 0.5, y: 0.5 }, viewport: { width: 1440, height: 900 }, base, faceCount: 1, postureZ: z, held: false });
    const held = gazeEstimate({ gaze: { x: 0.5, y: 0.5 }, viewport: { width: 1440, height: 900 }, base, faceCount: 1, postureZ: 0, held: true });
    expect(still.sigmaX).toBe(60);
    expect(still.confidence).toBe(1);
    expect(turned.sigmaX).toBeGreaterThan(60);
    expect(turned.confidence).toBeLessThan(1);
    expect(held.sigmaX).toBeCloseTo(60 * CV_CONFIG.uncertainty.heldInflation, 6);
    const twoFaces = gazeEstimate({ gaze: { x: 0.5, y: 0.5 }, viewport: { width: 1440, height: 900 }, base, faceCount: 2, postureZ: 0, held: false });
    expect(twoFaces.confidence).toBe(0);
  });

  it("a review with the head turned 8 degrees away is trusted at most at medium", () => {
    const r = review(60);
    const critical = r.rect("impact-2");
    play(
      r.session,
      r.geo,
      trajectory([{ kind: "read", line: critical, ms: 3000, fixations: 8 }], {
        viewport: r.layout.viewport,
        noisePx: 20,
        smoothing: true,
        seed: 4,
        sigmaPx: sigmaOf(60),
        posture,
        pose: () => ({ yaw: 8 }),
        start: center(critical),
      }),
    );
    const snap = r.session.snapshot();
    expect(snap.sigmaEffPx!.x).toBeGreaterThan(60);
    expect(snap.meanEstimateConfidence!).toBeLessThan(1);
    expect(snap.postureOutRatio).toBeGreaterThan(0.9);
    const trust = assessGazeTrust(snap, assessSignal(snap));
    expect(["medium", "low"]).toContain(trust.level);
    expect(trust.reasons.map((x) => x.code)).toContain("trust-posture");
  });
});
