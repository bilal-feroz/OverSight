import { create } from "zustand";
import type { ReReviewState, TrustLevel } from "@/types/attention";

export interface LiveTarget {
  id: string;
  dwellMs: number;
  requiredDwellMs: number;
  visible: boolean;
  /** Soft weight of the latest gaze estimate on this region (0-1). */
  weight: number;
  /** Gap to the nearest title/summary/button in sigma units; null when unknown. */
  separation: number | null;
  conclusive: boolean;
  fixations: number;
}

/** Gaze trust of the review so far (about 1 Hz, once the review has run long enough to judge). */
export interface LiveTrust {
  level: TrustLevel;
  /** The main reason for the level, if any (trust reason or signal note). */
  code: string | null;
  text: string | null;
}

/** Live measurements for the review in progress (~8 Hz). */
export interface LiveState {
  approvalId: string | null;
  elapsedMs: number;
  /** Weighted coverage of visible targets (0-1); null when gaze evidence is unavailable. */
  coverage: number | null;
  targets: LiveTarget[];
  regionId: string | null;
  onCard: boolean;
  gazeActive: boolean;
  reReview: ReReviewState | null;
  /** Share of gaze time: critical regions / other request content / off-card. */
  distribution: { critical: number; other: number; offCard: number };
  /** Uncertainty of the latest gaze estimate. */
  estimate: { sigmaX: number; sigmaY: number; confidence: number; postureZ: number } | null;
  trust: LiveTrust | null;
}

/** What the tracker measures itself; trust is added by the review controller. */
export type LiveMeasurements = Omit<LiveState, "trust">;

export const EMPTY_LIVE: LiveState = {
  approvalId: null,
  elapsedMs: 0,
  coverage: null,
  targets: [],
  regionId: null,
  onCard: false,
  gazeActive: false,
  reReview: null,
  distribution: { critical: 0, other: 0, offCard: 0 },
  estimate: null,
  trust: null,
};

export const useLiveStore = create<LiveState>(() => EMPTY_LIVE);
