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
    /** Weight of simulated (pointer) gaze in trust confidence; development only. */
    simulatedWeight: 0.8,
    /** Gaze error assumed for simulated (pointer) gaze, CSS px; the pointer is precise. */
    simulatedSigmaPx: 20,
    behavioralConfidence: 0.35,
  },
  /**
   * Gaze trust: how much the decision may rely on gaze for one review.
   * none: unreliable signal or stale calibration. low: poor calibration, too few
   * frames or targets gaze cannot tell apart from the title. medium: fair or
   * legacy calibration, or a slow camera. high: everything else.
   */
  trust: {
    /** Effective gaze frame rate (frames with a gaze estimate per second of review). */
    lowFps: 5,
    mediumFps: 10,
    /** Frame rate at which the frame-rate factor of trust confidence reaches 1. */
    fullConfidenceFps: 15,
    /**
     * Face-tracking continuity = face ratio x (1 - multi-face ratio) x sqrt(facing ratio).
     * Below these values trust is capped at medium / low.
     */
    trackingMedium: 0.55,
    trackingLow: 0.3,
    /**
     * Gap (in sigma units of gaze error) a critical target needs from the title
     * and summary for gaze to tell them apart. Below it, gaze on one could be
     * gaze on the other.
     */
    minSeparationSigma: 2.0,
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
    /**
     * Largest time step one camera frame may add to dwell. Generous enough that a
     * slow camera (4-10 fps) is not silently under-counted; low frame rates lower
     * gaze trust instead.
     */
    maxFrameDtMs: 250,
    /** Time step assumed for the first gaze frame of a run. */
    firstFrameDtMs: 33,
    /** Largest time step one animation-frame tick may add to visibility, hover and focus. */
    maxTickDtMs: 100,
    /** If animation frames stall this long, camera frames tick the session themselves. */
    tickStallMs: 200,
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
