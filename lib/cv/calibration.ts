/**
 * Gaze calibration: ridge regression from eye/head features to normalized
 * viewport coordinates, one model per axis.
 *
 * Quality is estimated honestly with leave-one-point-out cross-validation:
 * each calibration point is predicted by a model that never saw it. The
 * resulting error is reported as Good / Fair / Recalibration recommended,
 * never as a precision number we cannot back up.
 */
import type { AxisModel, CalibrationModel, CalibrationQuality, EyeFeatures, FeatureKey } from "@/types/cv";
import { solveSPD } from "@/lib/math/linalg";
import { mad, mean, median } from "@/lib/math/stats";
import { CV_CONFIG } from "./config";

export interface CalibrationSample {
  features: EyeFeatures;
  target: { x: number; y: number };
  pointIndex: number;
}

export function featureVector(f: EyeFeatures, keys: readonly FeatureKey[]): number[] {
  return keys.map((k) => f[k]);
}

export function fitAxis(X: number[][], y: number[], keys: readonly FeatureKey[], lambda: number): AxisModel {
  const n = X.length;
  const d = keys.length;
  const means = new Array<number>(d).fill(0);
  const stds = new Array<number>(d).fill(1);
  for (let j = 0; j < d; j++) {
    const col = X.map((row) => row[j]);
    means[j] = mean(col);
    const variance = col.reduce((acc, v) => acc + (v - means[j]) ** 2, 0) / Math.max(1, n - 1);
    stds[j] = Math.sqrt(variance) > 1e-9 ? Math.sqrt(variance) : 1;
  }
  const Z = X.map((row) => row.map((v, j) => (v - means[j]) / stds[j]));
  const yMean = mean(y);
  const A: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  const b = new Array<number>(d).fill(0);
  for (let i = 0; i < n; i++) {
    const zi = Z[i];
    const yi = y[i] - yMean;
    for (let j = 0; j < d; j++) {
      b[j] += zi[j] * yi;
      for (let k = j; k < d; k++) A[j][k] += zi[j] * zi[k];
    }
  }
  for (let j = 0; j < d; j++) {
    for (let k = 0; k < j; k++) A[j][k] = A[k][j];
    A[j][j] += lambda * n;
  }
  const weights = solveSPD(A, b);
  return { features: [...keys], mean: means, std: stds, weights, intercept: yMean, lambda };
}

export function predictAxis(model: AxisModel, f: EyeFeatures): number {
  let v = model.intercept;
  for (let j = 0; j < model.features.length; j++) {
    v += (model.weights[j] * (f[model.features[j]] - model.mean[j])) / model.std[j];
  }
  return v;
}

export function predictGaze(model: CalibrationModel, f: EyeFeatures): { x: number; y: number } {
  return { x: predictAxis(model.x, f), y: predictAxis(model.y, f) };
}

/** Drops per-point outlier frames (e.g. a glance away mid-point) using a robust MAD test. */
export function trimOutliers(samples: CalibrationSample[], keys: readonly FeatureKey[]): CalibrationSample[] {
  const byPoint = groupByPoint(samples);
  const kept: CalibrationSample[] = [];
  for (const group of byPoint.values()) {
    if (group.length < 4) {
      kept.push(...group);
      continue;
    }
    const stats = keys.map((k) => {
      const values = group.map((s) => s.features[k]);
      return { k, med: median(values), spread: Math.max(mad(values) * 1.4826, 1e-6) };
    });
    for (const s of group) {
      if (stats.every(({ k, med, spread }) => Math.abs(s.features[k] - med) <= 3.5 * spread)) kept.push(s);
    }
  }
  return kept;
}

function groupByPoint(samples: CalibrationSample[]): Map<number, CalibrationSample[]> {
  const map = new Map<number, CalibrationSample[]>();
  for (const s of samples) {
    const list = map.get(s.pointIndex) ?? [];
    list.push(s);
    map.set(s.pointIndex, list);
  }
  return map;
}

/** Leave-one-point-out mean absolute error for one axis at a given lambda. */
export function looError(
  samples: CalibrationSample[],
  keys: readonly FeatureKey[],
  axis: "x" | "y",
  lambda: number,
): number {
  const groups = groupByPoint(samples);
  const errors: number[] = [];
  for (const [point, held] of groups) {
    const train = samples.filter((s) => s.pointIndex !== point);
    if (train.length < keys.length + 2) continue;
    const model = fitAxis(
      train.map((s) => featureVector(s.features, keys)),
      train.map((s) => s.target[axis]),
      keys,
      lambda,
    );
    errors.push(mean(held.map((s) => Math.abs(predictAxis(model, s.features) - s.target[axis]))));
  }
  return errors.length ? mean(errors) : Infinity;
}

export function qualityFromError(err: { x: number; y: number }): CalibrationQuality {
  const q = CV_CONFIG.calibration.quality;
  if (err.x <= q.good.x && err.y <= q.good.y) return "good";
  if (err.x <= q.fair.x && err.y <= q.fair.y) return "fair";
  return "poor";
}

export interface FitResult {
  model: CalibrationModel | null;
  reason?: string;
}

export function fitCalibration(
  rawSamples: CalibrationSample[],
  viewport: { width: number; height: number },
): FitResult {
  const xKeys = CV_CONFIG.features.x as readonly FeatureKey[];
  const yKeys = CV_CONFIG.features.y as readonly FeatureKey[];
  const allKeys = [...new Set([...xKeys, ...yKeys])];
  const samples = trimOutliers(
    rawSamples.filter((s) => !s.features.blink),
    allKeys,
  );
  const points = groupByPoint(samples);
  const usable = [...points.values()].filter((g) => g.length >= 3).length;
  if (usable < 5) {
    return { model: null, reason: `Only ${usable} calibration points had usable eye data (need 5).` };
  }

  const pick = (keys: readonly FeatureKey[], axis: "x" | "y") => {
    let best = { lambda: CV_CONFIG.calibration.lambdas[0] as number, error: Infinity };
    for (const lambda of CV_CONFIG.calibration.lambdas) {
      const error = looError(samples, keys, axis, lambda);
      if (error < best.error) best = { lambda, error };
    }
    return best;
  };

  const bx = pick(xKeys, "x");
  const by = pick(yKeys, "y");
  const modelX = fitAxis(
    samples.map((s) => featureVector(s.features, xKeys)),
    samples.map((s) => s.target.x),
    xKeys,
    bx.lambda,
  );
  const modelY = fitAxis(
    samples.map((s) => featureVector(s.features, yKeys)),
    samples.map((s) => s.target.y),
    yKeys,
    by.lambda,
  );
  const errorNorm = { x: bx.error, y: by.error };
  return {
    model: {
      version: 1,
      x: modelX,
      y: modelY,
      errorNorm,
      errorPx: { x: errorNorm.x * viewport.width, y: errorNorm.y * viewport.height },
      quality: qualityFromError(errorNorm),
      viewport,
      pointCount: usable,
      sampleCount: samples.length,
      createdAt: Date.now(),
    },
  };
}

/** True when the viewport changed enough that the calibration no longer maps to the same pixels. */
export function isCalibrationStale(model: CalibrationModel, viewport: { width: number; height: number }): boolean {
  const tol = CV_CONFIG.calibration.staleViewportChange;
  return (
    Math.abs(viewport.width - model.viewport.width) / model.viewport.width > tol ||
    Math.abs(viewport.height - model.viewport.height) / model.viewport.height > tol
  );
}

/** Gaze uncertainty in CSS px (used for hit margins and fixation dispersion). */
export function gazeSigmaPx(model: CalibrationModel | null): { x: number; y: number } | null {
  return model ? { x: model.errorPx.x, y: model.errorPx.y } : null;
}
