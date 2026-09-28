/**
 * L2-regularized logistic regression trained with Newton's method (IRLS).
 * Small, exact, explainable: every coefficient maps to a named feature.
 *
 * Shared by the in-browser Model Lab and scripts/train-attention-model.ts.
 */
import type { AttentionLabel } from "@/types/attention";
import { solveSPD } from "@/lib/math/linalg";
import { mean } from "@/lib/math/stats";
import { toVector } from "./features";

export type { AttentionLabel };

export interface LabeledExample {
  features: number[];
  label: AttentionLabel;
}

export interface ClassifierMetrics {
  folds: number;
  accuracy: number;
  auc: number;
  logLoss: number;
}

export interface AttentionClassifier {
  version: 1;
  /** Version of the named feature set the model was trained on. */
  featureSchemaVersion?: number;
  featureNames: string[];
  mean: number[];
  std: number[];
  /** weights[0] is the intercept; weights[i + 1] belongs to featureNames[i]. */
  weights: number[];
  lambda: number;
  positiveLabel: "LOW_ATTENTION";
  trainedAt: number;
  samples: { total: number; attentive: number; lowAttention: number };
  /** Stratified k-fold cross-validation on the training data. Null if too little data. */
  metrics: ClassifierMetrics | null;
}

export const MIN_EXAMPLES_PER_CLASS = 8;

export const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

export function standardize(X: number[][]) {
  const d = X[0]?.length ?? 0;
  const mu = new Array<number>(d).fill(0);
  const sd = new Array<number>(d).fill(1);
  for (let j = 0; j < d; j++) {
    const col = X.map((r) => r[j]);
    mu[j] = mean(col);
    const v = col.reduce((a, x) => a + (x - mu[j]) ** 2, 0) / Math.max(1, col.length - 1);
    sd[j] = Math.sqrt(v) > 1e-9 ? Math.sqrt(v) : 1;
  }
  return { mu, sd };
}

/** Fits weights on standardized features. Returns [intercept, ...coefficients]. */
export function fitLogistic(Z: number[][], y: number[], lambda: number, maxIter = 50): number[] {
  const n = Z.length;
  const d = (Z[0]?.length ?? 0) + 1;
  let w = new Array<number>(d).fill(0);
  for (let iter = 0; iter < maxIter; iter++) {
    const H: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
    const g = new Array<number>(d).fill(0);
    for (let i = 0; i < n; i++) {
      const x = [1, ...Z[i]];
      let z = 0;
      for (let j = 0; j < d; j++) z += w[j] * x[j];
      const p = sigmoid(z);
      const r = p - y[i];
      const s = Math.max(p * (1 - p), 1e-6);
      for (let j = 0; j < d; j++) {
        g[j] += r * x[j];
        for (let k = j; k < d; k++) H[j][k] += s * x[j] * x[k];
      }
    }
    for (let j = 0; j < d; j++) {
      for (let k = 0; k < j; k++) H[j][k] = H[k][j];
      if (j > 0) {
        H[j][j] += lambda;
        g[j] += lambda * w[j];
      } else {
        H[j][j] += 1e-6;
      }
    }
    const step = solveSPD(H, g);
    const next = w.map((wj, j) => wj - step[j]);
    const delta = Math.sqrt(step.reduce((a, s) => a + s * s, 0));
    w = next;
    if (delta < 1e-7) break;
  }
  return w;
}

export function predictProbability(model: AttentionClassifier, features: readonly number[]): number {
  let z = model.weights[0];
  for (let j = 0; j < model.featureNames.length; j++) {
    z += (model.weights[j + 1] * ((features[j] ?? 0) - model.mean[j])) / model.std[j];
  }
  return sigmoid(z);
}

/** Probability for named features; missing values take the model's training mean. */
export function predictNamed(model: AttentionClassifier, values: Partial<Record<string, number | null>>): number {
  return predictProbability(model, toVector(values, model.featureNames, model.mean));
}

/**
 * Rows of named features to a matrix, missing values imputed with the mean of
 * the observed values in `rows` (so "no gaze" is never read as 0).
 */
export function imputedMatrix(
  rows: readonly Partial<Record<string, number | null>>[],
  names: readonly string[],
): { X: number[][]; means: number[] } {
  const means = names.map((name) => {
    const seen = rows.map((r) => r[name]).filter((v): v is number => v != null && Number.isFinite(v));
    return seen.length ? mean(seen) : 0;
  });
  return { X: rows.map((r) => toVector(r, names, means)), means };
}

/** Trains on named features: missing values imputed with training means, which the model keeps for prediction. */
export function trainNamedClassifier(
  rows: readonly { values: Partial<Record<string, number | null>>; label: AttentionLabel }[],
  featureNames: readonly string[],
  lambda = 1,
  featureSchemaVersion?: number,
): AttentionClassifier {
  const { X } = imputedMatrix(
    rows.map((r) => r.values),
    featureNames,
  );
  const model = trainClassifier(
    X.map((features, i) => ({ features, label: rows[i].label })),
    featureNames,
    lambda,
  );
  return featureSchemaVersion === undefined ? model : { ...model, featureSchemaVersion };
}

/** Platt scaling: p' = sigmoid(a * logit(p) + b), fitted on held-out (out-of-fold) probabilities. */
export interface Platt {
  a: number;
  b: number;
}

const logit = (p: number) => {
  const q = Math.min(1 - 1e-6, Math.max(1e-6, p));
  return Math.log(q / (1 - q));
};

export function fitPlatt(probs: readonly number[], labels: readonly number[]): Platt {
  if (probs.length < 2 || new Set(labels).size < 2) return { a: 1, b: 0 };
  const w = fitLogistic(
    probs.map((p) => [logit(p)]),
    [...labels],
    1e-3,
  );
  return { a: w[1], b: w[0] };
}

export function applyPlatt(platt: Platt, p: number): number {
  return sigmoid(platt.a * logit(p) + platt.b);
}

/** Leave-one-group-out folds: each fold holds out every row of one group. */
export function leaveOneGroupOut(groups: readonly string[]): { group: string; train: number[]; test: number[] }[] {
  return [...new Set(groups)].map((group) => ({
    group,
    train: groups.flatMap((g, i) => (g === group ? [] : [i])),
    test: groups.flatMap((g, i) => (g === group ? [i] : [])),
  }));
}

/** Up to k folds of whole groups (for inner cross-validation inside a training fold). */
export function groupKFold(groups: readonly string[], k: number): { train: number[]; test: number[] }[] {
  const unique = [...new Set(groups)];
  const n = Math.min(k, unique.length);
  const foldOf = new Map(unique.map((g, i) => [g, i % n]));
  return Array.from({ length: n }, (_, f) => ({
    train: groups.flatMap((g, i) => (foldOf.get(g) === f ? [] : [i])),
    test: groups.flatMap((g, i) => (foldOf.get(g) === f ? [i] : [])),
  }));
}

/** Area under the ROC curve via the Mann-Whitney statistic. */
export function auc(scores: number[], labels: number[]): number {
  const pos = scores.filter((_, i) => labels[i] === 1);
  const neg = scores.filter((_, i) => labels[i] === 0);
  if (!pos.length || !neg.length) return 0.5;
  let wins = 0;
  for (const p of pos) for (const q of neg) wins += p > q ? 1 : p === q ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

function stratifiedFolds(labels: number[], k: number): number[] {
  const fold = new Array<number>(labels.length).fill(0);
  for (const cls of [0, 1]) {
    const idx = labels.map((l, i) => (l === cls ? i : -1)).filter((i) => i >= 0);
    idx.forEach((i, j) => {
      fold[i] = j % k;
    });
  }
  return fold;
}

export function crossValidate(
  X: number[][],
  y: number[],
  lambda: number,
  k: number,
): ClassifierMetrics {
  const folds = stratifiedFolds(y, k);
  const probs = new Array<number>(y.length).fill(0.5);
  for (let f = 0; f < k; f++) {
    const trainIdx = y.map((_, i) => i).filter((i) => folds[i] !== f);
    const testIdx = y.map((_, i) => i).filter((i) => folds[i] === f);
    if (!testIdx.length || !trainIdx.length) continue;
    const trainX = trainIdx.map((i) => X[i]);
    const { mu, sd } = standardize(trainX);
    const w = fitLogistic(
      trainX.map((r) => r.map((v, j) => (v - mu[j]) / sd[j])),
      trainIdx.map((i) => y[i]),
      lambda,
    );
    for (const i of testIdx) {
      let z = w[0];
      for (let j = 0; j < mu.length; j++) z += (w[j + 1] * (X[i][j] - mu[j])) / sd[j];
      probs[i] = sigmoid(z);
    }
  }
  const accuracy = mean(probs.map((p, i) => ((p >= 0.5 ? 1 : 0) === y[i] ? 1 : 0)));
  const logLoss = mean(
    probs.map((p, i) => {
      const q = Math.min(1 - 1e-9, Math.max(1e-9, p));
      return -(y[i] * Math.log(q) + (1 - y[i]) * Math.log(1 - q));
    }),
  );
  return { folds: k, accuracy, auc: auc(probs, y), logLoss };
}

export function trainClassifier(
  examples: readonly LabeledExample[],
  featureNames: readonly string[],
  lambda = 1,
): AttentionClassifier {
  if (examples.length === 0) throw new Error("No labeled examples.");
  const X = examples.map((e) => e.features);
  const y = examples.map((e) => (e.label === "LOW_ATTENTION" ? 1 : 0));
  const lowAttention = y.filter((v) => v === 1).length;
  const attentive = y.length - lowAttention;
  if (lowAttention === 0 || attentive === 0) {
    throw new Error("Need examples of both ATTENTIVE and LOW_ATTENTION reviews.");
  }
  const { mu, sd } = standardize(X);
  const weights = fitLogistic(
    X.map((r) => r.map((v, j) => (v - mu[j]) / sd[j])),
    y,
    lambda,
  );
  const minority = Math.min(lowAttention, attentive);
  const metrics = minority >= 3 ? crossValidate(X, y, lambda, Math.min(5, minority)) : null;
  return {
    version: 1,
    featureNames: [...featureNames],
    mean: mu,
    std: sd,
    weights,
    lambda,
    positiveLabel: "LOW_ATTENTION",
    trainedAt: Date.now(),
    samples: { total: y.length, attentive, lowAttention },
    metrics,
  };
}

/**
 * The classifier only influences decisions when it has been validated on
 * enough of *your own* labeled data. Otherwise it is displayed as untrained
 * and the deterministic engine decides alone.
 */
export function isClassifierUsable(model: AttentionClassifier | null): boolean {
  if (!model?.metrics) return false;
  return (
    model.samples.attentive >= MIN_EXAMPLES_PER_CLASS &&
    model.samples.lowAttention >= MIN_EXAMPLES_PER_CLASS &&
    model.metrics.auc >= 0.7
  );
}

/** Coefficients ranked by magnitude, for explainability. */
export function topCoefficients(model: AttentionClassifier, n = 5) {
  return model.featureNames
    .map((name, i) => ({ name, weight: model.weights[i + 1] }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, n);
}
