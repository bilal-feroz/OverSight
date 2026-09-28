/**
 * Approval session state machine.
 *
 *   analyzing -> reviewing --Approve--> evaluate
 *        NORMAL / NUDGE ............................. approved
 *        REFOCUS -> re-review (gaze | manual) -> Confirm -> approved (after review)
 *        PAUSE   -> re-review (gaze | manual) -> Confirm -> approved (after review)
 *   Reject is always available and never gated.
 *
 * Records hold derived numbers only and are kept in sessionStorage so an
 * accidental reload does not lose the session trend.
 */
import { create } from "zustand";
import { toast } from "sonner";
import type { ApprovalRequest } from "@/types/approval";
import type {
  ApprovalOutcome,
  ApprovalRecord,
  AttentionLabel,
  Baseline,
  ReReviewState,
  ReviewSnapshot,
  SessionPattern,
} from "@/types/attention";
import type { AnalyzerProviderInfo, SemanticAnalysis } from "@/types/semantic";
import { DEMO_SEQUENCE, getScenario } from "@/data/scenarios";
import { DEFAULT_BASELINE, computeBaseline } from "@/lib/attention/baseline";
import { toPatternPoints, type Evaluation } from "@/lib/attention/evaluate";
import { assessPattern } from "@/lib/attention/pattern";
import { acknowledgeManually, createReReview } from "@/lib/attention/rereview";
import { reviewController } from "@/lib/attention/review-controller";
import { approvalsOf, dwellPerWord, evaluateReview } from "@/lib/attention/review-evaluation";
import { expectedWordsFor, focusRegionFor, targetBlocks } from "@/lib/attention/targets";
import { analyzeRequest, fetchProviderInfo } from "@/lib/semantic/client";
import type { AttentionClassifier } from "@/lib/ml/logistic";
import {
  appendDatasetEntry,
  fetchBundledClassifier,
  loadDataset,
  loadStoredClassifier,
} from "@/lib/ml/dataset";
import { useUiStore } from "./ui-store";
import { uid } from "@/lib/utils";

export type ApprovalPhase = "analyzing" | "reviewing" | "refocus" | "paused" | "approved" | "rejected";

export interface QueueItem {
  id: string;
  request: ApprovalRequest;
  analysis: SemanticAnalysis | null;
  status: "pending" | "approved" | "rejected";
}

export interface ActiveApproval {
  itemId: string;
  /** Increments on every activation so re-selecting the same request restarts measurement. */
  seq: number;
  phase: ApprovalPhase;
  evaluation: Evaluation | null;
  snapshot: ReviewSnapshot | null;
  /** Field id of the consequence that must be re-reviewed. */
  focusFieldId: string | null;
  /** Registered region id the re-review is measured on. */
  reviewRegionId: string | null;
  /** Manual acknowledgement state (gaze re-review progress lives in the live store). */
  reReview: ReReviewState | null;
  manual: boolean;
  label: AttentionLabel | null;
  outcome: ApprovalOutcome | null;
  features: number[];
  mlProbability: number | null;
  attemptedAt: number | null;
}

interface PersistedSession {
  records: ApprovalRecord[];
  statuses: Record<string, QueueItem["status"]>;
  custom: ApprovalRequest[];
  criticalOnly: boolean;
  activeId: string | null;
}

export interface SessionState {
  initialized: boolean;
  queue: QueueItem[];
  active: ActiveApproval | null;
  records: ApprovalRecord[];
  baseline: Baseline;
  pattern: SessionPattern;
  criticalOnly: boolean;
  provider: AnalyzerProviderInfo | null;
  labeling: boolean;
  classifier: AttentionClassifier | null;
  datasetSize: number;

  init: () => Promise<void>;
  select: (itemId: string) => void;
  next: () => void;
  reset: () => void;
  addCustom: (request: ApprovalRequest) => Promise<void>;
  /** Actions take the request id they were rendered for; calls from a card that is no longer active are ignored. */
  attemptApproval: (itemId?: string) => void;
  reject: (itemId?: string) => void;
  confirmApproval: (itemId?: string) => void;
  switchToManual: (itemId?: string) => void;
  acknowledgeManual: (input: { typed?: string; expectedToken: string | null; checked?: boolean }) => boolean;
  setCriticalOnly: (on: boolean) => void;
  setLabeling: (on: boolean) => void;
  setClassifier: (model: AttentionClassifier | null) => void;
  refreshDatasetSize: () => void;
}

const STORAGE_KEY = "oversight.session.v1";

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function loadPersisted(): PersistedSession | null {
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedSession;
  } catch {
    return null;
  }
}

function persist(state: SessionState) {
  const data: PersistedSession = {
    records: state.records,
    statuses: Object.fromEntries(state.queue.map((q) => [q.id, q.status])),
    custom: state.queue.filter((q) => q.request.source === "custom").map((q) => q.request),
    criticalOnly: state.criticalOnly,
    activeId: state.active?.itemId ?? null,
  };
  storage()?.setItem(STORAGE_KEY, JSON.stringify(data));
}

function seededQueue(): QueueItem[] {
  return DEMO_SEQUENCE.map((id) => getScenario(id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .map((request) => ({ id: request.id, request, analysis: null, status: "pending" as const }));
}

let activationSeq = 0;

function emptyActive(itemId: string, analyzed: boolean, label: AttentionLabel | null): ActiveApproval {
  activationSeq += 1;
  return {
    itemId,
    seq: activationSeq,
    phase: analyzed ? "reviewing" : "analyzing",
    evaluation: null,
    snapshot: null,
    focusFieldId: null,
    reviewRegionId: null,
    reReview: null,
    manual: false,
    label,
    outcome: null,
    features: [],
    mlProbability: null,
    attemptedAt: null,
  };
}

function nextLabel(): AttentionLabel {
  const entries = loadDataset();
  const low = entries.filter((e) => e.label === "LOW_ATTENTION").length;
  const attentive = entries.length - low;
  if (low === attentive) return Math.random() < 0.5 ? "ATTENTIVE" : "LOW_ATTENTION";
  return low < attentive ? "LOW_ATTENTION" : "ATTENTIVE";
}

export const useSessionStore = create<SessionState>()((set, get) => {
  const analyzeItem = async (itemId: string) => {
    const item = get().queue.find((q) => q.id === itemId);
    if (!item) return;
    const analysis = await analyzeRequest(item.request);
    set((s) => ({
      queue: s.queue.map((q) => (q.id === itemId ? { ...q, analysis } : q)),
      active:
        s.active?.itemId === itemId && s.active.phase === "analyzing"
          ? { ...s.active, phase: "reviewing" }
          : s.active,
    }));
  };

  const finalize = (outcome: ApprovalOutcome) => {
    const s = get();
    const active = s.active;
    if (!active?.evaluation || !active.snapshot) return;
    const item = s.queue.find((q) => q.id === active.itemId);
    if (!item?.analysis) return;
    const { assessment, decision } = active.evaluation;
    const applied =
      outcome === "rejected" ? "NORMAL" : decision.level; // a rejection during review is never gated
    const record: ApprovalRecord = {
      id: uid("rec"),
      requestId: item.id,
      title: item.request.title,
      risk: item.analysis.overallRisk,
      decidedAt: Date.now(),
      latencyMs: assessment.latencyMs,
      expectedLatencyMs: assessment.expectedLatencyMs,
      latencyRatio: assessment.latencyRatio,
      attentionScore: assessment.attentionScore,
      criticalCoverage: assessment.criticalCoverage,
      mode: assessment.mode,
      intervention: applied,
      sensitivity: decision.sensitivity,
      outcome,
      dwellPerWordMs: dwellPerWord(active.snapshot, active.evaluation),
      expectedWords: expectedWordsFor(item.request, item.analysis),
      reasons: decision.reasons,
      features: active.features,
      label: active.label ?? undefined,
      mlProbability: active.mlProbability,
      reviewDurationMs: active.attemptedAt ? Date.now() - active.attemptedAt : 0,
    };
    const records = [...s.records, record];
    const approvals = approvalsOf(records);
    const pattern = assessPattern(toPatternPoints(approvals));
    let criticalOnly = s.criticalOnly;
    if (useUiStore.getState().criticalOnlyAuto) {
      if (pattern.detected && !criticalOnly) {
        criticalOnly = true;
        toast.warning("Critical-only review mode enabled", {
          description: `${pattern.message} Routine details are now collapsed.`,
        });
      } else if (criticalOnly && pattern.status === "stable") {
        criticalOnly = false;
        toast.success("Review attention recovered", { description: "Full request view restored." });
      }
    }
    if (active.label) {
      appendDatasetEntry({
        features: active.features,
        label: active.label,
        createdAt: Date.now(),
        requestId: item.id,
        risk: item.analysis.overallRisk,
        deterministicScore: assessment.attentionScore,
        deterministicLevel: decision.level,
      });
    }
    reviewController.session?.freeze();
    set({
      records,
      baseline: computeBaseline(approvals),
      pattern,
      criticalOnly,
      datasetSize: active.label ? loadDataset().length : s.datasetSize,
      queue: s.queue.map((q) =>
        q.id === item.id ? { ...q, status: outcome.startsWith("approved") ? "approved" : "rejected" } : q,
      ),
      active: {
        ...active,
        outcome,
        phase: outcome.startsWith("approved") ? "approved" : "rejected",
      },
    });
    persist(get());
  };

  /** Snapshot + deterministic evaluation (+ advisory ML) for the current review. */
  const evaluateCurrent = (): { evaluation: Evaluation; snapshot: ReviewSnapshot; features: number[]; ml: number | null } | null => {
    const s = get();
    const active = s.active;
    const item = s.queue.find((q) => q.id === active?.itemId);
    const session = reviewController.session;
    if (!active || !item?.analysis || !session) return null;
    const snapshot = session.snapshot();
    const { evaluation, features, ml } = evaluateReview(snapshot, {
      request: item.request,
      analysis: item.analysis,
      records: s.records,
      baseline: s.baseline,
      classifier: s.classifier,
    });
    return { evaluation, snapshot, features, ml };
  };

  return {
    initialized: false,
    queue: [],
    active: null,
    records: [],
    baseline: DEFAULT_BASELINE,
    pattern: assessPattern([]),
    criticalOnly: false,
    provider: null,
    labeling: false,
    classifier: null,
    datasetSize: 0,

    init: async () => {
      if (get().initialized) return;
      const saved = loadPersisted();
      const queue = [
        ...seededQueue(),
        ...(saved?.custom ?? []).map((request) => ({
          id: request.id,
          request,
          analysis: null,
          status: "pending" as const,
        })),
      ].map((q) => ({ ...q, status: saved?.statuses[q.id] ?? q.status }));
      const records = saved?.records ?? [];
      set({
        initialized: true,
        queue,
        records,
        baseline: computeBaseline(approvalsOf(records)),
        pattern: assessPattern(toPatternPoints(approvalsOf(records))),
        criticalOnly: saved?.criticalOnly ?? false,
        datasetSize: loadDataset().length,
        classifier: loadStoredClassifier(),
      });
      const first =
        (saved?.activeId && queue.find((q) => q.id === saved.activeId && q.status === "pending")) ||
        queue.find((q) => q.status === "pending");
      if (first) get().select(first.id);
      void Promise.all(queue.map((q) => analyzeItem(q.id)));
      void fetchProviderInfo().then((provider) => set({ provider }));
      if (!get().classifier) void fetchBundledClassifier().then((m) => m && set({ classifier: m }));
    },

    select: (itemId) => {
      const item = get().queue.find((q) => q.id === itemId);
      if (!item) return;
      reviewController.end();
      set({ active: emptyActive(itemId, Boolean(item.analysis), get().labeling ? nextLabel() : null) });
      persist(get());
    },

    next: () => {
      const s = get();
      const index = s.queue.findIndex((q) => q.id === s.active?.itemId);
      // Wrap around, current item last: skipping the only pending request re-opens it.
      const ordered = [...s.queue.slice(index + 1), ...s.queue.slice(0, index + 1)];
      const upcoming = ordered.find((q) => q.status === "pending");
      if (upcoming) get().select(upcoming.id);
      else {
        reviewController.end();
        set({ active: null });
        persist(get());
      }
    },

    reset: () => {
      reviewController.end();
      storage()?.removeItem(STORAGE_KEY);
      const queue = seededQueue().map((q) => {
        const analyzed = get().queue.find((old) => old.id === q.id)?.analysis ?? null;
        return { ...q, analysis: analyzed };
      });
      set({
        queue,
        records: [],
        baseline: DEFAULT_BASELINE,
        pattern: assessPattern([]),
        criticalOnly: false,
        active: null,
      });
      if (queue[0]) get().select(queue[0].id);
      for (const q of queue) if (!q.analysis) void analyzeItem(q.id);
    },

    addCustom: async (request) => {
      set((s) => ({ queue: [...s.queue, { id: request.id, request, analysis: null, status: "pending" }] }));
      get().select(request.id);
      await analyzeItem(request.id);
      persist(get());
    },

    attemptApproval: (itemId) => {
      const s = get();
      const active = s.active;
      if (!active || active.phase !== "reviewing") return;
      if (itemId && itemId !== active.itemId) return;
      const result = evaluateCurrent();
      if (!result) return;
      const { evaluation, snapshot, features, ml } = result;
      const item = s.queue.find((q) => q.id === active.itemId)!;
      const base: ActiveApproval = {
        ...active,
        evaluation,
        snapshot,
        features,
        mlProbability: ml,
        attemptedAt: Date.now(),
      };
      set({ active: base });

      // Data-collection mode records the decision without enforcing it.
      if (s.labeling || evaluation.decision.level === "NORMAL" || evaluation.decision.level === "NUDGE") {
        finalize("approved");
        return;
      }

      // Re-review the least-covered target.
      const coverage = new Map(evaluation.assessment.targetCoverage.map((t) => [t.id, t]));
      const targets = targetBlocks(item.request, item.analysis!);
      const focus =
        [...targets].sort((a, b) => {
          const ca = coverage.get(a.region.fieldId);
          const cb = coverage.get(b.region.fieldId);
          return (ca?.visible ? ca.coverage : -1) - (cb?.visible ? cb.coverage : -1);
        })[0] ?? targets[0];
      // An intervention is never auto-approved: without a target, the summary is re-reviewed.
      const focusFieldId = focus ? focus.region.fieldId : focusRegionFor(item.request, item.analysis!, null).fieldId;
      const required = snapshot.targets.find((t) => t.id === focusFieldId)?.requiredDwellMs ?? 1350;
      const paused = evaluation.decision.level === "PAUSE";
      const reviewRegionId = paused ? `review:${focusFieldId}` : focusFieldId;
      // Gaze verification needs a target gaze can tell apart: the isolated PAUSE view always is;
      // an in-card REFOCUS target may sit too close to the title or buttons at this error.
      const focusStats = snapshot.targets.find((t) => t.id === focusFieldId);
      const method =
        evaluation.decision.verification === "gaze" && (paused || focusStats?.conclusive !== false) ? "gaze" : "manual";
      const reReview = createReReview(reviewRegionId, required, method);
      reviewController.session?.startReReview(reReview);
      reviewController.flush();
      set({
        active: {
          ...base,
          phase: paused ? "paused" : "refocus",
          focusFieldId,
          reviewRegionId,
          reReview,
          manual: method === "manual",
        },
      });
    },

    reject: (itemId) => {
      const s = get();
      const active = s.active;
      if (!active) return;
      if (itemId && itemId !== active.itemId) return;
      if (active.phase === "reviewing") {
        const result = evaluateCurrent();
        if (!result) return;
        set({
          active: {
            ...active,
            evaluation: result.evaluation,
            snapshot: result.snapshot,
            features: result.features,
            mlProbability: result.ml,
            attemptedAt: Date.now(),
          },
        });
        finalize("rejected");
      } else if (active.phase === "refocus" || active.phase === "paused") {
        finalize("rejected_after_review");
      }
    },

    confirmApproval: (itemId) => {
      const active = get().active;
      if (!active || (active.phase !== "refocus" && active.phase !== "paused")) return;
      if (itemId && itemId !== active.itemId) return;
      const gazeDone = reviewController.session?.reReview?.satisfied ?? false;
      const manualDone = active.reReview?.satisfied ?? false;
      if (!gazeDone && !manualDone) return;
      finalize("approved_after_review");
    },

    switchToManual: (itemId) => {
      const active = get().active;
      if (!active?.reReview) return;
      if (itemId && itemId !== active.itemId) return;
      reviewController.session?.useManual();
      reviewController.flush();
      set({ active: { ...active, manual: true, reReview: { ...active.reReview, method: "manual" } } });
    },

    acknowledgeManual: (input) => {
      const active = get().active;
      if (!active?.reReview) return false;
      const next = acknowledgeManually({ ...active.reReview, method: "manual" }, input);
      set({ active: { ...active, reReview: next } });
      return next.satisfied;
    },

    setCriticalOnly: (on) => {
      set({ criticalOnly: on });
      persist(get());
    },

    setLabeling: (on) => {
      set((s) => ({
        labeling: on,
        active: s.active ? { ...s.active, label: on ? nextLabel() : null } : s.active,
      }));
    },

    setClassifier: (model) => set({ classifier: model }),

    refreshDatasetSize: () => set({ datasetSize: loadDataset().length }),
  };
});
