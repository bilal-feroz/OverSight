/**
 * Semantic analyzer abstraction.
 *
 *   rules only           deterministic, always available (rules.ts)
 *   rules + AI provider  AI output merged onto the rules result
 *
 * Merge policy (the "deterministic floor"):
 *   - overall risk = max(rules, AI). AI can escalate, never de-escalate.
 *   - rules targets with severity >= HIGH always remain targets.
 *   - AI regions must reference real field ids; phrases must be exact
 *     substrings, otherwise the rules phrase is used.
 */
import { z } from "zod";
import type { ApprovalRequest, RiskLevel } from "@/types/approval";
import { RISK_ORDER } from "@/types/approval";
import type { RiskCategory, SemanticAnalysis } from "@/types/semantic";
import {
  allBlocks,
  assessBlocks,
  candidatesFromAssessments,
  cleanStatement,
  composeAnalysis,
  TARGET_KINDS,
  type RegionCandidate,
} from "./rules";

export interface SemanticAnalyzer {
  readonly name: string;
  analyze(request: ApprovalRequest): Promise<SemanticAnalysis>;
}

const RISK = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const AiOutputSchema = z.object({
  overallRisk: RISK,
  summary: z.string().max(600).optional(),
  rationale: z.string().max(1200).optional(),
  reversible: z.boolean().optional(),
  criticalRegions: z
    .array(
      z.object({
        fieldId: z.string().max(80),
        severity: RISK,
        reason: z.string().max(200),
        statement: z.string().max(300).optional(),
        phrase: z.string().max(600).optional(),
        category: z.string().max(60).optional(),
      }),
    )
    .max(8),
});

export type AiOutput = z.infer<typeof AiOutputSchema>;

const CATEGORIES: RiskCategory[] = [
  "data_destruction",
  "public_exposure",
  "financial_transfer",
  "fraud_indicator",
  "irreversible",
  "permission_escalation",
  "credential_change",
  "security_control",
  "service_disruption",
  "sensitive_data_sharing",
  "compliance",
  "external_communication",
  "schema_change",
  "routine_effect",
];

function asCategory(value: string | undefined, fallback: RiskCategory): RiskCategory {
  return value && (CATEGORIES as string[]).includes(value) ? (value as RiskCategory) : fallback;
}

export function mergeAiAnalysis(
  request: ApprovalRequest,
  ai: AiOutput,
  model: string,
): SemanticAnalysis {
  const assessments = assessBlocks(request);
  const ruleCandidates = candidatesFromAssessments(assessments);
  const blocks = allBlocks(request);
  const byId = new Map(blocks.map((b, order) => [b.id, { block: b, order }]));

  const aiCandidates: RegionCandidate[] = [];
  for (const region of ai.criticalRegions) {
    const entry = byId.get(region.fieldId);
    if (!entry || !TARGET_KINDS.includes(entry.block.kind)) continue;
    const ruleForBlock = ruleCandidates
      .filter((c) => c.block.id === region.fieldId)
      .sort((a, b) => RISK_ORDER[b.severity] - RISK_ORDER[a.severity])[0];
    const phrase =
      region.phrase && entry.block.text.includes(region.phrase)
        ? region.phrase
        : (ruleForBlock?.phrase ?? entry.block.text);
    const statement =
      region.statement && region.statement.length <= 200
        ? cleanStatement(region.statement)
        : (ruleForBlock?.statement ?? cleanStatement(entry.block.text));
    aiCandidates.push({
      block: entry.block,
      order: entry.order,
      severity: region.severity,
      category: asCategory(region.category, ruleForBlock?.category ?? "routine_effect"),
      reason: region.reason.trim().toLowerCase(),
      phrase,
      statement,
      strength: (ruleForBlock?.strength ?? 0) + 1,
      source: "ai",
    });
  }

  // AI candidates listed first so equal-severity ties prefer the AI wording;
  // selection still ranks by severity, kind and strength.
  const merged = composeAnalysis(request, [...aiCandidates, ...ruleCandidates], {
    overallFloor: ai.overallRisk,
    provider: { kind: "ai", model },
    extraRationale: ai.rationale?.trim() || undefined,
  });

  // Deterministic floor: high-severity rule targets can never be dropped.
  const rulesOnly = composeAnalysis(request, ruleCandidates, { provider: { kind: "rules" } });
  for (const target of rulesOnly.criticalRegions) {
    if (RISK_ORDER[target.severity] < RISK_ORDER.HIGH) continue;
    if (!merged.criticalRegions.some((r) => r.fieldId === target.fieldId)) {
      merged.criticalRegions.push(target);
      merged.notableRegions = merged.notableRegions.filter((r) => r.fieldId !== target.fieldId);
    }
  }
  merged.overallRisk = maxRisk(merged.overallRisk, rulesOnly.overallRisk);
  if (ai.summary?.trim()) merged.summary = ai.summary.trim();
  return merged;
}

export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

export const AI_SYSTEM_PROMPT = `You are the semantic risk analyzer inside OverSight, a safety layer for human approval of AI-agent actions.
You receive an approval request split into content blocks, each with an id.
Identify which blocks contain consequences that materially affect whether a careful human should approve.

Return ONLY a JSON object:
{
  "overallRisk": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "summary": "one sentence describing the action",
  "rationale": "one or two sentences explaining the risk",
  "reversible": true | false,
  "criticalRegions": [
    {
      "fieldId": "<id of a block>",
      "severity": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
      "category": "data_destruction | public_exposure | financial_transfer | fraud_indicator | irreversible | permission_escalation | credential_change | security_control | service_disruption | sensitive_data_sharing | compliance | external_communication | schema_change | routine_effect",
      "reason": "short reason, e.g. irreversible data deletion",
      "statement": "plain-language consequence, max 20 words, e.g. 2,431 customer records will be permanently deleted.",
      "phrase": "exact substring of that block's text carrying the consequence"
    }
  ]
}

Rules:
- fieldId must be one of the provided block ids. Never select "title" or "summary".
- Prefer the block that states the consequence in plain language over a raw setting.
- Select at most 3 regions, most severe first. Routine requests still get one LOW region: their key detail.
- CRITICAL: irreversible harm (permanent data loss, public exposure of databases, unverified large payments, sensitive personal data leaving the organization).
- Do not speculate beyond the text.`;
