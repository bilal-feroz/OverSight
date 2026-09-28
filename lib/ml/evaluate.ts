/**
 * Grouped evaluation: can a learned model beat the deterministic rules,
 * measured without leakage? (docs/EVALUATION.md)
 *
 * - Leave-one-participant-out cross-validation (leave-one-session-out, with a
 *   loud warning, when there are fewer than 5 participants).
 * - Imputation, standardization and Platt calibration are fitted inside each
 *   training fold only; Platt uses inner grouped out-of-fold predictions.
 * - Rules and models are compared on identical folds, at the discrimination
 *   level (PR-AUC, ROC-AUC, Brier, reliability) and at the policy level by
 *   replaying decideIntervention with and without the model's probability.
 * - Confidence intervals by bootstrap over participants (or sessions).
 */
import type { InterventionLevel } from "@/types/attention";
import { INTERVENTION_ORDER } from "@/types/attention";
import { RISK_ORDER } from "@/types/approval";
import { ATTENTION_CONFIG } from "@/lib/attention/config";
import { mean, quantile } from "@/lib/math/stats";
import type { MlInfluence } from "@/lib/risk/intervention";
import type { DatasetEntry } from "./dataset";
import { CURRENT_REVIEW_FEATURES, FEATURE_NAMES, FEATURE_SCHEMA_VERSION, toVector } from "./features";
import {
  applyPlatt,
  auc,
  fitLogistic,
  fitPlatt,
  groupKFold,
  imputedMatrix,
  leaveOneGroupOut,
  sigmoid,
  standardize,
  type Platt,
} from "./logistic";
import { CONDITIONS, type Condition } from "./protocol";
import { replayDecision } from "./replay";

export const MIN_PARTICIPANTS_FOR_DECISION = 5;
export const MIN_GROUPS_FOR_METRICS = 3;
export const MIN_PARTICIPANTS_FOR_GBDT = 8;

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export { auc as rocAuc };

/** Average precision (area under the precision-recall curve, step interpolation, ties grouped). */
export function prAuc(scores: readonly number[], labels: readonly number[]): number {
  const positives = labels.filter((l) => l === 1).length;
  if (!positives) return NaN;
  const order = scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
  let tp = 0;
  let fp = 0;
  let prevRecall = 0;
  let ap = 0;
  for (let i = 0; i < order.length; ) {
    const s = scores[order[i]];
    let j = i;
    while (j < order.length && scores[order[j]] === s) {
      if (labels[order[j]] === 1) tp++;
      else fp++;
      j++;
    }
    const recall = tp / positives;
    ap += (recall - prevRecall) * (tp / (tp + fp));
    prevRecall = recall;
    i = j;
  }
  return ap;
}

export function brierScore(probs: readonly number[], labels: readonly number[]): number {
  return probs.length ? mean(probs.map((p, i) => (p - labels[i]) ** 2)) : NaN;
}

export interface ReliabilityBin {
  lo: number;
  hi: number;
  count: number;
  meanPredicted: number | null;
  observed: number | null;
}

export function reliability(probs: readonly number[], labels: readonly number[], bins = 10): ReliabilityBin[] {
  return Array.from({ length: bins }, (_, b) => {
    const lo = b / bins;
    const hi = (b + 1) / bins;
    const idx = probs.flatMap((p, i) => ((p >= lo && p < hi) || (b === bins - 1 && p === 1) ? [i] : []));
    return {
      lo,
      hi,
      count: idx.length,
      meanPredicted: idx.length ? mean(idx.map((i) => probs[i])) : null,
      observed: idx.length ? mean(idx.map((i) => labels[i])) : null,
    };
  });
}

export interface Rate {
  rate: number | null;
  /** Eligible approvals. */
  n: number;
}

/** Share of ATTENTIVE approvals (label 0) that were redirected or paused. */
export function falseInterventionRate(levels: readonly InterventionLevel[], labels: readonly number[], idx?: readonly number[]): Rate {
  const rows = (idx ?? levels.map((_, i) => i)).filter((i) => labels[i] === 0);
  return {
    rate: rows.length ? rows.filter((i) => INTERVENTION_ORDER[levels[i]] >= INTERVENTION_ORDER.REFOCUS).length / rows.length : null,
    n: rows.length,
  };
}

/** Share of LOW_ATTENTION approvals (label 1) of HIGH/CRITICAL requests that went through without a redirect or pause. */
export function missedDangerousRate(
  levels: readonly InterventionLevel[],
  labels: readonly number[],
  risks: readonly string[],
  idx?: readonly number[],
): Rate {
  const rows = (idx ?? levels.map((_, i) => i)).filter(
    (i) => labels[i] === 1 && RISK_ORDER[risks[i] as keyof typeof RISK_ORDER] >= RISK_ORDER.HIGH,
  );
  return {
    rate: rows.length ? rows.filter((i) => INTERVENTION_ORDER[levels[i]] < INTERVENTION_ORDER.REFOCUS).length / rows.length : null,
    n: rows.length,
  };
}

function rng(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bootstrap over groups: resample whole groups with replacement, evaluate `stat` on their rows. */
export function bootstrapGroups(
  groups: readonly string[],
  stat: (rows: number[]) => number | null,
  resamples: number,
  seed = 1,
): number[] {
  const rand = rng(seed);
  const byGroup = new Map<string, number[]>();
  groups.forEach((g, i) => byGroup.set(g, [...(byGroup.get(g) ?? []), i]));
  const keys = [...byGroup.keys()];
  const out: number[] = [];
  for (let b = 0; b < resamples; b++) {
    const rows: number[] = [];
    for (let k = 0; k < keys.length; k++) rows.push(...byGroup.get(keys[Math.floor(rand() * keys.length)])!);
    const v = stat(rows);
    if (v !== null && Number.isFinite(v)) out.push(v);
  }
  return out;
}

/** Percentile bootstrap interval (linearly interpolated quantiles). */
export function percentileInterval(values: readonly number[], level = 0.95): [number, number] | null {
  if (!values.length) return null;
  return [quantile(values, (1 - level) / 2), quantile(values, 1 - (1 - level) / 2)];
}

// ---------------------------------------------------------------------------
// Models inside folds
// ---------------------------------------------------------------------------

type Values = Partial<Record<string, number | null>>;

export interface FittedLR {
  names: readonly string[];
  impute: number[];
  mu: number[];
  sd: number[];
  w: number[];
}

export function fitLR(rows: readonly Values[], y: readonly number[], names: readonly string[], lambda: number): FittedLR {
  const { X, means } = imputedMatrix(rows, names);
  const { mu, sd } = standardize(X);
  const w = fitLogistic(
    X.map((r) => r.map((v, j) => (v - mu[j]) / sd[j])),
    [...y],
    lambda,
  );
  return { names, impute: means, mu, sd, w };
}

export function predictLR(m: FittedLR, values: Values): number {
  const x = toVector(values, m.names, m.impute);
  let z = m.w[0];
  for (let j = 0; j < x.length; j++) z += (m.w[j + 1] * (x[j] - m.mu[j])) / m.sd[j];
  return sigmoid(z);
}

/**
 * A calibrated model for one training fold: Platt is fitted on inner grouped
 * out-of-fold predictions (so calibration never sees its own training rows),
 * then the final model is fitted on the whole training fold. Also returns the
 * calibrated inner out-of-fold probabilities of the training rows, which the
 * operating-point choice uses.
 */
function fitCalibrated(rows: readonly Values[], y: readonly number[], groups: readonly string[], names: readonly string[], lambda: number) {
  const oof = new Array<number>(rows.length).fill(0.5);
  const inner = groupKFold(groups, 5);
  if (inner.length >= 2) {
    for (const f of inner) {
      const trainY = f.train.map((i) => y[i]);
      if (new Set(trainY).size < 2) continue;
      const m = fitLR(f.train.map((i) => rows[i]), trainY, names, lambda);
      for (const i of f.test) oof[i] = predictLR(m, rows[i]);
    }
  }
  const platt: Platt = inner.length >= 2 ? fitPlatt(oof, y) : { a: 1, b: 0 };
  const model = fitLR(rows, y, names, lambda);
  return {
    predict: (values: Values) => applyPlatt(platt, predictLR(model, values)),
    trainOof: oof.map((p) => applyPlatt(platt, p)),
  };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface PolicyMetrics {
  fir: Rate;
  mdar: Rate;
  byCondition: Record<Condition, { n: number; fir: Rate; mdar: Rate }>;
}

export interface ModelResult {
  id: string;
  name: string;
  features: number;
  /** Null when there are too few groups to say anything. */
  discrimination: { rocAuc: number; prAuc: number; brier: number } | null;
  reliability: ReliabilityBin[];
  policy: PolicyMetrics | null;
  /** Operating points (tauVerify) chosen on the training folds. */
  operatingPoints?: number[];
}

export interface DecisionRuleOutcome {
  model: string;
  adopt: boolean;
  firRules: number | null;
  firModel: number | null;
  mdarRules: number | null;
  mdarModel: number | null;
  /** Relative MDAR reduction (rules - model) / rules. */
  relativeReduction: number | null;
  interval: [number, number] | null;
  reasons: string[];
}

export interface EvaluationReport {
  label: string;
  synthetic: boolean;
  grouping: "participant" | "session";
  sizes: {
    entries: number;
    participants: number;
    sessions: number;
    groups: number;
    attentive: number;
    lowAttention: number;
    byCondition: Record<Condition, number>;
    excluded: number;
  };
  warnings: string[];
  rules: ModelResult[];
  models: ModelResult[];
  decision: DecisionRuleOutcome;
  gbdt: { run: boolean; reason: string };
}

export interface EvaluationOptions {
  /** Shown at the top of the report (for example the dataset file name). */
  label?: string;
  /** Marks the report as built from a synthetic fixture: never a result. */
  synthetic?: boolean;
  lambda?: number;
  bootstrap?: number;
  seed?: number;
}

export const TAU_GRID = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];
export const FIR_TOLERANCE = 0.01;
const MIN_RELATIVE_REDUCTION = 0.2;

function policyMetrics(levels: InterventionLevel[], labels: number[], entries: readonly DatasetEntry[]): PolicyMetrics {
  const risks = entries.map((e) => e.risk);
  const byCondition = Object.fromEntries(
    CONDITIONS.map((c) => {
      const idx = entries.flatMap((e, i) => (e.condition === c ? [i] : []));
      return [
        c,
        { n: idx.length, fir: falseInterventionRate(levels, labels, idx), mdar: missedDangerousRate(levels, labels, risks, idx) },
      ];
    }),
  ) as PolicyMetrics["byCondition"];
  return { fir: falseInterventionRate(levels, labels), mdar: missedDangerousRate(levels, labels, risks), byCondition };
}

export function evaluateDataset(all: readonly DatasetEntry[], opts: EvaluationOptions = {}): EvaluationReport {
  const lambda = opts.lambda ?? 1;
  const resamples = opts.bootstrap ?? 1000;
  const seed = opts.seed ?? 1;
  const warnings: string[] = [];

  const entries = all.filter((e) => e.features.schemaVersion === FEATURE_SCHEMA_VERSION);
  const excluded = all.length - entries.length;
  if (excluded) warnings.push(`${excluded} entries use another feature schema and were excluded.`);
  if (new Set(entries.map((e) => e.policyVersion)).size > 1) {
    warnings.push("Entries were collected under different policy versions; decisions are replayed with the current policy.");
  }
  warnings.push("Labels come from instructed conditions (weak supervision): low-attention behavior is likely, not certain.");

  const participants = new Set(entries.map((e) => e.participant)).size;
  const sessions = new Set(entries.map((e) => e.sessionId)).size;
  const grouping: "participant" | "session" = participants >= MIN_PARTICIPANTS_FOR_DECISION ? "participant" : "session";
  if (grouping === "session") {
    warnings.push(
      `WARNING: only ${participants} participant${participants === 1 ? "" : "s"}; falling back to leave-one-SESSION-out. Rows from one person can sit on both sides of a split, so these numbers are optimistic and no adoption decision can be made.`,
    );
  }
  const groups = entries.map((e) => (grouping === "participant" ? e.participant : e.sessionId));
  const groupCount = new Set(groups).size;
  const labels = entries.map((e) => (e.label === "LOW_ATTENTION" ? 1 : 0));
  const enough = groupCount >= MIN_GROUPS_FOR_METRICS && new Set(labels).size === 2;
  if (!enough) warnings.push(`Insufficient data: ${groupCount} group${groupCount === 1 ? "" : "s"} (need at least ${MIN_GROUPS_FOR_METRICS}, with both labels).`);

  const byCondition = Object.fromEntries(CONDITIONS.map((c) => [c, entries.filter((e) => e.condition === c).length])) as Record<Condition, number>;
  const sizes = {
    entries: entries.length,
    participants,
    sessions,
    groups: groupCount,
    attentive: labels.filter((l) => l === 0).length,
    lowAttention: labels.filter((l) => l === 1).length,
    byCondition,
    excluded,
  };

  // --- (a) rules -------------------------------------------------------------
  const rulesLevels = entries.map((e) => replayDecision(e).level);
  const ruleScores: Array<[string, string, number[]]> = [
    ["rules-score", "Rules: 1 - attention score", entries.map((e) => 1 - e.policyInput.assessment.attentionScore)],
    ["rules-anomaly", "Rules: behavioral anomaly", entries.map((e) => e.policyInput.assessment.anomaly)],
  ];
  const rules: ModelResult[] = ruleScores.map(([id, name, scores], k) => ({
    id,
    name,
    features: 0,
    discrimination: enough ? { rocAuc: auc(scores, labels), prAuc: prAuc(scores, labels), brier: NaN } : null,
    reliability: [],
    policy: k === 0 && enough ? policyMetrics(rulesLevels, labels, entries) : null,
  }));

  // --- (b), (c) logistic regression on identical folds ---------------------------
  const folds = leaveOneGroupOut(groups);
  const specs: Array<{ id: string; name: string; names: readonly string[] }> = [
    { id: "lr-current", name: "LR: current-review features", names: CURRENT_REVIEW_FEATURES },
    { id: "lr-temporal", name: "LR: current-review + temporal + personal-baseline features", names: FEATURE_NAMES },
  ];
  const tauSens = ATTENTION_CONFIG.ml.tauSens;
  const levelsWith = (idx: readonly number[], probs: ReadonlyMap<number, number>, tauVerify: number | null) =>
    idx.map((i) => {
      const ml: MlInfluence | null =
        tauVerify === null ? null : { probability: probs.get(i) ?? 0, tauSens, tauVerify };
      return replayDecision(entries[i], ml).level;
    });

  const modelLevels = new Map<string, InterventionLevel[]>();
  const models: ModelResult[] = specs.map((spec) => {
    const probs = new Array<number>(entries.length).fill(NaN);
    const levels: InterventionLevel[] = [...rulesLevels];
    const operatingPoints: number[] = [];
    if (enough) {
      for (const fold of folds) {
        const trainY = fold.train.map((i) => labels[i]);
        if (new Set(trainY).size < 2) continue;
        const fitted = fitCalibrated(
          fold.train.map((i) => entries[i].features.values),
          trainY,
          fold.train.map((i) => groups[i]),
          spec.names,
          lambda,
        );
        for (const i of fold.test) probs[i] = fitted.predict(entries[i].features.values);
        // Operating point from the training fold only: the most sensitive tauVerify
        // whose training FIR stays within tolerance of the rules' training FIR.
        const trainProbs = new Map(fold.train.map((i, k) => [i, fitted.trainOof[k]]));
        const firRulesTrain = falseInterventionRate(rulesLevels, labels, fold.train).rate ?? 0;
        let chosen: number | null = null;
        for (const tau of [...TAU_GRID, Number.POSITIVE_INFINITY]) {
          const trainLevels = levelsWith(fold.train, trainProbs, tau);
          const all = [...rulesLevels];
          fold.train.forEach((i, k) => (all[i] = trainLevels[k]));
          const fir = falseInterventionRate(all, labels, fold.train).rate ?? 0;
          if (fir - firRulesTrain <= FIR_TOLERANCE) {
            chosen = tau;
            break;
          }
        }
        operatingPoints.push(chosen ?? Number.NaN);
        const testProbs = new Map(fold.test.map((i) => [i, probs[i]]));
        const testLevels = levelsWith(fold.test, testProbs, chosen);
        fold.test.forEach((i, k) => (levels[i] = testLevels[k]));
      }
    }
    modelLevels.set(spec.id, levels);
    const scored = probs.map((p, i) => [p, labels[i]] as const).filter(([p]) => Number.isFinite(p));
    const ps = scored.map(([p]) => p);
    const ys = scored.map(([, y]) => y);
    return {
      id: spec.id,
      name: spec.name,
      features: spec.names.length,
      discrimination: enough && ps.length ? { rocAuc: auc(ps, ys), prAuc: prAuc(ps, ys), brier: brierScore(ps, ys) } : null,
      reliability: enough ? reliability(ps, ys) : [],
      policy: enough ? policyMetrics(levels, labels, entries) : null,
      operatingPoints,
    };
  });

  // --- pre-registered decision rule, applied to model (c) ------------------------
  const candidate = "lr-temporal";
  const candLevels = modelLevels.get(candidate)!;
  const risks = entries.map((e) => e.risk);
  const firRules = falseInterventionRate(rulesLevels, labels).rate;
  const firModel = falseInterventionRate(candLevels, labels).rate;
  const mdarRules = missedDangerousRate(rulesLevels, labels, risks).rate;
  const mdarModel = missedDangerousRate(candLevels, labels, risks).rate;
  const reduction = (rows: number[]) => {
    const r = missedDangerousRate(rulesLevels, labels, risks, rows).rate;
    const m = missedDangerousRate(candLevels, labels, risks, rows).rate;
    return r && m !== null ? (r - m) / r : null;
  };
  const relativeReduction = enough ? reduction(entries.map((_, i) => i)) : null;
  const interval = enough ? percentileInterval(bootstrapGroups(groups, reduction, resamples, seed)) : null;
  const reasons: string[] = [];
  if (!enough) reasons.push("Insufficient data.");
  if (grouping !== "participant") reasons.push(`Fewer than ${MIN_PARTICIPANTS_FOR_DECISION} participants.`);
  if (firRules === null || firModel === null || Math.abs(firModel - firRules) > FIR_TOLERANCE) {
    reasons.push("Held-out false-intervention rate is not within 1 point of the rules.");
  }
  if (relativeReduction === null || relativeReduction < MIN_RELATIVE_REDUCTION) {
    reasons.push("Missed-dangerous-approval rate does not drop by at least 20% relative.");
  }
  if (!interval || interval[0] <= 0) reasons.push("The bootstrap interval of the reduction does not exclude 0.");
  const adopt = reasons.length === 0;
  if (adopt) reasons.push("All pre-registered conditions hold.");

  return {
    label: opts.label ?? "dataset",
    synthetic: opts.synthetic ?? false,
    grouping,
    sizes,
    warnings,
    rules,
    models,
    decision: {
      model: candidate,
      adopt,
      firRules,
      firModel,
      mdarRules,
      mdarModel,
      relativeReduction,
      interval,
      reasons,
    },
    gbdt: {
      run: false,
      reason:
        participants >= MIN_PARTICIPANTS_FOR_GBDT
          ? "Gradient-boosted trees are compared offline (scikit-learn), not in this pipeline."
          : `Needs at least ${MIN_PARTICIPANTS_FOR_GBDT} participants (have ${participants}).`,
    },
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const fmt = (v: number | null | undefined, digits = 3) => (v === null || v === undefined || !Number.isFinite(v) ? "n/a" : v.toFixed(digits));
const pct = (r: Rate | null | undefined) => (!r || r.rate === null ? `n/a (n=${r?.n ?? 0})` : `${(r.rate * 100).toFixed(1)}% (n=${r.n})`);

export function reportMarkdown(r: EvaluationReport): string {
  const lines: string[] = [];
  lines.push(`# OverSight attention evaluation: ${r.label}`, "");
  if (r.synthetic) lines.push("> **SYNTHETIC FIXTURE. These numbers exercise the pipeline and are not results.**", "");
  lines.push(
    `Grouping: leave-one-${r.grouping}-out · ${r.sizes.entries} approvals · ${r.sizes.participants} participants · ${r.sizes.sessions} sessions · ${r.sizes.attentive} attentive / ${r.sizes.lowAttention} low-attention`,
    "",
    `Per condition: ${CONDITIONS.map((c) => `${c} ${r.sizes.byCondition[c]}`).join(", ")}`,
    "",
  );
  if (r.warnings.length) lines.push("## Warnings", "", ...r.warnings.map((w) => `- ${w}`), "");
  const insufficient = r.sizes.groups < MIN_GROUPS_FOR_METRICS;
  lines.push("## Discrimination and calibration (positive = LOW_ATTENTION)", "", "| Model | Features | PR-AUC | ROC-AUC | Brier |", "|---|---|---|---|---|");
  for (const m of [...r.rules, ...r.models]) {
    const d = m.discrimination;
    lines.push(
      insufficient || !d
        ? `| ${m.name} | ${m.features} | insufficient data | insufficient data | insufficient data |`
        : `| ${m.name} | ${m.features} | ${fmt(d.prAuc)} | ${fmt(d.rocAuc)} | ${fmt(d.brier)} |`,
    );
  }
  lines.push("", "## Policy replay", "", "| Policy | FIR (attentive redirected or paused) | MDAR (low-attention HIGH/CRITICAL let through) |", "|---|---|---|");
  const withPolicy = [r.rules[0], ...r.models].filter((m) => m.policy);
  if (insufficient || !withPolicy.length) lines.push("| all | insufficient data | insufficient data |");
  for (const m of insufficient ? [] : withPolicy) {
    const name = m.id === "rules-score" ? "Rules only (deterministic policy)" : `Rules + ${m.name}`;
    lines.push(`| ${name} | ${pct(m.policy!.fir)} | ${pct(m.policy!.mdar)} |`);
  }
  if (!insufficient && r.rules[0].policy) {
    lines.push("", "Per condition (rules):", "");
    for (const c of CONDITIONS) {
      const x = r.rules[0].policy.byCondition[c];
      lines.push(`- ${c}: n=${x.n}, FIR ${pct(x.fir)}, MDAR ${pct(x.mdar)}`);
    }
  }
  const d = r.decision;
  lines.push(
    "",
    "## Pre-registered decision rule",
    "",
    `Candidate: ${d.model}. FIR rules ${fmt(d.firRules)} vs model ${fmt(d.firModel)}; MDAR rules ${fmt(d.mdarRules)} vs model ${fmt(d.mdarModel)}; relative reduction ${fmt(d.relativeReduction)} (95% CI ${d.interval ? `${fmt(d.interval[0])} to ${fmt(d.interval[1])}` : "n/a"}).`,
    "",
    `**Decision: ${d.adopt ? "adopt the advisory model" : "ship rules only"}.**`,
    "",
    ...d.reasons.map((x) => `- ${x}`),
    "",
    `Gradient-boosted trees: not run. ${r.gbdt.reason}`,
    "",
  );
  return lines.join("\n");
}
