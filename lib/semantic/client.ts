import type { ApprovalRequest } from "@/types/approval";
import type { AnalyzerProviderInfo, SemanticAnalysis } from "@/types/semantic";
import { analyzeWithRules } from "./rules";

/**
 * Asks the server analyzer (rules, plus AI when configured). If the API is
 * unreachable the same deterministic rules run in the browser instead.
 */
export async function analyzeRequest(request: ApprovalRequest, signal?: AbortSignal): Promise<SemanticAnalysis> {
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request }),
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { analysis?: SemanticAnalysis };
    if (!data.analysis || !Array.isArray(data.analysis.criticalRegions)) throw new Error("Malformed analysis");
    return data.analysis;
  } catch (error) {
    if (signal?.aborted) throw error;
    const local = analyzeWithRules(request);
    local.provider = {
      kind: "rules",
      fallbackReason: "Analysis API unreachable; deterministic rules ran in the browser.",
    };
    return local;
  }
}

export async function fetchProviderInfo(): Promise<AnalyzerProviderInfo> {
  try {
    const res = await fetch("/api/analyze", { cache: "no-store" });
    const data = (await res.json()) as { provider?: AnalyzerProviderInfo };
    return data.provider ?? { kind: "rules" };
  } catch {
    return { kind: "rules" };
  }
}
