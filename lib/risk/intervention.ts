/**
 * InterventionEngine: the deterministic safety layer that decides when
 * friction is warranted. Intervention depends on
 *
 *   risk severity  x  attention evidence  x  critical-region coverage  x  behavioral anomaly
 *
 * and becomes more sensitive when the session shows a repeated low-attention
 * approval pattern. The optional ML classifier may raise sensitivity, never
 * lower it below these rules.
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

export interface DecisionContext {
  risk: RiskLevel;
  /** Session pattern including the current attempt. */
  pattern: SessionPattern;
  /** P(LOW_ATTENTION) from a validated behavioral classifier, if one is loaded. */
  mlProbability?: number | null;
}

export function computeSensitivity(pattern: SessionPattern, mlProbability?: number | null): number {
  const s = ATTENTION_CONFIG.sensitivity;
  const ml = mlProbability != null && mlProbability >= 0.75 ? s.mlGain : 0;
  return Math.min(
    s.max,
    1 + s.fatigueGain * pattern.fatigueScore + s.streakGain * Math.max(0, pattern.rapidStreak - 1) + ml,
  );
}

const TONE_ORDER: Record<Reason["tone"], number> = { critical: 0, warning: 1, info: 2, positive: 3 };

export function decideIntervention(a: AttentionAssessment, ctx: DecisionContext): InterventionDecision {
  const sens = computeSensitivity(ctx.pattern, ctx.mlProbability);
  // Higher sensitivity raises "below X" thresholds and lowers "above X" thresholds.
  const up = (t: number) => Math.min(0.95, t * sens);
  const down = (t: number) => t / sens;
  const risk = ctx.risk;
  const thresholds: Record<string, number> = { sensitivity: sens };

  let level: InterventionLevel = "NORMAL";
  const cov = a.criticalCoverage;
  const allNeverVisible = a.targetCoverage.length > 0 && a.targetsNeverVisible === a.targetCoverage.length;

  if (a.mode === "gaze" && cov !== null) {
    if (risk === "CRITICAL") {
      const t = THRESHOLDS.gaze.CRITICAL;
      thresholds.pauseCoverage = up(t.pauseCoverage);
      thresholds.refocusCoverage = up(t.refocusCoverage);
      if (cov < up(t.pauseCoverage)) level = "PAUSE";
      else if (cov < up(t.refocusCoverage) || a.attentionScore < up(t.refocusScore)) level = "REFOCUS";
      else if (a.attentionScore < up(t.nudgeScore)) level = "NUDGE";
    } else if (risk === "HIGH") {
      const t = THRESHOLDS.gaze.HIGH;
      thresholds.pauseCoverage = up(t.pauseCoverage);
      thresholds.refocusCoverage = up(t.refocusCoverage);
      if (cov < up(t.pauseCoverage) && (a.anomaly >= down(t.pauseAnomaly) || a.attentionScore < up(t.pauseScore)))
        level = "PAUSE";
      else if (cov < up(t.refocusCoverage) || a.attentionScore < up(t.refocusScore)) level = "REFOCUS";
      else if (a.attentionScore < up(t.nudgeScore)) level = "NUDGE";
    } else if (risk === "MEDIUM") {
      const t = THRESHOLDS.gaze.MEDIUM;
      thresholds.refocusCoverage = up(t.refocusCoverage);
      if (
        cov < up(t.refocusCoverage) &&
        a.attentionScore < up(t.refocusScore) &&
        a.anomaly >= down(t.refocusAnomaly)
      )
        level = "REFOCUS";
      else if (a.attentionScore < up(t.nudgeScore) || cov < up(t.nudgeCoverage)) level = "NUDGE";
    } else {
      const t = THRESHOLDS.gaze.LOW;
      if (ctx.pattern.detected && a.attentionScore < up(t.nudgeScore)) level = "NUDGE";
    }
  } else if (allNeverVisible && RISK_ORDER[risk] >= RISK_ORDER.HIGH) {
    // Nothing to judge gaze against: bring the consequence into view first.
    level = "REFOCUS";
  } else if (risk === "CRITICAL") {
    const t = THRESHOLDS.behavioral.CRITICAL;
    thresholds.pauseLatency = up(t.pauseLatency);
    if (a.latencyRatio < up(t.pauseLatency) || a.anomaly >= down(t.pauseAnomaly)) level = "PAUSE";
    else if (a.latencyRatio < up(t.refocusLatency)) level = "REFOCUS";
    else level = "NUDGE";
  } else if (risk === "HIGH") {
    const t = THRESHOLDS.behavioral.HIGH;
    thresholds.refocusLatency = up(t.refocusLatency);
    if (a.latencyRatio < up(t.refocusLatency) || a.anomaly >= down(t.refocusAnomaly)) level = "REFOCUS";
    else if (a.attentionScore < up(t.nudgeScore)) level = "NUDGE";
  } else if (risk === "MEDIUM") {
    if (a.latencyRatio < up(THRESHOLDS.behavioral.MEDIUM.nudgeLatency)) level = "NUDGE";
  } else if (ctx.pattern.detected && a.latencyRatio < up(THRESHOLDS.behavioral.LOW.nudgeLatency)) {
    level = "NUDGE";
  }

  // Any high-risk target that never reached the screen needs at least a refocus.
  if (
    a.targetsNeverVisible > 0 &&
    RISK_ORDER[risk] >= RISK_ORDER.HIGH &&
    INTERVENTION_ORDER[level] < INTERVENTION_ORDER.REFOCUS
  ) {
    level = "REFOCUS";
  }

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
  if (ctx.mlProbability != null && ctx.mlProbability >= 0.75) {
    reasons.push({
      code: "ml",
      text: `Behavioral classifier (experimental) rates this review as likely low-attention (${Math.round(ctx.mlProbability * 100)}%).`,
      tone: "info",
    });
  }

  const intervening = INTERVENTION_ORDER[level] >= INTERVENTION_ORDER.REFOCUS;
  // Interventions lead with the problem; clean passes lead with the evidence.
  const rank = (r: Reason) => (!intervening && r.tone === "positive" ? -1 : TONE_ORDER[r.tone]);
  reasons.sort((x, y) => rank(x) - rank(y));

  return {
    level,
    verification: intervening ? (a.mode === "gaze" ? "gaze" : "manual") : "none",
    sensitivity: sens,
    headline: headlineFor(level, risk, a, allNeverVisible),
    reasons,
    thresholds,
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
