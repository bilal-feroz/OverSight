import { create } from "zustand";
import type { ReReviewState } from "@/types/attention";

export interface LiveTarget {
  id: string;
  dwellMs: number;
  requiredDwellMs: number;
  visible: boolean;
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
}

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
};

export const useLiveStore = create<LiveState>(() => EMPTY_LIVE);
