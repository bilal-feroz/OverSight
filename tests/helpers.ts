import type { RiskLevel } from "@/types/approval";
import type { GazeTrust, ReviewSnapshot, TargetStats, TrustLevel } from "@/types/attention";

/** A GazeTrust at a given level, for tests that build assessments by hand. */
export function trustOf(level: TrustLevel): GazeTrust {
  return {
    level,
    confidence: level === "none" ? 0 : level === "high" ? 0.95 : level === "medium" ? 0.7 : 0.4,
    reasons: [],
    effectiveFps: 30,
    stale: false,
    simulated: false,
    calibrationQuality: level === "none" ? null : level === "high" ? "good" : level === "medium" ? "fair" : "poor",
    separation: null,
  };
}

export function target(overrides: Partial<TargetStats> = {}): TargetStats {
  return {
    id: "impact-3",
    label: "Consequence",
    severity: "CRITICAL" as RiskLevel,
    words: 15,
    requiredDwellMs: 1350,
    dwellMs: 0,
    visibleMs: 1300,
    hoverMs: 0,
    fixations: 0,
    firstFixationMs: null,
    sweep: 0,
    ...overrides,
  };
}

/** A snapshot of one review with a live, calibrated camera and one face. */
export function snapshot(overrides: Partial<ReviewSnapshot> = {}): ReviewSnapshot {
  const elapsedMs = overrides.elapsedMs ?? 1300;
  const frames = Math.round((elapsedMs / 1000) * 30);
  const snap: ReviewSnapshot = {
    approvalId: "db-config",
    elapsedMs,
    gazeSource: "camera",
    calibrated: true,
    calibrationQuality: "good",
    calibrationStale: false,
    legacyCalibration: false,
    effectiveFps: 0,
    frames: {
      total: frames,
      face: frames,
      multiFace: 0,
      facing: frames,
      gaze: frames,
      onScreen: frames,
    },
    targets: [target()],
    regionDwellMs: {},
    cardGazeMs: elapsedMs,
    offCardGazeMs: 0,
    offScreenMs: 0,
    scrollDepth: 1,
    pointerDistancePx: 300,
    focusedMs: elapsedMs,
    gazeSamples: [],
    regionRects: {},
    cardSize: { width: 760, height: 640 },
    gazeSigmaPx: { x: 120, y: 140 },
    viewport: { width: 1440, height: 900 },
    ...overrides,
  };
  // Frames with gaze per second, unless a test sets it.
  if (overrides.effectiveFps === undefined) snap.effectiveFps = snap.frames.gaze / (snap.elapsedMs / 1000);
  return snap;
}

/** Attentive review: long enough, gaze on the critical consequence. */
export function attentiveSnapshot(overrides: Partial<ReviewSnapshot> = {}): ReviewSnapshot {
  return snapshot({
    elapsedMs: 7000,
    targets: [target({ dwellMs: 2100, visibleMs: 7000, fixations: 4, sweep: 0.8, firstFixationMs: 2500 })],
    ...overrides,
  });
}
