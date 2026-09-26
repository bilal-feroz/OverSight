import type { ApprovalRequest, ContentBlock } from "@/types/approval";
import type { Baseline } from "@/types/attention";
import type { CriticalRegion, SemanticAnalysis } from "@/types/semantic";
import { wordCount } from "@/lib/utils";
import { allBlocks, cleanStatement } from "@/lib/semantic/rules";
import { requiredDwellMs } from "./regions";
import type { ReviewTarget } from "./tracker";

export function blockLabel(block: ContentBlock): string {
  switch (block.kind) {
    case "consequence":
      return "Consequence";
    case "change":
      return block.label ? `Change · ${block.label}` : "Change";
    case "resource":
      return "Affected resource";
    case "reasoning":
      return "Agent reasoning";
    case "detail":
      return "Request detail";
    case "title":
      return "Title";
    case "summary":
      return "Summary";
    default:
      return "Metadata";
  }
}

export function findBlock(request: ApprovalRequest, id: string): ContentBlock | undefined {
  return allBlocks(request).find((b) => b.id === id);
}

export function targetBlocks(
  request: ApprovalRequest,
  analysis: SemanticAnalysis,
): Array<{ region: CriticalRegion; block: ContentBlock }> {
  return analysis.criticalRegions
    .map((region) => ({ region, block: findBlock(request, region.fieldId) }))
    .filter((t): t is { region: CriticalRegion; block: ContentBlock } => Boolean(t.block));
}

/**
 * The region a re-review is about. Normally one of the analysis targets; if
 * none exists, a region is synthesized from the request summary so an
 * intervention can never end up with nothing to acknowledge.
 */
export function focusRegionFor(
  request: ApprovalRequest,
  analysis: SemanticAnalysis,
  fieldId: string | null,
): CriticalRegion {
  const known =
    analysis.criticalRegions.find((r) => r.fieldId === fieldId) ??
    analysis.notableRegions.find((r) => r.fieldId === fieldId) ??
    (fieldId === null ? analysis.criticalRegions[0] : undefined);
  if (known) return known;
  const block = (fieldId ? findBlock(request, fieldId) : undefined) ?? {
    id: "summary",
    kind: "summary" as const,
    text: request.summary || request.title,
  };
  return {
    fieldId: block.id,
    severity: analysis.overallRisk,
    category: "routine_effect",
    reason: analysis.riskReasons[0] ?? "high-impact action",
    phrase: block.text,
    statement: cleanStatement(block.text),
    source: "rules",
  };
}

/** Decision-relevant words: title + summary + attention targets. */
export function expectedWordsFor(request: ApprovalRequest, analysis: SemanticAnalysis): number {
  return (
    wordCount(request.title) +
    wordCount(request.summary) +
    targetBlocks(request, analysis).reduce((acc, t) => acc + wordCount(t.block.text), 0)
  );
}

export function buildReviewTargets(
  request: ApprovalRequest,
  analysis: SemanticAnalysis,
  baseline: Baseline,
): ReviewTarget[] {
  return targetBlocks(request, analysis).map(({ region, block }) => {
    const words = wordCount(block.text);
    return {
      id: region.fieldId,
      label: blockLabel(block),
      severity: region.severity,
      words,
      requiredDwellMs: requiredDwellMs(words, baseline),
    };
  });
}
