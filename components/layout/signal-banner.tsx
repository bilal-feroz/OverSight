"use client";

import Link from "next/link";
import { MousePointer2, TriangleAlert, VideoOff } from "lucide-react";
import { getGazeHub } from "@/lib/cv/gaze-hub";
import { useCvStore } from "@/lib/store/cv-store";
import { cn } from "@/lib/utils";

/**
 * Persistent, honest status line: simulated input is always labeled, and a
 * missing / uncalibrated camera is explained rather than hidden.
 */
export function SignalBanner() {
  const simulated = useCvStore((s) => s.simulated);
  const status = useCvStore((s) => s.cameraStatus);
  const error = useCvStore((s) => s.cameraError);
  const calibration = useCvStore((s) => s.calibration);
  const stale = useCvStore((s) => s.calibrationStale);

  if (simulated) {
    return (
      <Bar tone="warn" icon={<MousePointer2 className="size-3.5" aria-hidden />}>
        <strong className="font-semibold">SIMULATED GAZE:</strong> the pointer position is used as a gaze proxy. This is not camera
        evidence.
        <button
          type="button"
          onClick={() => getGazeHub().setSimulated(false)}
          className="ml-2 underline underline-offset-2 hover:text-fg"
        >
          Turn off
        </button>
      </Bar>
    );
  }
  if (status === "active" && !calibration) {
    return (
      <Bar tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
        Camera active, gaze not calibrated. OverSight is using interaction timing only.
        <Link href="/setup#calibrate" className="ml-2 underline underline-offset-2 hover:text-fg">
          Calibrate (~15 s)
        </Link>
      </Bar>
    );
  }
  if (status === "active" && calibration && (stale || calibration.quality === "poor")) {
    return (
      <Bar tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
        {stale
          ? "The window moved, was resized or zoomed since calibration. Gaze is not used until you recalibrate."
          : "Calibration quality is low. Gaze is not used for decisions; OverSight relies on interaction timing."}
        <Link href="/setup#calibrate" className="ml-2 underline underline-offset-2 hover:text-fg">
          Recalibrate
        </Link>
      </Bar>
    );
  }
  if (status !== "active" && status !== "requesting" && status !== "loading-model") {
    return (
      <Bar tone="neutral" icon={<VideoOff className="size-3.5" aria-hidden />}>
        Camera attention signals unavailable{error ? ` (${error.replace(/\.$/, "")})` : ""}. OverSight is using interaction
        timing only.
        <Link href="/setup" className="ml-2 underline underline-offset-2 hover:text-fg">
          Set up camera
        </Link>
      </Bar>
    );
  }
  return null;
}

function Bar({ tone, icon, children }: { tone: "warn" | "neutral"; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2 border-b px-4 py-1.5 text-[12.5px]",
        tone === "warn" ? "border-warn/25 bg-warn/[0.07] text-warn" : "border-line bg-raised text-fg-muted",
      )}
    >
      {icon}
      <span>{children}</span>
    </div>
  );
}
