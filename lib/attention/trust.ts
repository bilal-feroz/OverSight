/**
 * Gaze trust: how far one review's gaze evidence can be trusted.
 *
 * Computed from the snapshot at approval time: signal reliability (faces,
 * frames), calibration quality and staleness, the effective gaze frame rate,
 * face-tracking continuity, and whether gaze at the measured accuracy can
 * tell the critical text apart from the title and summary at all.
 *
 * Trust decides how gaze and behavior are fused (lib/risk/intervention.ts).
 * It can take gaze out of a decision; it never removes an intervention the
 * behavioral evidence requires.
 */
import type { GazeTrust, Reason, ReviewSnapshot, TrustLevel } from "@/types/attention";
import { TRUST_ORDER } from "@/types/attention";
import { isSimulationAllowed } from "@/lib/cv/simulated";
import { clamp01 } from "@/lib/utils";
import { ATTENTION_CONFIG } from "./config";
import type { SignalQuality } from "./engine";
import { targetSeparation } from "./regions";

/**
 * Separation (sigma units) of the best-separated visible critical target from
 * the title/summary, or null when it cannot be measured (no layout or no error
 * estimate). Below `trust.minSeparationSigma` gaze cannot tell them apart.
 */
export function criticalSeparation(snapshot: ReviewSnapshot): number | null {
  const sigma = snapshot.gazeSigmaPx;
  if (!sigma) return null;
  const rects = snapshot.regionRects;
  const competitors = Object.values(rects).filter((r) => r.role === "context");
  if (!competitors.length) return null;
  const minVisible = ATTENTION_CONFIG.targets.minVisibleForGazeMs;
  const separations = snapshot.targets
    .filter((t) => t.visibleMs >= minVisible && rects[t.id])
    .map((t) => targetSeparation(rects[t.id], competitors, sigma));
  return separations.length ? Math.max(...separations) : null;
}

export function assessGazeTrust(snapshot: ReviewSnapshot, signal: SignalQuality): GazeTrust {
  const cfg = ATTENTION_CONFIG.trust;
  const simulated = snapshot.gazeSource === "simulated";
  const quality = snapshot.calibrationQuality;
  const effectiveFps = snapshot.effectiveFps;
  const stale = snapshot.calibrationStale && !simulated;
  const base = { effectiveFps, stale, simulated, calibrationQuality: quality };

  // No usable gaze at all. The signal notes already explain the common causes.
  const none = (reason?: Reason): GazeTrust => ({
    level: "none",
    confidence: 0,
    reasons: reason ? [reason] : [],
    separation: null,
    ...base,
  });
  if (!signal.reliable) return none();
  if (simulated && !isSimulationAllowed()) {
    return none({
      code: "simulated-blocked",
      text: "Simulated gaze is not accepted as evidence in this build.",
      tone: "warning",
    });
  }
  if (stale) {
    return none({
      code: "trust-stale",
      text: "The window moved, was resized or zoomed since calibration; gaze evidence not used.",
      tone: "warning",
    });
  }

  const tracking = signal.faceRatio * (1 - signal.multiRatio) * Math.sqrt(signal.facingRatio);
  const qualityWeight = simulated
    ? ATTENTION_CONFIG.signal.simulatedWeight
    : (ATTENTION_CONFIG.signal.calibrationWeight[quality ?? "poor"] ?? ATTENTION_CONFIG.signal.calibrationWeight.poor);
  const confidence = clamp01(qualityWeight * tracking * Math.min(1, effectiveFps / cfg.fullConfidenceFps));

  let level: TrustLevel = "high";
  const reasons: Reason[] = [];
  const cap = (to: TrustLevel, reason: Reason) => {
    if (TRUST_ORDER[to] < TRUST_ORDER[level]) level = to;
    reasons.push(reason);
  };
  const fps = Math.round(effectiveFps);

  if (!simulated && quality === "poor") {
    cap("low", {
      code: "trust-poor",
      text: "Calibration quality is low; gaze evidence not used for this decision.",
      tone: "warning",
    });
  }
  if (effectiveFps < cfg.lowFps) {
    cap("low", {
      code: "trust-fps",
      text: `Only ${fps} gaze frame${fps === 1 ? "" : "s"} per second reached OverSight; interaction timing decides instead.`,
      tone: "info",
    });
  }
  const separation = criticalSeparation(snapshot);
  if (separation !== null && separation < cfg.minSeparationSigma) {
    cap("low", {
      code: "trust-separation",
      text: "At the measured gaze accuracy the critical text cannot be told apart from the title or summary; gaze evidence not used.",
      tone: "info",
    });
  }
  if (tracking < cfg.trackingLow) {
    cap("low", {
      code: "trust-tracking",
      text: "Face tracking was lost for much of this review; gaze evidence not used.",
      tone: "info",
    });
  } else if (tracking < cfg.trackingMedium) {
    cap("medium", {
      code: "trust-tracking",
      text: "Gaze evidence limited: face tracking was intermittent during this review.",
      tone: "info",
    });
  }
  if (!simulated && quality === "fair") {
    cap("medium", { code: "trust-fair", text: "Gaze evidence limited: calibration is fair.", tone: "info" });
  }
  if (effectiveFps >= cfg.lowFps && effectiveFps < cfg.mediumFps) {
    cap("medium", {
      code: "trust-fps-medium",
      text: `Gaze evidence limited: ${fps} gaze frames per second.`,
      tone: "info",
    });
  }
  if (!simulated && snapshot.legacyCalibration) {
    cap("medium", {
      code: "trust-legacy",
      text: "Gaze evidence limited: this calibration's accuracy was not measured on held-out points.",
      tone: "info",
    });
  }
  return { level, confidence, reasons, separation, ...base };
}

/** Gaze may be used for this review's decision. */
export function gazeUsable(trust: GazeTrust): boolean {
  return trust.level === "high" || trust.level === "medium";
}
