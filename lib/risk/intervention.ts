/**
 * InterventionEngine: the deterministic safety layer that decides when
 * friction is warranted. Intervention depends on
 *
 *   risk severity  x  attention evidence  x  critical-region coverage  x  behavioral anomaly
 *
 * fused by how far this review's gaze can be trusted, and becomes more
 * sensitive when the session shows a repeated low-attention approval
 * pattern. The optional ML classifier may raise sensitivity, never lower it
 * below these rules.
 */
import type { RiskLevel } from "@/types/approval";
import { RISK_ORDER } from "@/types/approval";
import type {
  AttentionAssessment,
  InterventionDecision,
  InterventionLevel,
  Reason,
  SessionPattern,
} from "@/types/attention";
import { INTERVENTION_ORDER } from "@/types/attention";
import { ATTENTION_CONFIG } from "@/lib/attention/config";

/** Base thresholds at sensitivity 1.0. "value < threshold" means intervene. */
export const THRESHOLDS = {
  gaze: {
    CRITICAL: { pauseCoverage: 0.25, refocusCoverage: 0.6, refocusScore: 0.45, nudgeScore: 0.6 },
    HIGH: {
      pauseCoverage: 0.15,
      pauseScore: 0.35,
      pauseAnomaly: 0.5,
      refocusCoverage: 0.45,
      refocusScore: 0.4,
      nudgeScore: 0.55,
    },
    MEDIUM: {
      refocusCoverage: 0.1,
      refocusScore: 0.35,
      refocusAnomaly: 0.5,
      nudgeScore: 0.5,
      nudgeCoverage: 0.3,
    },
    LOW: { nudgeScore: 0.35 },
  },
  behavioral: {
    CRITICAL: { pauseLatency: 0.5, pauseAnomaly: 0.6, refocusLatency: 0.9 },
    HIGH: { refocusLatency: 0.4, refocusAnomaly: 0.6, nudgeScore: 0.55 },
    MEDIUM: { nudgeLatency: 0.35 },
    LOW: { nudgeLatency: 0.2 },
  },
} as const;

/** Advisory influence of an activated behavioral model (see ATTENTION_CONFIG.ml). */
export interface MlInfluence {
  /** Calibrated P(LOW_ATTENTION). */
  probability: number;
  tauSens: number;
  tauVerify: number;
}

export interface DecisionContext {
  risk: RiskLevel;
  /** Session pattern including the current attempt. */
  pattern: SessionPattern;
  /** Advisory model influence, when an activated model is loaded. */
  ml?: MlInfluence | null;
  /** Shorthand for `ml` with the default thresholds from ATTENTION_CONFIG.ml. */
  mlProbability?: number | null;
}

function mlOf(ctx: DecisionContext): MlInfluence | null {
  if (ctx.ml) return ctx.ml;
  if (ctx.mlProbability == null) return null;
  return { probability: ctx.mlProbability, ...ATTENTION_CONFIG.ml };
}

/** 1 + pattern gains + a bounded ML gain that grows linearly above tauSens; capped. */
export function computeSensitivity(
  pattern: SessionPattern,
  mlProbability?: number | null,
  tauSens: number = ATTENTION_CONFIG.ml.tauSens,
): number {
  const s = ATTENTION_CONFIG.sensitivity;
  const ml =
    mlProbability != null && mlProbability > tauSens
      ? s.mlGain * Math.min(1, (mlProbability - tauSens) / Math.max(1e-9, 1 - tauSens))
      : 0;
  return Math.min(
    s.max,
    1 + s.fatigueGain * pattern.fatigueScore + s.streakGain * Math.max(0, pattern.rapidStreak - 1) + ml,
  );
}

const TONE_ORDER: Record<Reason["tone"], number> = { critical: 0, warning: 1, info: 2, positive: 3 };

export const maxLevel = (a: InterventionLevel, b: InterventionLevel): InterventionLevel =>
  INTERVENTION_ORDER[a] >= INTERVENTION_ORDER[b] ? a : b;
export const minLevel = (a: InterventionLevel, b: InterventionLevel): InterventionLevel =>
  INTERVENTION_ORDER[a] <= INTERVENTION_ORDER[b] ? a : b;

interface Scaled {
  up: (t: number) => number;
  down: (t: number) => number;
  thresholds: Record<string, number>;
}

/** The level gaze evidence requires (the pre-V2 gaze-mode rules, unchanged). */
function gazeLevelFor(a: AttentionAssessment, ctx: DecisionContext, cov: number, s: Scaled): InterventionLevel {
  const { up, down, thresholds } = s;
  switch (ctx.risk) {
    case "CRITICAL": {
      const t = THRESHOLDS.gaze.CRITICAL;
      thresholds.pauseCoverage = up(t.pauseCoverage);
      thresholds.refocusCoverage = up(t.refocusCoverage);
      if (cov < up(t.pauseCoverage)) return "PAUSE";
      if (cov < up(t.refocusCoverage) || a.attentionScore < up(t.refocusScore)) return "REFOCUS";
      if (a.attentionScore < up(t.nudgeScore)) return "NUDGE";
      return "NORMAL";
    }
    case "HIGH": {
      const t = THRESHOLDS.gaze.HIGH;
      thresholds.pauseCoverage = up(t.pauseCoverage);
      thresholds.refocusCoverage = up(t.refocusCoverage);
      if (cov < up(t.pauseCoverage) && (a.anomaly >= down(t.pauseAnomaly) || a.attentionScore < up(t.pauseScore)))
        return "PAUSE";
      if (cov < up(t.refocusCoverage) || a.attentionScore < up(t.refocusScore)) return "REFOCUS";
      if (a.attentionScore < up(t.nudgeScore)) return "NUDGE";
      return "NORMAL";
    }
    case "MEDIUM": {
      const t = THRESHOLDS.gaze.MEDIUM;
      thresholds.refocusCoverage = up(t.refocusCoverage);
      if (cov < up(t.refocusCoverage) && a.attentionScore < up(t.refocusScore) && a.anomaly >= down(t.refocusAnomaly))
        return "REFOCUS";
      if (a.attentionScore < up(t.nudgeScore) || cov < up(t.nudgeCoverage)) return "NUDGE";
      return "NORMAL";
    }
    default:
      return ctx.pattern.detected && a.attentionScore < up(THRESHOLDS.gaze.LOW.nudgeScore) ? "NUDGE" : "NORMAL";
  }
}

/** The level interaction evidence alone requires (the pre-V2 behavioral-mode rules, unchanged). */
function behavioralLevelFor(
  a: AttentionAssessment,
  ctx: DecisionContext,
  allNeverVisible: boolean,
  s: Scaled,
): InterventionLevel {
  const { up, down, thresholds } = s;
  // Nothing to judge attention against: bring the consequence into view first.
  if (allNeverVisible && RISK_ORDER[ctx.risk] >= RISK_ORDER.HIGH) return "REFOCUS";
  switch (ctx.risk) {
    case "CRITICAL": {
      const t = THRESHOLDS.behavioral.CRITICAL;
      thresholds.pauseLatency = up(t.pauseLatency);
      if (a.latencyRatio < up(t.pauseLatency) || a.anomaly >= down(t.pauseAnomaly)) return "PAUSE";
      if (a.latencyRatio < up(t.refocusLatency)) return "REFOCUS";
      return "NUDGE";
    }
    case "HIGH": {
      const t = THRESHOLDS.behavioral.HIGH;
      thresholds.refocusLatency = up(t.refocusLatency);
      if (a.latencyRatio < up(t.refocusLatency) || a.anomaly >= down(t.refocusAnomaly)) return "REFOCUS";
      if (a.behavioralScore < up(t.nudgeScore)) return "NUDGE";
      return "NORMAL";
    }
    case "MEDIUM":
      return a.latencyRatio < up(THRESHOLDS.behavioral.MEDIUM.nudgeLatency) ? "NUDGE" : "NORMAL";
    default:
      return ctx.pattern.detected && a.latencyRatio < up(THRESHOLDS.behavioral.LOW.nudgeLatency) ? "NUDGE" : "NORMAL";
  }
}

/**
 * Evidence fusion by gaze trust:
 *
 *   high          gaze level (the pre-V2 gaze-mode decision)
 *   medium        max(min(gaze level, REFOCUS), behavioral level)
 *   low / none    behavioral level
 *
 * Below high trust gaze may ask for a refocus but never produces a pause on
 * its own, and the behavioral level is a floor: uncertainty changes the form
 * of an intervention, it never turns a required one into NORMAL.
 */
export function decideIntervention(a: AttentionAssessment, ctx: DecisionContext): InterventionDecision {
  const ml = mlOf(ctx);
  const sens = computeSensitivity(ctx.pattern, ml?.probability, ml?.tauSens);
  // Higher sensitivity raises "below X" thresholds and lowers "above X" thresholds.
  const scaled: Scaled = {
    up: (t: number) => Math.min(0.95, t * sens),
    down: (t: number) => t / sens,
    thresholds: { sensitivity: sens },
  };
  const risk = ctx.risk;
  const trustLevel = a.trust.level;
  const allNeverVisible = a.targetCoverage.length > 0 && a.targetsNeverVisible === a.targetCoverage.length;

  const gazeLevel =
    a.mode === "gaze" && a.criticalCoverage !== null ? gazeLevelFor(a, ctx, a.criticalCoverage, scaled) : null;
  const behavioralLevel = behavioralLevelFor(a, ctx, allNeverVisible, scaled);

  let level: InterventionLevel;
  if (gazeLevel === null) level = behavioralLevel;
  else if (trustLevel === "high") level = gazeLevel;
  else if (trustLevel === "medium") level = maxLevel(minLevel(gazeLevel, "REFOCUS"), behavioralLevel);
  else level = behavioralLevel;

  // Any high-risk target that never reached the screen needs at least a refocus.
  if (a.targetsNeverVisible > 0 && RISK_ORDER[risk] >= RISK_ORDER.HIGH) level = maxLevel(level, "REFOCUS");

  // Advisory ML: raises concern, never lowers it, never pauses on its own.
  let mlEscalated = false;
  if (ml) {
    const rulesOnly = decideIntervention(a, { risk: ctx.risk, pattern: ctx.pattern }).level;
    if (
      trustLevel !== "high" &&
      RISK_ORDER[risk] >= RISK_ORDER.MEDIUM &&
      ml.probability >= ml.tauVerify &&
      INTERVENTION_ORDER[level] < INTERVENTION_ORDER.REFOCUS
    ) {
      level = "REFOCUS";
      mlEscalated = INTERVENTION_ORDER[rulesOnly] < INTERVENTION_ORDER.REFOCUS;
    }
    level = maxLevel(level, rulesOnly);
    if (INTERVENTION_ORDER[rulesOnly] < INTERVENTION_ORDER.REFOCUS) level = minLevel(level, "REFOCUS");
  }

  const intervening = INTERVENTION_ORDER[level] >= INTERVENTION_ORDER.REFOCUS;
  const gazeVerifiable = (trustLevel === "high" || trustLevel === "medium") && !mlEscalated;

  const reasons: Reason[] = [...a.reasons];
  if (ctx.pattern.detected) {
    reasons.push({ code: "pattern", text: ctx.pattern.message, tone: "warning" });
  }
  if (sens > 1.05 && ctx.pattern.rapidStreak >= 2) {
    reasons.push({
      code: "streak",
      text: `${ctx.pattern.rapidStreak} consecutive rapid approvals; intervention sensitivity raised to ${sens.toFixed(2)}×.`,
      tone: "warning",
    });
  } else if (sens > 1.05) {
    reasons.push({
      code: "sensitivity",
      text: `Intervention sensitivity raised to ${sens.toFixed(2)}× by the recent approval pattern.`,
      tone: "info",
    });
  }
  if (ml && ml.probability > ml.tauSens) {
    reasons.push({
      code: "ml",
      text: mlEscalated
        ? `The advisory behavioral model rates this review as likely low-attention (${Math.round(ml.probability * 100)}%) while gaze evidence is limited, so the consequence is confirmed manually.`
        : `The advisory behavioral model rates this review as likely low-attention (${Math.round(ml.probability * 100)}%); intervention sensitivity raised.`,
      tone: "info",
    });
  }
  if (intervening && trustLevel !== "high") {
    reasons.push({
      code: "confirm",
      text: gazeVerifiable
        ? "Gaze evidence is limited for this review, so confirm the consequence before approving."
        : "Without usable gaze evidence, confirm the consequence before approving.",
      tone: "info",
    });
  }

  // Interventions lead with the problem; clean passes lead with the evidence.
  const rank = (r: Reason) => (!intervening && r.tone === "positive" ? -1 : TONE_ORDER[r.tone]);
  reasons.sort((x, y) => rank(x) - rank(y));

  return {
    level,
    gazeLevel,
    behavioralLevel,
    trustLevel,
    verification: intervening ? (gazeVerifiable ? "gaze" : "manual") : "none",
    sensitivity: sens,
    headline: headlineFor(level, risk, a, allNeverVisible),
    reasons,
    thresholds: scaled.thresholds,
  };
}

function headlineFor(
  level: InterventionLevel,
  risk: RiskLevel,
  a: AttentionAssessment,
  neverVisible: boolean,
): string {
  const critical = RISK_ORDER[risk] >= RISK_ORDER.HIGH;
  switch (level) {
    case "PAUSE":
      return "Approval paused";
    case "REFOCUS":
      return neverVisible ? "Critical consequence not yet on screen" : "Review critical consequence";
    case "NUDGE":
      return risk === "LOW"
        ? "Approved. Review attention is declining"
        : "One high-impact consequence deserves review";
    default:
      if (a.mode === "behavioral") return "Approved";
      return critical ? "Critical consequence reviewed" : "Key detail reviewed";
  }
}
