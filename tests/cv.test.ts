import { describe, expect, it } from "vitest";
import type { EyeFeatures } from "@/types/cv";
import {
  fitCalibration,
  isCalibrationStale,
  predictGaze,
  type CalibrationSample,
} from "@/lib/cv/calibration";
import { CV_CONFIG } from "@/lib/cv/config";
import { eyeGeometry, extractEyeFeatures, type LandmarkPoint } from "@/lib/cv/features";
import { headPoseFromMatrix } from "@/lib/cv/head-pose";
import { OneEuroFilter } from "@/lib/cv/one-euro";
import { FixationDetector } from "@/lib/cv/fixation";
import { LM } from "@/lib/cv/landmarks";

/** Deterministic PRNG so tests never flake. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number) {
  const u = Math.max(1e-12, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function syntheticFeatures(x: number, y: number, noise: number, rand: () => number): EyeFeatures {
  const n = () => gaussian(rand) * noise;
  return {
    irisH: 0.5 + 0.12 * (x - 0.5) + n() * 0.02,
    irisV: 0.06 * (y - 0.5) + n() * 0.01,
    openness: 0.3 - 0.05 * (y - 0.5) + n() * 0.01,
    bsH: 0.5 * (x - 0.5) + n() * 0.05,
    bsV: -0.4 * (y - 0.5) + n() * 0.05,
    yaw: 6 * (x - 0.5) + n(),
    pitch: 5 * (y - 0.5) + n(),
    roll: n(),
    faceX: 0.5 + n() * 0.01,
    faceY: 0.45 + n() * 0.01,
    faceScale: 0.12,
    blink: false,
  };
}

function calibrationSamples(noise: number, seed = 7, pointCount = 9): CalibrationSample[] {
  const rand = rng(seed);
  const samples: CalibrationSample[] = [];
  CV_CONFIG.calibration.points.slice(0, pointCount).forEach(([x, y], pointIndex) => {
    for (let i = 0; i < 25; i++) {
      samples.push({ features: syntheticFeatures(x, y, noise, rand), target: { x, y }, pointIndex });
    }
  });
  return samples;
}

const viewport = { width: 1440, height: 900 };

describe("gaze calibration (ridge regression + leave-one-point-out validation)", () => {
  it("recovers a feature-to-screen mapping and rates it good", () => {
    const { model } = fitCalibration(calibrationSamples(0.3), viewport);
    expect(model).not.toBeNull();
    expect(model!.quality).toBe("good");
    expect(model!.errorNorm.x).toBeLessThan(0.08);
    expect(model!.errorNorm.y).toBeLessThan(0.08);
    const rand = rng(99);
    const p = predictGaze(model!, syntheticFeatures(0.3, 0.7, 0.3, rand));
    expect(Math.abs(p.x - 0.3)).toBeLessThan(0.08);
    expect(Math.abs(p.y - 0.7)).toBeLessThan(0.08);
  });

  it("recommends recalibration when features carry no gaze signal", () => {
    const rand = rng(3);
    const samples = calibrationSamples(0.3).map((s) => ({
      ...s,
      features: syntheticFeatures(rand(), rand(), 0.3, rand),
    }));
    const { model } = fitCalibration(samples, viewport);
    expect(model?.quality).toBe("poor");
  });

  it("refuses to fit with fewer than five usable points", () => {
    const result = fitCalibration(calibrationSamples(0.3, 7, 4), viewport);
    expect(result.model).toBeNull();
    expect(result.reason).toMatch(/need 5/);
  });

  it("ignores blink frames", () => {
    const samples = calibrationSamples(0.3).map((s, i) =>
      i % 5 === 0 ? { ...s, features: { ...s.features, blink: true, irisH: 9 } } : s,
    );
    expect(fitCalibration(samples, viewport).model?.quality).toBe("good");
  });

  it("marks a calibration stale when the viewport changes", () => {
    const { model } = fitCalibration(calibrationSamples(0.3), viewport);
    expect(isCalibrationStale(model!, viewport)).toBe(false);
    expect(isCalibrationStale(model!, { width: 1440, height: 780 })).toBe(true);
  });
});

describe("eye features", () => {
  it("measures iris position in the eye's own frame", () => {
    const centered = eyeGeometry({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: -0.15 }, { x: 0.5, y: 0.15 }, { x: 0.5, y: 0 });
    expect(centered.h).toBeCloseTo(0.5);
    expect(centered.v).toBeCloseTo(0);
    expect(centered.openness).toBeCloseTo(0.3);
    const lookingRightDown = eyeGeometry({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: -0.1 }, { x: 0.5, y: 0.1 }, { x: 0.7, y: 0.1 });
    expect(lookingRightDown.h).toBeCloseTo(0.7);
    expect(lookingRightDown.v).toBeCloseTo(0.1);
  });

  it("is invariant to head roll", () => {
    const a = (30 * Math.PI) / 180;
    const axis = { x: Math.cos(a), y: Math.sin(a) };
    const iris = { x: 0.7 * axis.x, y: 0.7 * axis.y };
    const g = eyeGeometry({ x: 0, y: 0 }, axis, { x: 0, y: 0 }, { x: 0, y: 0 }, iris);
    expect(g.h).toBeCloseTo(0.7);
    expect(g.v).toBeCloseTo(0);
  });

  it("extracts features from a 478-point mesh and assigns irises by proximity", () => {
    const lm: LandmarkPoint[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    const set = (i: number, x: number, y: number) => {
      lm[i] = { x, y };
    };
    // Subject's right eye on image-left, left eye on image-right.
    set(LM.rightEyeOuter, 0.36, 0.4);
    set(LM.rightEyeInner, 0.44, 0.4);
    set(LM.rightEyeUpper, 0.4, 0.39);
    set(LM.rightEyeLower, 0.4, 0.41);
    set(LM.leftEyeInner, 0.56, 0.4);
    set(LM.leftEyeOuter, 0.64, 0.4);
    set(LM.leftEyeUpper, 0.6, 0.39);
    set(LM.leftEyeLower, 0.6, 0.41);
    // Irises shifted toward image-right; deliberately put the "A" iris in the image-right eye.
    for (const i of LM.irisA) set(i, 0.62, 0.4);
    for (const i of LM.irisB) set(i, 0.42, 0.4);
    const f = extractEyeFeatures(lm, null, null, 16 / 9);
    expect(f).not.toBeNull();
    expect(f!.irisH).toBeCloseTo(0.75, 2);
    expect(f!.faceX).toBeCloseTo(0.5, 5);
    expect(extractEyeFeatures(lm.slice(0, 468), null, null, 16 / 9)).toBeNull();
  });

  it("reads only eye blendshapes and requires both eyes closed for a blink", () => {
    const lm: LandmarkPoint[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    const oneEye = extractEyeFeatures(lm, [{ categoryName: "eyeBlinkLeft", score: 0.9 }], null, 1);
    expect(oneEye!.blink).toBe(false);
    const both = extractEyeFeatures(
      lm,
      [
        { categoryName: "eyeBlinkLeft", score: 0.9 },
        { categoryName: "eyeBlinkRight", score: 0.8 },
      ],
      null,
      1,
    );
    expect(both!.blink).toBe(true);
  });
});

describe("head pose", () => {
  const columnMajor = (r: number[][], t: [number, number, number]) => {
    const d = new Array(16).fill(0);
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) d[col * 4 + row] = r[row][col];
    d[12] = t[0];
    d[13] = t[1];
    d[14] = t[2];
    d[15] = 1;
    return d;
  };

  it("extracts yaw from the facial transformation matrix", () => {
    const a = (20 * Math.PI) / 180;
    const R = [
      [Math.cos(a), 0, Math.sin(a)],
      [0, 1, 0],
      [-Math.sin(a), 0, Math.cos(a)],
    ];
    const pose = headPoseFromMatrix(columnMajor(R, [0, 0, -50]));
    expect(pose!.yaw).toBeCloseTo(20, 4);
    expect(pose!.pitch).toBeCloseTo(0, 4);
  });

  it("extracts pitch", () => {
    const a = (15 * Math.PI) / 180;
    const R = [
      [1, 0, 0],
      [0, Math.cos(a), -Math.sin(a)],
      [0, Math.sin(a), Math.cos(a)],
    ];
    expect(headPoseFromMatrix(columnMajor(R, [0, 0, -50]))!.pitch).toBeCloseTo(15, 4);
  });
});

describe("temporal filtering", () => {
  it("One Euro filter reduces jitter on a steady gaze", () => {
    const rand = rng(11);
    const filter = new OneEuroFilter(0.9, 0.35, 1);
    const raw: number[] = [];
    const smooth: number[] = [];
    for (let i = 0; i < 120; i++) {
      const v = 0.5 + gaussian(rand) * 0.03;
      raw.push(v);
      smooth.push(filter.filter(v, i / 30));
    }
    const variance = (xs: number[]) => {
      const tail = xs.slice(30);
      const m = tail.reduce((a, b) => a + b, 0) / tail.length;
      return tail.reduce((a, b) => a + (b - m) ** 2, 0) / tail.length;
    };
    expect(variance(smooth)).toBeLessThan(variance(raw) / 3);
  });

  it("detects a fixation and ends it on a saccade", () => {
    const rand = rng(5);
    const detector = new FixationDetector(60, 120);
    let fixation = null;
    for (let i = 0; i < 20; i++) {
      detector.push(i * 33, 100 + (rand() - 0.5) * 8, 200 + (rand() - 0.5) * 8);
    }
    expect(detector.current()).not.toBeNull();
    fixation = detector.push(20 * 33, 600, 500);
    expect(fixation).not.toBeNull();
    expect(fixation!.duration).toBeGreaterThanOrEqual(600);
    expect(fixation!.x).toBeCloseTo(100, 0);
    expect(fixation!.y).toBeCloseTo(200, 0);
  });
});
