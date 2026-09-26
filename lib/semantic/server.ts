import type { ApprovalRequest } from "@/types/approval";
import type { AnalyzerProviderInfo, SemanticAnalysis } from "@/types/semantic";
import { mergeAiAnalysis } from "./analyzer";
import { getAiConfig, requestAiAnalysis } from "./ai-provider";
import { analyzeWithRules } from "./rules";

export function describeProvider(): AnalyzerProviderInfo {
  const config = getAiConfig();
  return config ? { kind: "ai", model: config.model } : { kind: "rules" };
}

/**
 * Rules always run. If an AI provider is configured, its analysis is merged
 * on top (see mergeAiAnalysis). Any AI failure falls back to rules, so the
 * demo never depends on the network.
 */
export async function analyzeOnServer(request: ApprovalRequest): Promise<SemanticAnalysis> {
  const config = getAiConfig();
  if (!config) return analyzeWithRules(request);
  try {
    const ai = await requestAiAnalysis(request, config);
    return mergeAiAnalysis(request, ai, config.model);
  } catch (error) {
    const fallback = analyzeWithRules(request);
    fallback.provider = {
      kind: "rules",
      fallbackReason: `AI provider unavailable (${error instanceof Error ? error.message : "unknown error"}); deterministic rules used.`,
    };
    return fallback;
  }
}
