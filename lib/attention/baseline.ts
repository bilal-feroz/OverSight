/**
 * Personal baseline. People read at different speeds, so OverSight compares an
 * approval with the same person's early, attentive reviews in this session
 * instead of a hard-coded "must wait N seconds".
 *
 * Review time is modelled as a fixed overhead (orienting, reaching for the
 * button) plus a per-word pace, so short requests do not inflate the pace.
 * The baseline freezes after the first few attentive approvals so later
 * rubber-stamping cannot drag it down. It lives for the session only.
 */
import type { ApprovalRecord, Baseline } from "@/types/attention";
import { clamp } from "@/lib/utils";
import { median } from "@/lib/math/stats";
import { ATTENTION_CONFIG } from "./config";

export const DEFAULT_BASELINE: Baseline = {
  samples: 0,
  overheadMs: ATTENTION_CONFIG.latency.overheadMs,
  msPerWordLatency: null,
  msPerWordDwell: null,
  medianLatencyMs: null,
  source: "default",
};

/**
 * Thoroughness of a stored decision. Records saved before V2 have none; their
 * attention score is the closest stand-in.
 */
export function thoroughnessOf(r: Pick<ApprovalRecord, "attentionScore"> & { thoroughness?: number }): number {
  return r.thoroughness ?? r.attentionScore;
}

export function computeBaseline(records: readonly ApprovalRecord[]): Baseline {
  const b = ATTENTION_CONFIG.baseline;
  const l = ATTENTION_CONFIG.latency;
  const attentive = records
    .filter((r) => thoroughnessOf(r) >= b.attentiveScore && r.intervention === "NORMAL" && r.expectedWords > 0)
    .slice(0, b.maxSamples);

  if (attentive.length < b.minSamples) {
    return { ...DEFAULT_BASELINE, samples: attentive.length };
  }

  const perWordLatency = median(attentive.map((r) => Math.max(0, r.latencyMs - l.overheadMs) / r.expectedWords));
  const dwellValues = attentive
    .map((r) => r.dwellPerWordMs)
    .filter((v): v is number => v != null && v > 0);

  return {
    samples: attentive.length,
    overheadMs: l.overheadMs,
    msPerWordLatency: clamp(perWordLatency, l.minMsPerWord, l.maxMsPerWord),
    // Raw personal dwell (conclusive targets only); requiredDwellMs() applies the fraction and clamps.
    msPerWordDwell: dwellValues.length >= b.minSamples ? clamp(median(dwellValues), 20, 400) : null,
    medianLatencyMs: median(attentive.map((r) => r.latencyMs)),
    source: "personal",
  };
}

/** Expected review time for a request with `words` decision-relevant words: overhead + words x pace. */
export function expectedLatencyMs(words: number, baseline: Baseline): number {
  const l = ATTENTION_CONFIG.latency;
  const perWord = clamp(baseline.msPerWordLatency ?? l.defaultMsPerWord, l.minMsPerWord, l.maxMsPerWord);
  const overhead = baseline.overheadMs ?? l.overheadMs;
  return clamp(overhead + Math.max(1, words) * perWord, l.minExpectedMs, l.maxExpectedMs);
}
