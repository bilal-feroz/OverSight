import type { RiskLevel } from "@/types/approval";
import type { InterventionLevel } from "@/types/attention";

export const RISK_LABEL: Record<RiskLevel, string> = {
  LOW: "Low risk",
  MEDIUM: "Medium risk",
  HIGH: "High risk",
  CRITICAL: "Critical risk",
};

export const RISK_DESCRIPTION: Record<RiskLevel, string> = {
  LOW: "Routine, reversible operation",
  MEDIUM: "Notable impact; minimal intervention",
  HIGH: "High impact; intervene if critical content is missed",
  CRITICAL: "Irreversible or severe; explicit review if critical content is skipped",
};

export const INTERVENTION_LABEL: Record<InterventionLevel, string> = {
  NORMAL: "Normal",
  NUDGE: "Nudge",
  REFOCUS: "Refocus",
  PAUSE: "Pause",
};

export const INTERVENTION_DESCRIPTION: Record<InterventionLevel, string> = {
  NORMAL: "Level 0 · No interruption",
  NUDGE: "Level 1 · Subtle highlight, approval proceeds",
  REFOCUS: "Level 2 · Approval redirected to the critical consequence",
  PAUSE: "Level 3 · Approval paused until the consequence is re-reviewed",
};

export function isDecisionCritical(level: RiskLevel): boolean {
  return level === "HIGH" || level === "CRITICAL";
}
