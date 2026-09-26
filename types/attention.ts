import type { RiskLevel } from "./approval";
import type { CalibrationQuality, GazeSourceKind } from "./cv";

export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * `target`         decision-critical region selected by the semantic analyzer
 * `content`        any other request content
 * `context`        title / summary
 * `review-target`  isolated consequence shown during a paused re-review
 */
export type RegionRole = "target" | "content" | "context" | "review-target";

export interface RegionMeta {
  id: string;
  role: RegionRole;
  label: string;
  words: number;
  severity?: RiskLevel;
  /** Id of the approval request that rendered this region. */
  scope?: string;
}

/** A derived gaze sample, stored relative to the approval card. Never an image. */
export interface GazeSampleRecord {
  /** ms since the review opened. */
  t: number;
  /** Card-relative CSS pixels. */
  x: number;
  y: number;
  regionId: string | null;
  onCard: boolean;
  onScreen: boolean;
}

export interface TargetStats {
  id: string;
  label: string;
  severity: RiskLevel;
  words: number;
  requiredDwellMs: number;
  dwellMs: number;
  visibleMs: number;
  hoverMs: number;
  fixations: number;
  firstFixationMs: number | null;
  /** Fraction (0-1) of the region's horizontal extent that gaze reached. */
  sweep: number;
}

export interface FrameCounts {
  /** Frames processed while this review was open. */
  total: number;
  /** Frames with exactly one face. */
  face: number;
  /** Frames with more than one face. */
  multiFace: number;
  /** One face, head oriented toward the screen. */
  facing: number;
  /** Frames with a calibrated gaze estimate. */
  gaze: number;
  /** Gaze estimate inside the viewport. */
  onScreen: number;
}

export interface ReviewSnapshot {
  approvalId: string;
  /** ms from the request opening to this snapshot (= approval latency at click time). */
  elapsedMs: number;
  gazeSource: GazeSourceKind;
  calibrated: boolean;
  calibrationQuality: CalibrationQuality | null;
  frames: FrameCounts;
  targets: TargetStats[];
  regionDwellMs: Record<string, number>;
  cardGazeMs: number;
  offCardGazeMs: number;
  offScreenMs: number;
  /** Max fraction of the scroll container that has been in view (0-1). */
  scrollDepth: number;
  pointerDistancePx: number;
  focusedMs: number;
  gazeSamples: GazeSampleRecord[];
  regionRects: Record<string, RectLike & { role: RegionRole; label: string }>;
  cardSize: { width: number; height: number };
  gazeSigmaPx: { x: number; y: number } | null;
  viewport: { width: number; height: number };
}

export type InterventionLevel = "NORMAL" | "NUDGE" | "REFOCUS" | "PAUSE";

export const INTERVENTION_ORDER: Record<InterventionLevel, number> = {
  NORMAL: 0,
  NUDGE: 1,
  REFOCUS: 2,
  PAUSE: 3,
};

export type ComponentKey =
  | "coverage"
  | "reading"
  | "latency"
  | "visibility"
  | "presence"
  | "pattern"
  | "interaction";

export interface ScoreComponent {
  key: ComponentKey;
  label: string;
  /** 0-1 */
  value: number;
  /** Effective weight after redistribution (sums to 1 over available components). */
  weight: number;
  available: boolean;
}

export type ReasonTone = "critical" | "warning" | "info" | "positive";

export interface Reason {
  code: string;
  text: string;
  tone: ReasonTone;
}

export interface Baseline {
  /** Number of attentive reviews contributing. */
  samples: number;
  /** Personal review pace: approval latency per word of decision-relevant text. */
  msPerWordLatency: number | null;
  /** Personal target dwell per word on attentive reviews. */
  msPerWordDwell: number | null;
  medianLatencyMs: number | null;
  source: "default" | "personal";
}

export interface SessionPattern {
  n: number;
  scores: number[];
  /** Consecutive declines in attention score ending at the latest approval. */
  declineRun: number;
  /** Score drop across the declining run. */
  drop: number;
  /** Least-squares slope of attention score per approval (recent window). */
  slope: number;
  /** Consecutive latest approvals faster than the personal baseline allows. */
  rapidStreak: number;
  /** Slope of latency ratio per approval (negative = speeding up). */
  latencyTrend: number;
  /** 0-1 strength of the repeated low-attention pattern. Not a measure of tiredness. */
  fatigueScore: number;
  status: "insufficient" | "stable" | "declining" | "degradation";
  detected: boolean;
  message: string;
}

export interface AttentionAssessment {
  mode: "gaze" | "behavioral";
  /** 0-1 deterministic attention-evidence score. */
  attentionScore: number;
  /** Reliability of the evidence, not of the user. */
  confidence: "high" | "medium" | "low";
  confidenceValue: number;
  /** Severity-weighted target coverage (0-1), null when gaze evidence is unavailable or not applicable. */
  criticalCoverage: number | null;
  targetCoverage: { id: string; coverage: number; visible: boolean }[];
  targetsMissed: number;
  targetsNeverVisible: number;
  latencyMs: number;
  expectedLatencyMs: number;
  latencyRatio: number;
  /** 0-1 behavioral anomaly (fast approval, rapid streak, accelerating trend). */
  anomaly: number;
  components: ScoreComponent[];
  reasons: Reason[];
}

export interface InterventionDecision {
  level: InterventionLevel;
  /** How a re-review is verified if one is required. */
  verification: "gaze" | "manual" | "none";
  /** Multiplier applied to thresholds (>= 1). Raised by repeated low-attention approvals. */
  sensitivity: number;
  headline: string;
  reasons: Reason[];
  thresholds: Record<string, number>;
}

export type ApprovalOutcome =
  | "approved"
  | "approved_after_review"
  | "rejected"
  | "rejected_after_review";

export type AttentionLabel = "ATTENTIVE" | "LOW_ATTENTION";

/** One completed decision in the session. Derived numbers only. */
export interface ApprovalRecord {
  id: string;
  requestId: string;
  title: string;
  risk: RiskLevel;
  decidedAt: number;
  latencyMs: number;
  expectedLatencyMs: number;
  latencyRatio: number;
  /** First-attempt attention score; this is what the session trend uses. */
  attentionScore: number;
  criticalCoverage: number | null;
  mode: "gaze" | "behavioral";
  intervention: InterventionLevel;
  sensitivity: number;
  outcome: ApprovalOutcome;
  /** Target dwell per word on this review, used for the personal baseline. */
  dwellPerWordMs: number | null;
  /** Decision-relevant words (title + summary + targets). */
  expectedWords: number;
  reasons: Reason[];
  /** ML feature vector (see lib/ml/features.ts). */
  features: number[];
  label?: AttentionLabel;
  mlProbability?: number | null;
  reviewDurationMs?: number;
}

export interface ReReviewState {
  targetId: string;
  method: "gaze" | "manual";
  requiredDwellMs: number;
  minVisibleMs: number;
  dwellMs: number;
  visibleMs: number;
  satisfied: boolean;
}
