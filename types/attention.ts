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

/**
 * How well gaze evidence supports that a target was looked at.
 * `inconclusive`: at the measured error, gaze on it cannot be told apart from
 * gaze on the title, summary or decision buttons, so gaze says nothing either way.
 */
export type EvidenceStrength = "strong" | "partial" | "not-observed" | "inconclusive" | "not-visible";

export interface TargetStats {
  id: string;
  label: string;
  severity: RiskLevel;
  words: number;
  requiredDwellMs: number;
  /** Soft dwell: time x the probability-like weight that gaze was on the region. */
  dwellMs: number;
  visibleMs: number;
  hoverMs: number;
  /** Fixations attributed to the region (weight >= fixationMinWeight at the fixation centre). */
  fixations: number;
  firstFixationMs: number | null;
  /** Fraction (0-1) of the region's horizontal extent that gaze reached. */
  sweep: number;
  /** Sweep is only meaningful when horizontal gaze error is small against the region's width. */
  sweepAvailable?: boolean;
  /** Gap (sigma units) to the nearest title/summary/decision button; null when unknown. */
  separation?: number | null;
  /** Gaze can tell this region apart from its competitors at the measured error. */
  conclusive?: boolean;
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
  /** The display changed since calibration (resize, window move, zoom): gaze no longer maps to the same pixels. */
  calibrationStale: boolean;
  /** Calibration restored from an older format whose accuracy was not measured on held-out points. */
  legacyCalibration: boolean;
  /** Anchor clicks suggest the calibration drifted since it was made or last rechecked. */
  driftSuspected?: boolean;
  frames: FrameCounts;
  /** Frames with a gaze estimate per second of review. */
  effectiveFps: number;
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
  /** Calibration gaze error (1 sigma per axis), CSS px. */
  gazeSigmaPx: { x: number; y: number } | null;
  /** Mean per-frame gaze error during the review (calibration error after posture/blink/drift inflation). */
  sigmaEffPx?: { x: number; y: number } | null;
  /** Mean per-frame estimate confidence (0-1). */
  meanEstimateConfidence?: number | null;
  /** Share of gaze frames with the head outside the calibrated posture. */
  postureOutRatio?: number;
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

/**
 * How far this review's gaze evidence can be trusted.
 * `high`: gaze decides as designed. `medium`: gaze may ask for a refocus but
 * the behavioral floor still applies. `low` / `none`: gaze is not used.
 */
export type TrustLevel = "high" | "medium" | "low" | "none";

export const TRUST_ORDER: Record<TrustLevel, number> = { none: 0, low: 1, medium: 2, high: 3 };

export interface Reason {
  code: string;
  text: string;
  tone: ReasonTone;
}

export interface GazeTrust {
  level: TrustLevel;
  /** 0-1 reliability of the gaze evidence for this review (0 when there is none). */
  confidence: number;
  /** Why the level is below high, in plain language. */
  reasons: Reason[];
  /** Frames with a gaze estimate per second of review. */
  effectiveFps: number;
  stale: boolean;
  simulated: boolean;
  calibrationQuality: CalibrationQuality | null;
  /** Smallest separation (in sigma units) between a visible critical target and the title/summary; null if not measurable. */
  separation: number | null;
}

export interface Baseline {
  /** Number of attentive reviews contributing. */
  samples: number;
  /** Fixed part of a review (orienting, reaching for the button), ms. */
  overheadMs: number;
  /** Personal review pace: (approval latency - overhead) per word of decision-relevant text. */
  msPerWordLatency: number | null;
  /** Personal target dwell per word on attentive reviews. */
  msPerWordDwell: number | null;
  medianLatencyMs: number | null;
  source: "default" | "personal";
}

export type PatternTrigger = "decline" | "rapid" | "speedup" | "strength";

export interface SessionPattern {
  n: number;
  /** Thoroughness of the latest approvals (the pattern's input, never the attention score). */
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
  /** One-sided CUSUM of -log(latency ratio): a sustained speed-up. */
  cusum: number;
  /** 0-1 strength of the repeated low-attention pattern. Not a measure of tiredness. */
  fatigueScore: number;
  status: "insufficient" | "stable" | "declining" | "degradation";
  detected: boolean;
  /** Which criterion detected the pattern. */
  trigger: PatternTrigger | null;
  message: string;
}

export interface AttentionAssessment {
  mode: "gaze" | "behavioral";
  /** 0-1 deterministic attention-evidence score (what the policy thresholds use). */
  attentionScore: number;
  /**
   * The same evidence without the session-pattern component, weights
   * renormalized. The pattern, the baseline and ML consume this, never
   * attentionScore, so the pattern cannot feed on itself.
   */
  thoroughness: number;
  /** The same score from interaction evidence only (behavioral weights), used for the behavioral floor. */
  behavioralScore: number;
  /** Trust in this review's gaze evidence; decides how gaze and behavior are fused. */
  trust: GazeTrust;
  /** Reliability of the evidence, not of the user. */
  confidence: "high" | "medium" | "low";
  confidenceValue: number;
  /** Severity-weighted coverage (0-1) of visible, conclusive targets; null when gaze evidence is unavailable or not applicable. */
  criticalCoverage: number | null;
  targetCoverage: {
    id: string;
    coverage: number;
    visible: boolean;
    /** Gaze can tell the target apart from the title, summary and buttons (false = inconclusive). */
    conclusive?: boolean;
    strength?: EvidenceStrength;
    separation?: number | null;
  }[];
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
  /** Level the gaze evidence alone would require (null when gaze is not applicable). */
  gazeLevel: InterventionLevel | null;
  /** Level interaction evidence alone requires: the floor whenever gaze trust is below high. */
  behavioralLevel: InterventionLevel;
  trustLevel: TrustLevel;
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
  /** First-attempt attention score (display). */
  attentionScore: number;
  /** First-attempt thoroughness: what the session pattern and baseline use. Absent on records stored before V2. */
  thoroughness?: number;
  /** Critical targets whose (conclusive) gaze evidence was "not observed". */
  notObserved?: number;
  /** First fixation on a critical target / latency (1 = never). */
  timeToFirstCriticalRatio?: number | null;
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
  /** Legacy ML feature vector (v1); empty for V2 records, which use featureValues. */
  features: number[];
  /** Named ML features (lib/ml/features.ts, schema v2). */
  featureValues?: Partial<Record<string, number | null>>;
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
