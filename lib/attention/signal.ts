import { gazeSigmaPx } from "@/lib/cv/calibration";
import { getGazeHub } from "@/lib/cv/gaze-hub";
import { useCvStore } from "@/lib/store/cv-store";
import type { ReviewSessionOptions } from "./tracker";

export type GazeSignal = Pick<ReviewSessionOptions, "gazeSource" | "calibrated" | "calibrationQuality" | "gazeSigmaPx">;

/** The current gaze signal as the attention tracker should see it. */
export function currentGazeSignal(): GazeSignal {
  const hub = getGazeHub();
  const { calibrationStale } = useCvStore.getState();
  const simulated = hub.source === "simulated";
  return {
    gazeSource: hub.source,
    calibrated: hub.calibrated,
    calibrationQuality: simulated
      ? "good"
      : hub.calibration
        ? calibrationStale
          ? "poor"
          : hub.calibration.quality
        : null,
    // The pointer is precise; webcam gaze uses the measured calibration error.
    gazeSigmaPx: simulated ? { x: 20, y: 20 } : gazeSigmaPx(hub.calibration),
  };
}
