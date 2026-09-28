/**
 * Calibration v2 on SYNTHETIC eye/head/screen data (tests/sim/eye-sim.ts).
 * These are regression guards for the fitting code, not accuracy claims.
 */
import { describe, expect, it } from "vitest";
import type { CalibrationModel, CalibrationModelV1, CalibrationValidation, EyeFeatures } from "@/types/cv";
import {
  CURRENT_CALIBRATION_VERSION,
  adaptivePoints,
  adaptiveTarget,
  fitAxis,
  fitCalibration,
  gazeSigmaPx,
  parseCalibrationModel,
  predictAxis,
  predictGaze,
  revalidationPoints,
  type CalibrationSample,
} from "@/lib/cv/calibration";
import { CV_CONFIG } from "@/lib/cv/config";
import { median } from "@/lib/math/stats";
import { gaussian, rng } from "./sim/gaze-sim";
import { REST, SCREEN, eyeFeatures, gridSamples, sweepSamples, validationSamples, type Head } from "./sim/eye-sim";

const viewport = SCREEN.viewport;

/** Median error (CSS px) of predictions while looking at the screen centre with a given head. */
function centreError(model: Pick<CalibrationModel, "x" | "y">, head: Head, seed = 9): number {
  const rand = rng(seed);
  const errors: number[] = [];
  for (let i = 0; i < 90; i++) {
    const p = predictGaze(model, eyeFeatures({ x: 0.5, y: 0.5 }, head, rand));
    errors.push(Math.hypot((p.x - 0.5) * viewport.width, (p.y - 0.5) * viewport.height));
  }
  return median(errors);
}

function calibrate(seed: number, withSweep: boolean) {
  const grid = gridSamples(seed);
  const { model } = fitCalibration({
    train: withSweep ? [...grid, ...sweepSamples(seed + 100)] : grid,
    validation: validationSamples(seed + 50),
    viewport,
  });
  return model!;
}

describe("standardization floors", () => {
  it("bound the prediction shift from a feature that barely varied during calibration", () => {
    const rand = rng(21);
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < 240; i++) {
      const target = (i % 8) / 7;
      X.push([0.5 + 0.1 * (target - 0.5) + gaussian(rand) * 0.004, gaussian(rand) * 0.05]); // [irisH, yaw with 0.05 deg spread]
      y.push(target);
    }
    const keys = ["irisH", "yaw"] as const;
    // In raw units a floor adds lambda x floor^2 to the feature's ridge penalty; 0.05 is mid-grid.
    const lambda = 0.05;
    const floored = fitAxis(X, y, keys, lambda);
    const unfloored = fitAxis(X, y, keys, lambda, {});
    const at = (yaw: number): EyeFeatures => ({ ...eyeFeatures({ x: 0.5, y: 0.5 }, REST, rng(1)), irisH: 0.5, yaw });
    const shift = (m: typeof floored) => Math.abs(predictAxis(m, at(5)) - predictAxis(m, at(0)));
    expect(floored.std[1]).toBe(CV_CONFIG.calibration.stdFloor.yaw);
    // A 5 degree head turn is 2.5 floored units: the spurious yaw weight cannot move gaze far.
    expect(shift(floored) * viewport.width).toBeLessThan(20);
    expect(shift(unfloored)).toBeGreaterThan(5 * shift(floored));
  });
});

describe("head-sweep identifiability (synthetic guard, not a real-world claim)", () => {
  const seeds = Array.from({ length: 12 }, (_, i) => i + 1);
  const still = seeds.map((s) => calibrate(s, false));
  const swept = seeds.map((s) => calibrate(s, true));
  const turn: Head = { ...REST, yaw: 5 };
  const shift: Head = { ...REST, x: 3.5 };

  it("without the head sweep, a 5 degree turn or a 3.5 cm shift throws gaze far off", () => {
    expect(median(still.map((m) => centreError(m, turn)))).toBeGreaterThan(150);
    expect(median(still.map((m) => centreError(m, shift)))).toBeGreaterThan(150);
    for (const m of still) expect(centreError(m, turn)).toBeGreaterThan(150);
  });

  it("with the head sweep, both stay under 80 px at screen centre", () => {
    expect(median(swept.map((m) => centreError(m, turn)))).toBeLessThan(80);
    expect(median(swept.map((m) => centreError(m, shift)))).toBeLessThan(80);
    for (const m of swept) {
      expect(centreError(m, turn)).toBeLessThan(80);
      expect(centreError(m, shift)).toBeLessThan(80);
    }
  });

  it("records the held-out validation, feature sets and posture in a v2 model", () => {
    const m = swept[0];
    expect(m.version).toBe(CURRENT_CALIBRATION_VERSION);
    expect(m.validation!.points).toBe(CV_CONFIG.calibration.validation.points.length);
    expect(m.validation!.medianPx).toBeLessThanOrEqual(m.validation!.p90Px);
    expect(m.validation!.worstPointPx).toBeGreaterThanOrEqual(median(m.validation!.perPoint.map((p) => p.medianPx)));
    expect(["base", "scale", "scaleInteraction"]).toContain(m.featureSets.x);
    expect(m.posture.keys).toEqual(["yaw", "pitch", "faceX", "faceY", "faceScale"]);
    // Posture spread includes the sweep, so turning the head is within the calibrated range.
    expect(m.posture.scale[0]).toBeGreaterThan(CV_CONFIG.calibration.stdFloor.yaw);
    expect(gazeSigmaPx(m)).toEqual(m.validation!.sigmaPx);
  });
});

describe("held-out validation", () => {
  const train = [...gridSamples(3), ...sweepSamples(103)];

  it("never lets a validation sample reach the fit", () => {
    const garbage = (samples: CalibrationSample[], k: number) =>
      samples.map((s) => ({ ...s, target: { x: 5 * k, y: -3 * k }, features: { ...s.features, irisH: 9 * k, irisV: -4 * k } }));
    const val = validationSamples(40);
    const a = fitCalibration({ train, validation: garbage(val, 1), viewport }).model!;
    const b = fitCalibration({ train, validation: garbage(val, 2), viewport }).model!;
    const clean = fitCalibration({ train, validation: val, viewport }).model!;
    expect(a.x).toEqual(clean.x);
    expect(a.y).toEqual(clean.y);
    expect(b.x).toEqual(clean.x);
    expect(a.validation!.medianPx).not.toBe(clean.validation!.medianPx);
  });

  it("rates quality from held-out error, not from the training fit", () => {
    // Same fit, validated while the head is turned 8 degrees away from the calibrated posture.
    const stillTrain = gridSamples(3);
    const rand = rng(77);
    const turned = CV_CONFIG.calibration.validation.points.flatMap(([x, y], k) =>
      Array.from({ length: 30 }, () => ({
        features: eyeFeatures({ x, y }, { ...REST, yaw: 8 }, rand),
        target: { x, y },
        pointIndex: 300 + k,
      })),
    );
    const good = fitCalibration({ train: stillTrain, validation: validationSamples(41), viewport }).model!;
    const bad = fitCalibration({ train: stillTrain, validation: turned, viewport }).model!;
    expect(good.quality).toBe("good");
    expect(bad.loo).toEqual(good.loo);
    expect(bad.quality).toBe("poor");
  });

  it("still completes when the face was lost for a grid point and a check point", () => {
    const grid = gridSamples(5).filter((s) => s.pointIndex !== 2);
    const val = validationSamples(45).filter((s) => s.pointIndex !== 301);
    const { model } = fitCalibration({ train: [...grid, ...sweepSamples(105)], validation: val, viewport });
    expect(model).not.toBeNull();
    expect(model!.validation!.points).toBe(4);
  });

  it("makes no accuracy claim when too few check points were measured", () => {
    const val = validationSamples(46).filter((s) => s.pointIndex <= 301);
    const { model } = fitCalibration({ train, validation: val, viewport });
    expect(model!.validation).toBeNull();
    expect(model!.quality).toBe("poor");
  });
});

describe("adaptive round", () => {
  const train = [...gridSamples(8), ...sweepSamples(108)];

  it("does not trigger when accuracy is even across the screen", () => {
    for (const seed of [11, 12, 13]) {
      const { model } = fitCalibration({ train, validation: validationSamples(seed), viewport });
      expect(adaptiveTarget(model!.validation, viewport)).toBeNull();
    }
  });

  it("triggers for one clearly bad region and adds training points next to it", () => {
    // The bottom-left check point behaves as if the eyes were 350 px away from it.
    const val = validationSamples(14).map((s) =>
      s.pointIndex === 303 ? { ...s, features: eyeFeatures({ x: s.target.x + 350 / 1440, y: s.target.y }, REST, rng(s.features.irisH * 1e6)) } : s,
    );
    const { model } = fitCalibration({ train, validation: val, viewport });
    const worst = adaptiveTarget(model!.validation, viewport);
    expect(worst).not.toBeNull();
    expect(worst!.target).toEqual({ x: 0.25, y: 0.72 });
    const extra = adaptivePoints(worst!.target);
    expect(extra).toHaveLength(2);
    for (const [x, y] of extra) {
      expect(Math.hypot(x - 0.25, y - 0.72)).toBeLessThan(0.1);
      expect(x).toBeGreaterThan(0);
      expect(y).toBeLessThan(1);
    }
    const fresh = revalidationPoints(worst!.target);
    expect(fresh).toHaveLength(3);
    const used = [...CV_CONFIG.calibration.points, ...CV_CONFIG.calibration.validation.points, ...extra];
    for (const [x, y] of fresh) expect(used.some(([ux, uy]) => ux === x && uy === y)).toBe(false);
  });

  it("does not single out a region when every point is equally poor", () => {
    const noisy = (samples: CalibrationSample[]) =>
      samples.map((s) => ({ ...s, features: { ...s.features, irisH: s.features.irisH + (s.pointIndex % 2 ? 0.04 : -0.04) } }));
    const v: CalibrationValidation = fitCalibration({ train, validation: noisy(validationSamples(15)), viewport }).model!.validation!;
    const spread = Math.max(...v.perPoint.map((p) => p.medianPx)) / median(v.perPoint.map((p) => p.medianPx));
    expect(spread).toBeLessThan(2);
    expect(adaptiveTarget(v, viewport)).toBeNull();
  });
});

describe("v1 -> v2 compatibility", () => {
  const v1: CalibrationModelV1 = {
    version: 1,
    x: { features: ["irisH", "bsH", "yaw", "faceX"], mean: [0.5, 0, 0, 0.5], std: [0.05, 0.1, 3, 0.01], weights: [0.2, 0.05, 0.01, 0], intercept: 0.5, lambda: 0.01 },
    y: { features: ["irisV", "bsV", "pitch", "faceY", "openness"], mean: [0, 0, 0, 0.45, 0.3], std: [0.02, 0.1, 3, 0.01, 0.02], weights: [0.2, 0.05, 0.01, 0, 0.02], intercept: 0.5, lambda: 0.01 },
    errorNorm: { x: 0.05, y: 0.08 },
    errorPx: { x: 72, y: 72 },
    quality: "good",
    viewport: { width: 1440, height: 900 },
    pointCount: 9,
    sampleCount: 270,
    createdAt: 0,
  };

  it("still loads and predicts a stored v1 model", () => {
    const restored = parseCalibrationModel(JSON.parse(JSON.stringify(v1)));
    expect(restored?.version).toBe(1);
    const p = predictGaze(restored!, eyeFeatures({ x: 0.5, y: 0.5 }, REST, rng(2)));
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    // Legacy sigma is the leave-one-point-out error; trust for it is capped at medium (tests/trust.test.ts).
    expect(gazeSigmaPx(restored)).toEqual({ x: 72, y: 72 });
    expect(restored!.version).toBeLessThan(CURRENT_CALIBRATION_VERSION);
  });

  it("round-trips a v2 model and rejects malformed data", () => {
    const m = calibrateOnce();
    expect(parseCalibrationModel(JSON.parse(JSON.stringify(m)))).toEqual(m);
    expect(parseCalibrationModel({ version: 2, x: {}, y: {} })).toBeNull();
    expect(parseCalibrationModel(null)).toBeNull();
    expect(parseCalibrationModel({ ...v1, version: 3 })).toBeNull();
  });
});

function calibrateOnce() {
  return fitCalibration({ train: [...gridSamples(30), ...sweepSamples(130)], validation: validationSamples(80), viewport }).model!;
}
