/**
 * Gaze calibration: ridge regression from eye/head features to normalized
 * viewport coordinates, one model per axis.
 *
 * Training data: the 9-point grid (head still) plus a head sweep (eyes on a
 * dot while the head turns and nods), which makes head-pose compensation
 * identifiable. Per axis, the input set and ridge penalty are chosen by
 * grouped leave-one-point-out error (each point is one group).
 *
 * Reported accuracy comes only from held-out validation points that never
 * reach the fit: median / 90th-percentile error, per-point accuracy and
 * precision, and per-axis RMSE (the sigma used for gaze uncertainty). Quality
 * is Good / Fair / Recalibration recommended from that held-out error.
 */
import type {
  AxisModel,
  CalibrationModel,
  CalibrationModelV1,
  CalibrationModelV2,
  CalibrationQuality,
  CalibrationValidation,
  DisplayState,
  EyeFeatures,
  FeatureKey,
  FeatureSetName,
  ModelFeatureKey,
  PostureModel,
  ValidationPoint,
} from "@/types/cv";
import { solveSPD } from "@/lib/math/linalg";
import { mad, mean, median, quantile } from "@/lib/math/stats";
import { CV_CONFIG } from "./config";

/** Calibration models older than this are restored as legacy (trust capped at medium). */
export const CURRENT_CALIBRATION_VERSION = 2;

export interface CalibrationSample {
  features: EyeFeatures;
  target: { x: number; y: number };
  /** Leave-one-out group: grid point, head-sweep target, adaptive point or validation point. */
  pointIndex: number;
}

type Axis = "x" | "y";

// ---------------------------------------------------------------------------
// Features and the per-axis ridge model
// ---------------------------------------------------------------------------

export function featureValue(f: EyeFeatures, key: ModelFeatureKey): number {
  switch (key) {
    case "irisHxScale":
      return f.irisH * f.faceScale;
    case "irisVxScale":
      return f.irisV * f.faceScale;
    default:
      return f[key];
  }
}

export function featureVector(f: EyeFeatures, keys: readonly ModelFeatureKey[]): number[] {
  return keys.map((k) => featureValue(f, k));
}

const FEATURE_SETS: FeatureSetName[] = ["base", "scale", "scaleInteraction"];

export function featureSetKeys(axis: Axis, set: FeatureSetName): ModelFeatureKey[] {
  const base = [...CV_CONFIG.features[axis]] as ModelFeatureKey[];
  if (set === "base") return base;
  const scaled = [...base, ...(CV_CONFIG.features.scale as readonly ModelFeatureKey[])];
  if (set === "scale") return scaled;
  return [...scaled, ...(CV_CONFIG.features.interactions as readonly ModelFeatureKey[])];
}

/**
 * Ridge regression on standardized inputs. Each input's scale is floored
 * (`calibration.stdFloor`): an input that barely varied in calibration keeps a
 * bounded influence when it later changes.
 */
export function fitAxis(
  X: number[][],
  y: number[],
  keys: readonly ModelFeatureKey[],
  lambda: number,
  floors: Record<string, number> = CV_CONFIG.calibration.stdFloor,
): AxisModel {
  const n = X.length;
  const d = keys.length;
  const means = new Array<number>(d).fill(0);
  const stds = new Array<number>(d).fill(1);
  for (let j = 0; j < d; j++) {
    const col = X.map((row) => row[j]);
    means[j] = mean(col);
    const sd = Math.sqrt(col.reduce((acc, v) => acc + (v - means[j]) ** 2, 0) / Math.max(1, n - 1));
    stds[j] = Math.max(sd, floors[keys[j]] ?? 0, 1e-9);
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
    v += (model.weights[j] * (featureValue(f, model.features[j]) - model.mean[j])) / model.std[j];
  }
  return v;
}

export function predictGaze(model: Pick<CalibrationModel, "x" | "y">, f: EyeFeatures): { x: number; y: number } {
  return { x: predictAxis(model.x, f), y: predictAxis(model.y, f) };
}

function groupByPoint(samples: readonly CalibrationSample[]): Map<number, CalibrationSample[]> {
  const map = new Map<number, CalibrationSample[]>();
  for (const s of samples) {
    const list = map.get(s.pointIndex) ?? [];
    list.push(s);
    map.set(s.pointIndex, list);
  }
  return map;
}

/** Drops per-point outlier frames (e.g. a glance away mid-point) using a robust MAD test. */
export function trimOutliers(
  samples: readonly CalibrationSample[],
  keys: readonly ModelFeatureKey[],
): CalibrationSample[] {
  const kept: CalibrationSample[] = [];
  for (const group of groupByPoint(samples).values()) {
    if (group.length < 4) {
      kept.push(...group);
      continue;
    }
    const stats = keys.map((k) => {
      const values = group.map((s) => featureValue(s.features, k));
      return { k, med: median(values), spread: Math.max(mad(values) * 1.4826, 1e-6) };
    });
    for (const s of group) {
      if (stats.every(({ k, med, spread }) => Math.abs(featureValue(s.features, k) - med) <= 3.5 * spread)) kept.push(s);
    }
  }
  return kept;
}

/** Grouped leave-one-point-out mean absolute error for one axis (normalized units). */
export function looError(
  samples: readonly CalibrationSample[],
  keys: readonly ModelFeatureKey[],
  axis: Axis,
  lambda: number,
): number {
  const errors: number[] = [];
  for (const [point, held] of groupByPoint(samples)) {
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

/** Input set and ridge penalty with the lowest grouped leave-one-point-out error. */
export function selectAxisModel(samples: readonly CalibrationSample[], axis: Axis) {
  let best = { set: "base" as FeatureSetName, lambda: CV_CONFIG.calibration.lambdas[0] as number, error: Infinity };
  for (const set of FEATURE_SETS) {
    const keys = featureSetKeys(axis, set);
    for (const lambda of CV_CONFIG.calibration.lambdas) {
      const error = looError(samples, keys, axis, lambda);
      if (error < best.error - 1e-12) best = { set, lambda, error };
    }
  }
  const keys = featureSetKeys(axis, best.set);
  const model = fitAxis(
    samples.map((s) => featureVector(s.features, keys)),
    samples.map((s) => s.target[axis]),
    keys,
    best.lambda,
  );
  return { model, set: best.set, loo: best.error };
}

// ---------------------------------------------------------------------------
// Held-out validation, quality, adaptive round
// ---------------------------------------------------------------------------

/**
 * Error of a fitted model on held-out samples, in CSS px of `viewport`.
 * Returns null when fewer than `validation.minPoints` points have enough
 * usable samples.
 */
export function validateCalibration(
  model: Pick<CalibrationModel, "x" | "y">,
  samples: readonly CalibrationSample[],
  viewport: { width: number; height: number },
): CalibrationValidation | null {
  const cfg = CV_CONFIG.calibration.validation;
  const usable = samples.filter((s) => !s.features.blink);
  const perPoint: ValidationPoint[] = [];
  const errors: number[] = [];
  const dxs: number[] = [];
  const dys: number[] = [];
  for (const group of groupByPoint(usable).values()) {
    if (group.length < cfg.minSamplesPerPoint) continue;
    const target = group[0].target;
    const preds = group.map((s) => {
      const p = predictGaze(model, s.features);
      return { x: p.x * viewport.width, y: p.y * viewport.height };
    });
    const tx = target.x * viewport.width;
    const ty = target.y * viewport.height;
    const pointErrors = preds.map((p) => Math.hypot(p.x - tx, p.y - ty));
    const mx = median(preds.map((p) => p.x));
    const my = median(preds.map((p) => p.y));
    perPoint.push({
      target,
      samples: group.length,
      medianPx: median(pointErrors),
      precisionPx: Math.sqrt(mean(preds.map((p) => (p.x - mx) ** 2 + (p.y - my) ** 2))),
      biasPx: { x: mx - tx, y: my - ty },
    });
    errors.push(...pointErrors);
    dxs.push(...preds.map((p) => p.x - tx));
    dys.push(...preds.map((p) => p.y - ty));
  }
  if (perPoint.length < cfg.minPoints) return null;
  return {
    points: perPoint.length,
    samples: errors.length,
    medianPx: median(errors),
    p90Px: quantile(errors, 0.9),
    worstPointPx: Math.max(...perPoint.map((p) => p.medianPx)),
    precisionPx: median(perPoint.map((p) => p.precisionPx)),
    sigmaPx: {
      x: Math.sqrt(mean(dxs.map((d) => d * d))),
      y: Math.sqrt(mean(dys.map((d) => d * d))),
    },
    perPoint,
  };
}

/** Quality from held-out per-axis RMSE (operating thresholds, see CV_CONFIG.calibration.quality). */
export function qualityFromSigma(sigmaPx: { x: number; y: number }, viewport: { width: number; height: number }): CalibrationQuality {
  const q = CV_CONFIG.calibration.quality;
  const x = sigmaPx.x / viewport.width;
  const y = sigmaPx.y / viewport.height;
  if (x <= q.good.x && y <= q.good.y) return "good";
  if (x <= q.fair.x && y <= q.fair.y) return "fair";
  return "poor";
}

/** Legacy (v1) quality from leave-one-point-out mean error, as a fraction of the viewport. */
export function qualityFromError(err: { x: number; y: number }): CalibrationQuality {
  const q = CV_CONFIG.calibration.legacyQuality;
  if (err.x <= q.good.x && err.y <= q.good.y) return "good";
  if (err.x <= q.fair.x && err.y <= q.fair.y) return "fair";
  return "poor";
}

/**
 * The validation point that warrants one adaptive round: its error is more
 * than twice the median point error and larger than 18% of the viewport
 * width. Null when the error is spread evenly (or low everywhere).
 */
export function adaptiveTarget(
  validation: CalibrationValidation | null,
  viewport: { width: number; height: number },
): ValidationPoint | null {
  if (!validation || validation.perPoint.length < 2) return null;
  const cfg = CV_CONFIG.calibration.adaptive;
  const typical = median(validation.perPoint.map((p) => p.medianPx));
  const worst = validation.perPoint.reduce((a, b) => (b.medianPx > a.medianPx ? b : a));
  const threshold = Math.max(cfg.worstToMedianRatio * typical, cfg.worstMinFractionOfWidth * viewport.width);
  return worst.medianPx > threshold ? worst : null;
}

const towardCentre = (v: number, offset: number) => (v <= 0.5 ? v + offset : v - offset);

/** Two extra training points next to the worst validation point, stepped toward the screen centre. */
export function adaptivePoints(worst: { x: number; y: number }): Array<[number, number]> {
  const o = CV_CONFIG.calibration.adaptive.offset;
  return [
    [towardCentre(worst.x, o), worst.y],
    [worst.x, towardCentre(worst.y, o)],
  ];
}

/** Three new held-out points: one between the worst area and the centre, plus two fixed ones. */
export function revalidationPoints(worst: { x: number; y: number }): Array<[number, number]> {
  return [
    [(worst.x + 0.5) / 2, (worst.y + 0.5) / 2],
    ...CV_CONFIG.calibration.adaptive.revalidationPoints.map(([x, y]) => [x, y] as [number, number]),
  ];
}

// ---------------------------------------------------------------------------
// Posture and head sweep
// ---------------------------------------------------------------------------

/** Robust center and spread of the head posture the model was trained on. */
export function postureOf(samples: readonly CalibrationSample[]): PostureModel {
  const keys = [...CV_CONFIG.calibration.posture.keys] as FeatureKey[];
  const floors = CV_CONFIG.calibration.stdFloor;
  const usable = samples.filter((s) => !s.features.blink);
  return {
    keys,
    center: keys.map((k) => median(usable.map((s) => s.features[k]))),
    scale: keys.map((k) => Math.max(1.4826 * mad(usable.map((s) => s.features[k])), floors[k] ?? 1e-6)),
  };
}

/** Head movement achieved in a set of samples: 5th to 95th percentile of yaw and pitch, degrees. */
export function headRange(samples: readonly CalibrationSample[]): { yawRange: number; pitchRange: number } {
  const usable = samples.filter((s) => !s.features.blink);
  const range = (values: number[]) => (values.length ? quantile(values, 0.95) - quantile(values, 0.05) : 0);
  return {
    yawRange: range(usable.map((s) => s.features.yaw)),
    pitchRange: range(usable.map((s) => s.features.pitch)),
  };
}

// ---------------------------------------------------------------------------
// Fitting a calibration
// ---------------------------------------------------------------------------

export interface CalibrationInput {
  /** Grid, head-sweep and adaptive samples. The only data the model is fitted on. */
  train: readonly CalibrationSample[];
  /** Held-out samples. Only ever predicted, never fitted. */
  validation: readonly CalibrationSample[];
  viewport: { width: number; height: number };
  display?: Omit<DisplayState, "viewport">;
  headSweep?: { yawRange: number; pitchRange: number } | null;
  adaptive?: boolean;
  /** Validation groups left out of the reported accuracy (the point that triggered the adaptive round). */
  excludeValidationGroups?: readonly number[];
}

export interface FitResult {
  model: CalibrationModelV2 | null;
  reason?: string;
}

export function fitCalibration(input: CalibrationInput): FitResult {
  const allKeys = [
    ...new Set([...featureSetKeys("x", "scaleInteraction"), ...featureSetKeys("y", "scaleInteraction")]),
  ];
  const train = trimOutliers(
    input.train.filter((s) => !s.features.blink),
    allKeys,
  );
  const usable = [...groupByPoint(train).values()].filter((g) => g.length >= 3).length;
  if (usable < 5) {
    return { model: null, reason: `Only ${usable} calibration points had usable eye data (need 5).` };
  }

  const fx = selectAxisModel(train, "x");
  const fy = selectAxisModel(train, "y");
  const excluded = new Set(input.excludeValidationGroups ?? []);
  const validation = validateCalibration(
    { x: fx.model, y: fy.model },
    input.validation.filter((s) => !excluded.has(s.pointIndex)),
    input.viewport,
  );
  return {
    model: {
      version: 2,
      x: fx.model,
      y: fy.model,
      featureSets: { x: fx.set, y: fy.set },
      loo: { x: fx.loo, y: fy.loo },
      validation,
      // No held-out measurement, no claim: recalibration is recommended.
      quality: validation ? qualityFromSigma(validation.sigmaPx, input.viewport) : "poor",
      posture: postureOf(train),
      headSweep: input.headSweep ?? null,
      adaptive: input.adaptive ?? false,
      viewport: input.viewport,
      ...(input.display?.screen ? { screen: input.display.screen } : {}),
      ...(input.display?.dpr ? { dpr: input.display.dpr } : {}),
      pointCount: usable,
      sampleCount: train.length,
      createdAt: Date.now(),
    },
  };
}

// ---------------------------------------------------------------------------
// Using and restoring a calibration
// ---------------------------------------------------------------------------

/**
 * True when the display changed enough that the calibration no longer maps
 * gaze to the same pixels: the viewport was resized, the window was moved on
 * the screen (the camera stays put, the pixels move), or the zoom /
 * devicePixelRatio changed.
 */
export function isCalibrationStale(
  model: Pick<CalibrationModel, "viewport" | "screen" | "dpr">,
  display: DisplayState,
): boolean {
  const cfg = CV_CONFIG.calibration;
  const { viewport } = display;
  if (
    Math.abs(viewport.width - model.viewport.width) / model.viewport.width > cfg.staleViewportChange ||
    Math.abs(viewport.height - model.viewport.height) / model.viewport.height > cfg.staleViewportChange
  ) {
    return true;
  }
  if (model.screen && display.screen) {
    const moved = Math.hypot(display.screen.x - model.screen.x, display.screen.y - model.screen.y);
    if (moved > cfg.staleWindowMovePx) return true;
  }
  if (model.dpr && display.dpr && Math.abs(display.dpr - model.dpr) > cfg.staleDprChange) return true;
  return false;
}

/**
 * 1-sigma gaze error per axis in CSS px: held-out RMSE for v2 models, the
 * leave-one-point-out error for legacy v1 models.
 */
export function gazeSigmaPx(model: CalibrationModel | null): { x: number; y: number } | null {
  if (!model) return null;
  if (model.version === 1) return { x: model.errorPx.x, y: model.errorPx.y };
  if (model.validation) return { ...model.validation.sigmaPx };
  return { x: model.loo.x * model.viewport.width, y: model.loo.y * model.viewport.height };
}

/** Measured precision (jitter) in CSS px, or null for legacy models. */
export function gazePrecisionPx(model: CalibrationModel | null): number | null {
  return model?.version === 2 && model.validation ? model.validation.precisionPx : null;
}

const isAxis = (a: unknown): a is AxisModel => {
  const m = a as AxisModel | null;
  return (
    !!m &&
    Array.isArray(m.features) &&
    Array.isArray(m.weights) &&
    Array.isArray(m.mean) &&
    Array.isArray(m.std) &&
    m.features.length === m.weights.length &&
    typeof m.intercept === "number"
  );
};

/** Validates a stored calibration (either version); null when it is not usable. */
export function parseCalibrationModel(raw: unknown): CalibrationModel | null {
  const m = raw as Partial<CalibrationModel> | null;
  if (!m || !isAxis(m.x) || !isAxis(m.y) || !m.viewport?.width || !m.viewport?.height) return null;
  if (m.version === 1) {
    const v1 = m as CalibrationModelV1;
    return v1.errorPx && v1.errorNorm ? v1 : null;
  }
  if (m.version === 2) {
    const v2 = m as CalibrationModelV2;
    return v2.posture && Array.isArray(v2.posture.center) && v2.loo ? v2 : null;
  }
  return null;
}
