/**
 * Every tunable number in the attention layer lives here.
 * See docs/TUNING.md for guidance before changing values.
 */
export const ATTENTION_CONFIG = {
  /** How much target dwell counts as "meaningfully inspected". */
  dwell: {
    /** Default required gaze dwell per word of a target region (before a personal baseline exists). */
    defaultMsPerWord: 90,
    /** Once a baseline exists, require this fraction of the user's own typical dwell per word. */
    baselineFraction: 0.6,
    minMsPerWord: 50,
    maxMsPerWord: 160,
    minRequiredMs: 600,
    maxRequiredMs: 2400,
  },
  /** Approval latency vs. expected review time. */
  latency: {
    /** Default expected review pace per decision-relevant word (≈ 300 wpm). */
    defaultMsPerWord: 200,
    minMsPerWord: 100,
    maxMsPerWord: 400,
    minExpectedMs: 1500,
    maxExpectedMs: 20000,
    /** Latency ratio at which the latency component is 0 / 1. */
    scoreLow: 0.2,
    scoreHigh: 0.8,
    /** Approvals faster than this fraction of the expected time count as "rapid". */
    rapidRatio: 0.45,
  },
  /** Deterministic score weights. Unavailable components are redistributed proportionally. */
  weights: {
    gaze: {
      coverage: 0.35,
      reading: 0.15,
      latency: 0.15,
      visibility: 0.1,
      presence: 0.1,
      pattern: 0.15,
    },
    behavioral: {
      latency: 0.4,
      visibility: 0.2,
      interaction: 0.1,
      pattern: 0.3,
    },
  },
  /** When is camera evidence trustworthy enough to use? */
  signal: {
    minFrames: 5,
    minFaceRatio: 0.5,
    maxMultiFaceRatio: 0.2,
    minGazeRatio: 0.4,
    facingYawDeg: 28,
    facingPitchDeg: 25,
    calibrationWeight: { good: 1, fair: 0.75, poor: 0.45 } as Record<string, number>,
    behavioralConfidence: 0.35,
  },
  /** Region geometry. */
  targets: {
    /** A target must be on screen at least this long before gaze on it can be expected. */
    minVisibleForGazeMs: 150,
    /** Fraction of a region that must be inside the viewport to count as visible. */
    visibleFraction: 0.6,
    /** Horizontal bins used to measure how much of a sentence gaze traversed. */
    sweepBins: 5,
    sweepBinMinMs: 60,
    /** Hit-test margin around regions = clamp(sigma * factor, min, max) CSS px. */
    marginSigmaFactor: 0.6,
    marginMinPx: 16,
    marginMaxPx: 72,
    /** Fixation (I-DT) parameters. */
    fixationMinDurationMs: 120,
    fixationMinDispersionPx: 60,
    fixationSigmaFactor: 1.2,
    /** Below this per-target coverage a target counts as "missed". */
    missedCoverage: 0.25,
    /**
     * Gaze on a region in the first moments after a request appears is where the
     * eyes happened to rest, not inspection; dwell starts counting after this.
     */
    orientationMs: 500,
  },
  /** Session-level approval pattern ("approval fatigue" in the behavioral sense only). */
  pattern: {
    window: 6,
    /** Pattern detection needs at least this many approvals (current included). */
    minApprovals: 5,
    /** A step counts as continuing a decline if score <= previous + tolerance. */
    declineTolerance: 0.05,
    declineRunForDetection: 3,
    dropForDetection: 0.3,
    rapidStreakForDetection: 3,
    fatigueScoreForDetection: 0.65,
    /** Two attentive approvals in a row clear the pattern. */
    recoveryScore: 0.7,
  },
  /** Intervention sensitivity multiplier = 1 + gains, capped. */
  sensitivity: {
    fatigueGain: 0.35,
    streakGain: 0.08,
    mlGain: 0.1,
    max: 1.5,
  },
  /** Re-review after an intervention. */
  rereview: {
    fractionOfTarget: 0.8,
    minRequiredMs: 1000,
    maxRequiredMs: 2000,
    minVisibleMs: 800,
  },
  /** Personal baseline from the first attentive approvals of the session. */
  baseline: {
    minSamples: 2,
    maxSamples: 3,
    attentiveScore: 0.6,
  },
} as const;

export type AttentionConfig = typeof ATTENTION_CONFIG;
