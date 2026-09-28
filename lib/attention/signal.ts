import { gazePrecisionPx, gazeSigmaPx } from "@/lib/cv/calibration";
import { CV_CONFIG } from "@/lib/cv/config";
import { getGazeHub } from "@/lib/cv/gaze-hub";
import { useCvStore } from "@/lib/store/cv-store";
import type { GazeSignalOptions } from "./tracker";

export type GazeSignal = GazeSignalOptions;

/**
 * The current gaze signal as the attention tracker should see it. Staleness is
 * passed through as its own fact (it sets gaze trust to none) rather than
 * being folded into the calibration quality.
 */
export function currentGazeSignal(): GazeSignal {
  const hub = getGazeHub();
  const { calibrationStale, drift } = useCvStore.getState();
  const simulated = hub.source === "simulated";
  return {
    gazeSource: hub.source,
    calibrated: hub.calibrated,
    calibrationQuality: simulated ? "good" : (hub.calibration?.quality ?? null),
    calibrationStale: !simulated && Boolean(hub.calibration) && calibrationStale,
    legacyCalibration: !simulated && hub.isLegacyCalibration,
    // The pointer is precise; webcam gaze uses the measured calibration error.
    gazeSigmaPx: simulated
      ? { x: CV_CONFIG.uncertainty.simulatedSigmaPx, y: CV_CONFIG.uncertainty.simulatedSigmaPx }
      : gazeSigmaPx(hub.calibration),
    gazePrecisionPx: simulated ? null : gazePrecisionPx(hub.calibration),
    driftSuspected: !simulated && drift.suspected,
  };
}
