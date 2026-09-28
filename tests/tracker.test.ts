/**
 * ReviewSession (the per-request tracker) driven by SYNTHETIC gaze
 * trajectories over a scripted card layout. See tests/sim/gaze-sim.ts.
 */
import { describe, expect, it } from "vitest";
import { createReReview } from "@/lib/attention/rereview";
import { CAMERA_OFF, approve, center, openReview, pauseLayout, play, trajectory } from "./sim/gaze-sim";

describe("ReviewSession on scripted geometry", () => {
  it("counts dwell only on the region under the gaze, after the orientation delay", () => {
    const r = openReview("db-config");
    const critical = r.rect("impact-2");
    play(r.session, r.geo, trajectory([{ kind: "dwell", at: center(critical), ms: 1500 }], { viewport: r.layout.viewport }));
    const snap = r.session.snapshot();
    const target = snap.targets.find((t) => t.id === "impact-2")!;
    // Gaze from t = 0, dwell counts from 500 ms.
    expect(target.dwellMs).toBeGreaterThan(900);
    expect(target.dwellMs).toBeLessThan(1100);
    expect(snap.regionDwellMs.title ?? 0).toBe(0);
    expect(snap.frames.gaze).toBe(snap.frames.total);
  });

  it("never counts the title toward the critical consequence", () => {
    const r = openReview("db-config");
    const title = r.rect("title");
    play(r.session, r.geo, trajectory([{ kind: "read", line: title, ms: 2000 }], { viewport: r.layout.viewport, noisePx: 20, seed: 2 }));
    const snap = r.session.snapshot();
    expect(snap.targets[0].dwellMs).toBe(0);
    expect(snap.regionDwellMs.title).toBeGreaterThan(1000);
  });

  it("only accumulates visibility for regions that are on screen", () => {
    const r = openReview("db-config", { layout: { viewport: { width: 1440, height: 520 } } });
    play(r.session, r.geo, trajectory([{ kind: "dwell", at: center(r.rect("title")), ms: 1500 }], { viewport: r.layout.viewport }));
    expect(r.session.snapshot().targets[0].visibleMs).toBe(0);
  });

  it("counts face, multi-face, gaze and off-screen frames", () => {
    const r = openReview("db-config");
    const frames = trajectory(
      [
        { kind: "dwell", at: center(r.rect("title")), ms: 500 },
        { kind: "offscreen", ms: 500 },
        { kind: "faceLost", ms: 500 },
      ],
      { viewport: r.layout.viewport },
    );
    play(r.session, r.geo, frames);
    const snap = r.session.snapshot();
    expect(snap.frames.total).toBe(frames.length);
    expect(snap.frames.face).toBe(30);
    expect(snap.frames.gaze).toBe(30);
    expect(snap.frames.onScreen).toBe(15);
    expect(snap.offScreenMs).toBeGreaterThan(400);
  });

  it("stores card-relative derived samples, never faster than every 30 ms", () => {
    const r = openReview("db-config");
    const title = r.rect("title");
    play(r.session, r.geo, trajectory([{ kind: "dwell", at: center(title), ms: 1000 }], { viewport: r.layout.viewport, fps: 60 }));
    const samples = r.session.gazeSamples;
    expect(samples.length).toBeGreaterThan(20);
    expect(samples.length).toBeLessThanOrEqual(34);
    const card = r.layout.card!;
    expect(samples[0].x).toBeCloseTo(center(title).x - card.left, 5);
    expect(samples[0].y).toBeCloseTo(center(title).y - card.top, 5);
    expect(samples[0].regionId).toBe("title");
  });

  it("gaze re-review counts dwell on the isolated consequence only", () => {
    const r = openReview("db-config");
    play(r.session, r.geo, trajectory([{ kind: "dwell", at: center(r.rect("title")), ms: 1300 }], { viewport: r.layout.viewport }));
    r.session.startReReview(createReReview("review:impact-2", 1170, "gaze"));
    r.geo.layout = pauseLayout(r.layout, r.request.id, "impact-2", "CRITICAL");
    const review = r.geo.layout.regions[0].rect;
    const start = r.geo.t;
    // Looking elsewhere does not count...
    play(r.session, r.geo, trajectory([{ kind: "dwell", at: { x: 700, y: 700 }, ms: 1500 }], { viewport: r.layout.viewport, startT: start }));
    expect(r.session.reReview!.dwellMs).toBe(0);
    // ...looking at the consequence does.
    const t0 = r.geo.t;
    play(r.session, r.geo, trajectory([{ kind: "dwell", at: center(review), ms: 2000 }], { viewport: r.layout.viewport, startT: t0 }));
    expect(r.session.reReview!.satisfied).toBe(true);
  });
});

describe("characterization: tracker + engine + policy on synthetic trajectories", () => {
  it("title-only for 1.3 s on the critical request => PAUSE", () => {
    const r = openReview("db-config");
    const title = r.rect("title");
    play(
      r.session,
      r.geo,
      trajectory([{ kind: "read", line: title, ms: 1300 }], { viewport: r.layout.viewport, noisePx: 20, smoothing: true, seed: 3, start: center(title) }),
      1300,
    );
    const { assessment, decision } = approve(r);
    expect(assessment.mode).toBe("gaze");
    expect(assessment.criticalCoverage).toBe(0);
    expect(decision.level).toBe("PAUSE");
    expect(decision.verification).toBe("gaze");
  });

  it("2.5 s on the critical line => NORMAL", () => {
    const r = openReview("db-config");
    const critical = r.rect("impact-2");
    play(
      r.session,
      r.geo,
      trajectory(
        [
          { kind: "read", line: r.rect("title"), ms: 400 },
          { kind: "move", to: center(critical) },
          { kind: "read", line: critical, ms: 2500, fixations: 8 },
        ],
        { viewport: r.layout.viewport, noisePx: 20, smoothing: true, seed: 4, start: center(r.rect("title")) },
      ),
    );
    const { assessment, decision } = approve(r);
    expect(assessment.criticalCoverage).toBe(1);
    expect(decision.level).toBe("NORMAL");
  });

  it("critical region below the viewport => no gaze penalty, REFOCUS to bring it on screen", () => {
    const r = openReview("db-config", { layout: { viewport: { width: 1440, height: 520 } } });
    play(r.session, r.geo, trajectory([{ kind: "read", line: r.rect("title"), ms: 3000 }], { viewport: r.layout.viewport, noisePx: 20, seed: 5 }));
    const { assessment, decision } = approve(r);
    expect(assessment.criticalCoverage).toBeNull();
    const codes = assessment.reasons.map((x) => x.code);
    expect(codes).toContain("never-visible");
    expect(codes).not.toContain("coverage-none");
    expect(decision.level).toBe("REFOCUS");
    expect(decision.headline).toBe("Critical consequence not yet on screen");
  });

  it("face lost => behavioral mode with manual verification", () => {
    const r = openReview("db-config");
    play(
      r.session,
      r.geo,
      trajectory([{ kind: "dwell", at: center(r.rect("title")), ms: 300 }, { kind: "faceLost", ms: 1500 }], { viewport: r.layout.viewport, seed: 6 }),
    );
    const { assessment, decision } = approve(r);
    expect(assessment.mode).toBe("behavioral");
    expect(assessment.reasons.map((x) => x.code)).toContain("face-lost");
    expect(decision.level).toBe("PAUSE");
    expect(decision.verification).toBe("manual");
  });

  it("camera off => behavioral mode, fast critical approval still pauses", () => {
    const r = openReview("db-config", { signal: CAMERA_OFF });
    play(r.session, r.geo, [], 1300);
    const { assessment, decision } = approve(r);
    expect(assessment.mode).toBe("behavioral");
    expect(decision.level).toBe("PAUSE");
    expect(decision.verification).toBe("manual");
  });
});
