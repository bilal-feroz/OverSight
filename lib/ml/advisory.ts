/**
 * Training the advisory model (layer 2) the only way it can be activated:
 * through the grouped evaluation of docs/EVALUATION.md.
 *
 * The final model is logistic regression on the full named feature set
 * (current review + temporal + personal baseline), fitted on all rows. Its
 * Platt calibration comes from grouped out-of-fold predictions and its
 * verification threshold from the same operating-point rule the evaluation
 * used. The evaluation's outcome is stored with the model; the activation
 * gate (activationStatus) reads it. No neural networks, no RNNs.
 */
import type { InterventionLevel } from "@/types/attention";
import { ATTENTION_CONFIG } from "@/lib/attention/config";
import { POLICY_VERSION } from "@/lib/version";
import type { DatasetEntry } from "./dataset";
import {
  FIR_TOLERANCE,
  MIN_PARTICIPANTS_FOR_DECISION,
  TAU_GRID,
  evaluateDataset,
  falseInterventionRate,
  fitLR,
  predictLR,
  type EvaluationOptions,
  type EvaluationReport,
} from "./evaluate";
import { FEATURE_NAMES, FEATURE_SCHEMA_VERSION } from "./features";
import {
  activationStatus,
  applyPlatt,
  fitPlatt,
  leaveOneGroupOut,
  trainNamedClassifier,
  type ActivationStatus,
  type AttentionClassifier,
} from "./logistic";
import { replayDecision } from "./replay";

export interface AdvisoryTraining {
  report: EvaluationReport;
  model: AttentionClassifier | null;
  status: ActivationStatus;
}

export function trainAdvisoryModel(entries: readonly DatasetEntry[], opts: EvaluationOptions = {}): AdvisoryTraining {
  const lambda = opts.lambda ?? 1;
  const report = evaluateDataset(entries, opts);
  const rows = entries.filter((e) => e.features.schemaVersion === FEATURE_SCHEMA_VERSION);
  const labels = rows.map((e) => (e.label === "LOW_ATTENTION" ? 1 : 0));
  if (new Set(labels).size < 2 || rows.length < 4) {
    return { report, model: null, status: { active: false, reason: "Need reviews with both labels to train." } };
  }

  // Grouped out-of-fold probabilities (uncalibrated) for Platt and the operating point.
  const participants = new Set(rows.map((e) => e.participant)).size;
  const groups = rows.map((e) => (participants >= MIN_PARTICIPANTS_FOR_DECISION ? e.participant : e.sessionId));
  const oof = new Array<number>(rows.length).fill(0.5);
  for (const fold of leaveOneGroupOut(groups)) {
    const y = fold.train.map((i) => labels[i]);
    if (new Set(y).size < 2) continue;
    const m = fitLR(fold.train.map((i) => rows[i].features.values), y, FEATURE_NAMES, lambda);
    for (const i of fold.test) oof[i] = predictLR(m, rows[i].features.values);
  }
  const platt = fitPlatt(oof, labels);
  const calibrated = oof.map((p) => applyPlatt(platt, p));

  // The most sensitive verification threshold that keeps FIR within tolerance of the rules.
  const tauSens = ATTENTION_CONFIG.ml.tauSens;
  const rulesLevels: InterventionLevel[] = rows.map((e) => replayDecision(e).level);
  const firRules = falseInterventionRate(rulesLevels, labels).rate ?? 0;
  let tauVerify = Number.POSITIVE_INFINITY;
  for (const tau of TAU_GRID) {
    const levels = rows.map((e, i) => replayDecision(e, { probability: calibrated[i], tauSens, tauVerify: tau }).level);
    if ((falseInterventionRate(levels, labels).rate ?? 0) - firRules <= FIR_TOLERANCE) {
      tauVerify = tau;
      break;
    }
  }

  const base = trainNamedClassifier(
    rows.map((e) => ({ values: e.features.values, label: e.label })),
    FEATURE_NAMES,
    lambda,
    FEATURE_SCHEMA_VERSION,
  );
  const candidate = report.models.find((m) => m.id === report.decision.model);
  const model: AttentionClassifier = {
    ...base,
    // Row-level cross-validation is optimistic; only grouped metrics are kept.
    metrics: null,
    metadata: {
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      policyVersion: POLICY_VERSION,
      grouping: report.grouping,
      participants: report.sizes.participants,
      sessions: report.sizes.sessions,
      rows: report.sizes.entries,
      metrics: candidate?.discrimination ?? null,
      decision: {
        adopt: report.decision.adopt,
        reasons: report.decision.reasons,
        firRules: report.decision.firRules,
        firModel: report.decision.firModel,
        mdarRules: report.decision.mdarRules,
        mdarModel: report.decision.mdarModel,
        relativeReduction: report.decision.relativeReduction,
        interval: report.decision.interval,
      },
      platt,
      tauSens,
      tauVerify: Number.isFinite(tauVerify) ? tauVerify : 1.01,
    },
  };
  return { report, model, status: activationStatus(model) };
}
