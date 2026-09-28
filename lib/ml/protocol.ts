/**
 * Data-collection protocol (Model lab, "collection session").
 *
 * Each participant reviews counterbalanced blocks of instructed conditions.
 * The block order comes from a Latin square keyed by the participant code, so
 * across participants every condition appears in every position; scenarios
 * are shuffled within the session. Labels follow from the condition. This
 * replaces the old "whichever class is in the minority" alternation, whose
 * order leaked into the history features.
 *
 * Participant codes are pseudonymous and chosen by the operator ("P03"):
 * never names or emails.
 */
import type { AttentionLabel } from "@/types/attention";

export type Condition = "ATTENTIVE" | "RAPID_APPROVAL" | "LOW_ATTENTION" | "DISTRACTED" | "CAMERA_UNCERTAIN";

/** Latin-square base order. */
export const CONDITIONS: readonly Condition[] = [
  "ATTENTIVE",
  "RAPID_APPROVAL",
  "LOW_ATTENTION",
  "DISTRACTED",
  "CAMERA_UNCERTAIN",
];

/** Reviews per condition in one session (18 in total). */
export const CONDITION_COUNTS: Record<Condition, number> = {
  ATTENTIVE: 4,
  RAPID_APPROVAL: 4,
  LOW_ATTENTION: 4,
  DISTRACTED: 3,
  CAMERA_UNCERTAIN: 3,
};

export const CONDITION_NAMES: Record<Condition, string> = {
  ATTENTIVE: "Attentive",
  RAPID_APPROVAL: "Rapid approval",
  LOW_ATTENTION: "Low attention",
  DISTRACTED: "Distracted",
  CAMERA_UNCERTAIN: "Camera uncertain",
};

/** What the participant is asked to do (shown in the console banner). */
export const CONDITION_INSTRUCTIONS: Record<Condition, string> = {
  ATTENTIVE: "Review as you normally would when it matters.",
  RAPID_APPROVAL: "Approve each request as fast as you comfortably can.",
  LOW_ATTENTION: "Read only the title and summary, then decide.",
  DISTRACTED: "Look away from the screen for a few seconds during the review, then approve without re-reading.",
  CAMERA_UNCERTAIN: "Review carefully while moving around or leaning away (tracking will be poor).",
};

/** Careful reviews are ATTENTIVE even when tracking is poor; the other conditions are LOW_ATTENTION. */
export function labelForCondition(condition: Condition): AttentionLabel {
  return condition === "ATTENTIVE" || condition === "CAMERA_UNCERTAIN" ? "ATTENTIVE" : "LOW_ATTENTION";
}

const CODE = /^[A-Za-z]{1,3}\d{1,4}$/;

/** A pseudonymous code such as "P03": 1-3 letters then 1-4 digits. Rejects names, emails and free text. */
export function isParticipantCode(code: string): boolean {
  return CODE.test(code.trim());
}

export function normalizeParticipant(code: string): string {
  return code.trim().toUpperCase();
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Latin-square row for a participant: consecutive numbers (P01..P05) get distinct rows. */
export function latinSquareRow(participant: string, n = CONDITIONS.length): number {
  const digits = /(\d+)$/.exec(normalizeParticipant(participant));
  const value = digits ? Number(digits[1]) - 1 : hashString(normalizeParticipant(participant));
  return ((value % n) + n) % n;
}

/** Block order of the conditions for one participant (a row of a cyclic Latin square). */
export function blockOrder(participant: string): Condition[] {
  const r = latinSquareRow(participant);
  return CONDITIONS.map((_, i) => CONDITIONS[(i + r) % CONDITIONS.length]);
}

export interface PlanStep {
  /** Index within the session. */
  order: number;
  condition: Condition;
  scenarioId: string;
}

function rng(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A numeric seed from a session id, so every session gets its own scenario shuffle. */
export function seedFrom(sessionId: string): number {
  return hashString(sessionId);
}

/**
 * The session plan: condition blocks in the participant's Latin-square order,
 * scenarios shuffled across the session (reshuffled on each pass through the
 * list, never the same scenario twice in a row).
 */
export function collectionPlan(participant: string, scenarioIds: readonly string[], seed: number): PlanStep[] {
  if (!scenarioIds.length) return [];
  const rand = rng(seed);
  const conditions = blockOrder(participant).flatMap((c) => Array.from({ length: CONDITION_COUNTS[c] }, () => c));
  const scenarios: string[] = [];
  while (scenarios.length < conditions.length) {
    let pass = shuffled(scenarioIds, rand);
    if (scenarios.length && pass[0] === scenarios[scenarios.length - 1] && pass.length > 1) {
      pass = [...pass.slice(1), pass[0]];
    }
    scenarios.push(...pass);
  }
  return conditions.map((condition, order) => ({ order, condition, scenarioId: scenarios[order] }));
}
