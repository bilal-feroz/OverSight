/**
 * Approval requests as proposed by an AI agent.
 *
 * Every piece of content is a typed block with a stable id. The id is what
 * the semantic analyzer points at ("impact-3 is decision-critical") and what
 * the UI renders as `data-attention-region="impact-3"`, so gaze can be
 * evaluated against the exact DOM element that shows that information.
 */

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export const RISK_ORDER: Record<RiskLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

export type BlockKind =
  | "title"
  | "summary"
  | "reasoning"
  | "resource"
  | "change"
  | "consequence"
  | "metadata"
  | "detail";

export interface ContentBlock {
  /** Stable field id, unique within a request. */
  id: string;
  kind: BlockKind;
  /** Plain-text content exactly as rendered. */
  text: string;
  /** Optional label, e.g. the setting name for a change row. */
  label?: string;
  /** Previous value for change rows. */
  from?: string;
  /** New value for change rows. */
  to?: string;
}

export interface ApprovalRequest {
  id: string;
  agent: {
    name: string;
    handle: string;
  };
  /** Machine-readable action, e.g. `db.config.deploy`. */
  actionType: string;
  /** Target environment label, e.g. `production`. */
  environment: string;
  title: string;
  summary: string;
  /** Section content. Title and summary are rendered separately. */
  blocks: ContentBlock[];
  /** Human-readable request age for display. */
  requestedAgo: string;
  /** Change ticket / reference id. */
  reference?: string;
  source: "seeded" | "custom";
}

/** Expected analyzer output, used as a test oracle for seeded scenarios. */
export interface ScenarioExpectation {
  risk: RiskLevel;
  /** Field ids the analyzer must select as attention targets. */
  targetIds: string[];
  /** Optional exact plain-language statement for the primary target. */
  statement?: string;
}

export interface ApprovalScenario extends ApprovalRequest {
  source: "seeded";
  /** `routine` requests build the baseline; `trap` is the demo's high-risk request. */
  role: "routine" | "trap" | "extended";
  expected: ScenarioExpectation;
}
