/**
 * Which status line the signal banner shows, in priority order. Pure, so the
 * precedence can be tested; the wording lives in components/layout/signal-banner.tsx.
 */
import type { TrustLevel } from "@/types/attention";
import type { CalibrationQuality, CameraStatus } from "@/types/cv";

export type BannerKind =
  /** Pointer used as a gaze proxy (development only); always labeled. */
  | "simulated"
  | "uncalibrated"
  /** "Calibration stale: recalibrate" */
  | "stale"
  /** "Gaze uncertain: using interaction timing" (low calibration quality) */
  | "poor"
  /** "Possible drift: quick recheck" */
  | "drift"
  /** "Gaze uncertain: using interaction timing" (low or no trust in the review so far) */
  | "uncertain"
  | "camera-off";

export interface BannerInput {
  simulated: boolean;
  cameraStatus: CameraStatus;
  calibrated: boolean;
  calibrationQuality: CalibrationQuality | null;
  calibrationStale: boolean;
  driftSuspected: boolean;
  /** Gaze trust of the review in progress, once settled; null when there is none. */
  liveTrust: TrustLevel | null;
}

export function bannerKind(i: BannerInput): BannerKind | null {
  if (i.simulated) return "simulated";
  if (i.cameraStatus === "active") {
    if (!i.calibrated) return "uncalibrated";
    if (i.calibrationStale) return "stale";
    if (i.calibrationQuality === "poor") return "poor";
    if (i.driftSuspected) return "drift";
    if (i.liveTrust === "low" || i.liveTrust === "none") return "uncertain";
    return null;
  }
  if (i.cameraStatus === "requesting" || i.cameraStatus === "loading-model") return null;
  return "camera-off";
}
