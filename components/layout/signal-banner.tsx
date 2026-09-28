"use client";

import Link from "next/link";
import { MousePointer2, TriangleAlert, VideoOff } from "lucide-react";
import { bannerKind } from "@/lib/attention/banner";
import { getGazeHub } from "@/lib/cv/gaze-hub";
import { useCvStore } from "@/lib/store/cv-store";
import { useLiveStore } from "@/lib/store/live-store";
import { useUiStore } from "@/lib/store/ui-store";
import { cn } from "@/lib/utils";

/**
 * Persistent, honest status line: simulated input is always labeled, and a
 * missing, uncalibrated or untrustworthy gaze signal is explained rather than
 * hidden. Precedence: lib/attention/banner.ts.
 */
export function SignalBanner() {
  const simulated = useCvStore((s) => s.simulated);
  const status = useCvStore((s) => s.cameraStatus);
  const error = useCvStore((s) => s.cameraError);
  const calibration = useCvStore((s) => s.calibration);
  const stale = useCvStore((s) => s.calibrationStale);
  const driftSuspected = useCvStore((s) => s.drift.suspected);
  const trust = useLiveStore((s) => s.trust);
  const setRecheckOpen = useUiStore((s) => s.setRecheckOpen);

  const kind = bannerKind({
    simulated,
    cameraStatus: status,
    calibrated: calibration !== null,
    calibrationQuality: calibration?.quality ?? null,
    calibrationStale: stale,
    driftSuspected,
    liveTrust: trust?.level ?? null,
  });
  const warn = <TriangleAlert className="size-3.5" aria-hidden />;
  const recalibrate = (label: string) => (
    <Link href="/setup#calibrate" className="ml-2 underline underline-offset-2 hover:text-fg">
      {label}
    </Link>
  );

  switch (kind) {
    case "simulated":
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
    case "uncalibrated":
      return (
        <Bar tone="warn" icon={warn}>
          Camera active, gaze not calibrated. OverSight is using interaction timing only.
          {recalibrate("Calibrate (~35 s)")}
        </Bar>
      );
    case "stale":
      return (
        <Bar tone="warn" icon={warn}>
          <strong className="font-semibold">Calibration stale: recalibrate.</strong> The window moved, was resized or zoomed since
          calibration, so gaze is not used.
          {recalibrate("Recalibrate (~35 s)")}
        </Bar>
      );
    case "poor":
      return (
        <Bar tone="warn" icon={warn}>
          <strong className="font-semibold">Gaze uncertain: using interaction timing.</strong> Calibration quality is low, so gaze is
          not used for decisions.
          {recalibrate("Recalibrate (~35 s)")}
        </Bar>
      );
    case "drift":
      return (
        <Bar tone="warn" icon={warn}>
          <strong className="font-semibold">Possible drift: quick recheck.</strong> Clicks suggest gaze has shifted since calibration,
          so OverSight trusts it less.
          <button type="button" onClick={() => setRecheckOpen(true)} className="ml-2 underline underline-offset-2 hover:text-fg">
            Quick recheck (≈5 s)
          </button>
        </Bar>
      );
    case "uncertain":
      return (
        <Bar tone="warn" icon={warn}>
          <strong className="font-semibold">Gaze uncertain: using interaction timing.</strong>
          {trust?.text ? ` ${trust.text}` : ""}
          {trust?.code === "trust-separation" ? recalibrate("Recalibrate (~35 s)") : null}
        </Bar>
      );
    case "camera-off":
      return (
        <Bar tone="neutral" icon={<VideoOff className="size-3.5" aria-hidden />}>
          Camera attention signals unavailable{error ? ` (${error.replace(/\.$/, "")})` : ""}. OverSight is using interaction timing
          only.
          <Link href="/setup" className="ml-2 underline underline-offset-2 hover:text-fg">
            Set up camera
          </Link>
        </Bar>
      );
    default:
      return null;
  }
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
