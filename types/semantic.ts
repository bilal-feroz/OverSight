import type { RiskLevel } from "./approval";

export type RiskCategory =
  | "data_destruction"
  | "public_exposure"
  | "financial_transfer"
  | "fraud_indicator"
  | "irreversible"
  | "permission_escalation"
  | "credential_change"
  | "security_control"
  | "service_disruption"
  | "sensitive_data_sharing"
  | "compliance"
  | "external_communication"
  | "schema_change"
  | "routine_effect";

/**
 * A content block that materially affects the approval decision.
 *
 * `severity` HIGH/CRITICAL => "decision-critical consequence".
 * `severity` LOW/MEDIUM   => "key detail" of a routine request.
 */
export interface CriticalRegion {
  fieldId: string;
  severity: RiskLevel;
  category: RiskCategory;
  /** Short machine-ish reason, e.g. "irreversible data deletion". */
  reason: string;
  /** Exact substring of the block text that carries the consequence. */
  phrase: string;
  /** Plain-language restatement shown when the region is isolated. */
  statement: string;
  source: "rules" | "ai";
}

export interface AnalyzerProviderInfo {
  kind: "rules" | "ai";
  /** Model name when an AI provider produced (part of) the analysis. */
  model?: string;
  /** Present when AI was configured but the deterministic engine was used instead. */
  fallbackReason?: string;
}

export interface SemanticAnalysis {
  requestId: string;
  summary: string;
  overallRisk: RiskLevel;
  riskReasons: string[];
  /**
   * Attention targets: the regions the attention engine evaluates gaze
   * against. Deliberately few (<= 2) so users are never asked to stare at
   * everything.
   */
  criticalRegions: CriticalRegion[];
  /** Other flagged content, displayed but not enforced. */
  notableRegions: CriticalRegion[];
  consequences: string[];
  reversible: boolean;
  rationale: string;
  provider: AnalyzerProviderInfo;
  analyzedAt: number;
}
