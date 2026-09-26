/**
 * OpenAI-compatible chat-completions provider (server-side only; the API key
 * never reaches the browser). Works with OpenAI and any compatible endpoint
 * (Azure OpenAI proxies, vLLM, Ollama, LM Studio, OpenRouter, ...).
 *
 * Only the approval request TEXT is sent. Camera data never exists on the
 * server, so it cannot be sent.
 */
import type { ApprovalRequest } from "@/types/approval";
import { allBlocks } from "./rules";
import { AI_SYSTEM_PROMPT, AiOutputSchema, type AiOutput } from "./analyzer";

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export function getAiConfig(env: Record<string, string | undefined> = process.env): AiConfig | null {
  const apiKey = env.OVERSIGHT_AI_API_KEY || env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseUrl = (env.OVERSIGHT_AI_BASE_URL || env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  return {
    baseUrl,
    apiKey,
    model: env.OVERSIGHT_AI_MODEL || "gpt-4o-mini",
    timeoutMs: Number(env.OVERSIGHT_AI_TIMEOUT_MS) || 12000,
  };
}

function extractJson(content: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(content);
  if (fenced) return fenced[1];
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  return start >= 0 && end > start ? content.slice(start, end + 1) : content;
}

async function callChat(config: AiConfig, body: Record<string, unknown>, signal: AbortSignal) {
  return fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });
}

export async function requestAiAnalysis(request: ApprovalRequest, config: AiConfig): Promise<AiOutput> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const messages = [
    { role: "system", content: AI_SYSTEM_PROMPT },
    {
      role: "user",
      content: JSON.stringify({
        actionType: request.actionType,
        environment: request.environment,
        blocks: allBlocks(request).map((b) => ({ id: b.id, kind: b.kind, text: b.text })),
      }),
    },
  ];
  try {
    let res = await callChat(
      config,
      { model: config.model, temperature: 0, response_format: { type: "json_object" }, messages },
      controller.signal,
    );
    if (res.status === 400) {
      // Some models reject temperature / response_format; retry with the bare request.
      res = await callChat(config, { model: config.model, messages }, controller.signal);
    }
    if (!res.ok) throw new Error(`AI provider returned HTTP ${res.status}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("AI provider returned no content");
    return AiOutputSchema.parse(JSON.parse(extractJson(content)));
  } finally {
    clearTimeout(timer);
  }
}
