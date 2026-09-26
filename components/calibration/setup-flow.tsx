"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Camera, EyeOff, LockKeyhole, RotateCcw, ShieldCheck, TriangleAlert, VideoOff } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/misc";
import { getGazeHub } from "@/lib/cv/gaze-hub";
import type { FitResult } from "@/lib/cv/calibration";
import { useCvStore } from "@/lib/store/cv-store";
import { cn } from "@/lib/utils";
import { CalibrationRunner } from "./calibration-runner";
import { CameraChecks, CameraPreview } from "./camera-preview";
import { ExplainerVideoButton } from "./explainer-video";
import { GazeCheckGrid } from "./gaze-check";

type Step = "intro" | "camera" | "calibrating" | "result";

const QUALITY_COPY = {
  good: { title: "Calibration: Good", tone: "text-safe" },
  fair: { title: "Calibration: Fair", tone: "text-intel" },
  poor: { title: "Recalibration recommended", tone: "text-warn" },
} as const;

export function SetupFlow() {
  const router = useRouter();
  const status = useCvStore((s) => s.cameraStatus);
  const error = useCvStore((s) => s.cameraError);
  const faces = useCvStore((s) => s.faceCount);
  const calibration = useCvStore((s) => s.calibration);
  const [rawStep, setStep] = useState<Step>("intro");
  const [fitError, setFitError] = useState<string | null>(null);
  // Once the camera runs (e.g. arriving via "Recalibrate"), the intro is skipped.
  const step: Step = rawStep === "intro" && status === "active" ? "camera" : rawStep;

  const enableCamera = async () => {
    setFitError(null);
    await getGazeHub().startCamera();
  };

  const startCalibration = () => {
    setFitError(null);
    setStep("calibrating");
  };

  const onCalibrated = (result: FitResult) => {
    if (!result.model) {
      setFitError(result.reason ?? "Calibration failed.");
      setStep("camera");
      return;
    }
    getGazeHub().setCalibration(result.model);
    setStep("result");
  };

  // Space starts calibration from the camera step.
  useEffect(() => {
    if (step !== "camera") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && faces === 1) {
        e.preventDefault();
        startCalibration();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, faces]);

  if (step === "calibrating") {
    return <CalibrationRunner onDone={onCalibrated} onCancel={() => setStep("camera")} />;
  }

  if (step === "result" && calibration) {
    const q = QUALITY_COPY[calibration.quality];
    return (
      <div className="fixed inset-0 bg-canvas">
        <GazeCheckGrid />
        <div className="relative grid h-full place-items-center p-4">
          <div className="w-full max-w-[440px] rounded-xl border border-line-strong bg-raised/95 p-6 shadow-2xl backdrop-blur">
            <div className="eyebrow">Step 3 · Check</div>
            <h1 className={cn("mt-2 text-2xl font-semibold tracking-tight", q.tone)}>{q.title}</h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-fg-muted">
              Look at different parts of the screen: the tile under your estimated gaze lights up. Estimated error is
              about ±{Math.max(10, Math.round(calibration.errorPx.x / 10) * 10)} px horizontally and ±
              {Math.max(10, Math.round(calibration.errorPx.y / 10) * 10)} px vertically (leave-one-point-out). Commodity webcam gaze is
              approximate, so OverSight checks attention against whole regions, not words.
            </p>
            {calibration.quality === "poor" && (
              <p className="mt-3 flex gap-2 rounded-md border border-warn/35 bg-warn/[0.07] px-3 py-2 text-[12.5px] text-warn">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Improve lighting on your face, keep your head still, and recalibrate.
              </p>
            )}
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => router.push("/console")}>
                Open approval console <ArrowRight aria-hidden />
              </Button>
              <Button variant="secondary" onClick={startCalibration}>
                <RotateCcw aria-hidden /> Recalibrate
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const failed = status === "denied" || status === "unavailable" || status === "error";

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="flex h-14 items-center justify-between border-b border-line px-5">
        <Logo />
        <Link href="/console" className="text-[13px] text-fg-muted hover:text-fg">
          Skip to console
        </Link>
      </header>
      <main id="main" className="mx-auto grid max-w-[1080px] gap-10 px-5 py-10 md:grid-cols-[1.05fr_1fr] md:py-16">
        <section>
          <ExplainerVideoButton className="mb-6" />
          <div className="eyebrow">{step === "intro" ? "Step 1 · Permission" : "Step 2 · Camera check"}</div>
          <h1 className="mt-3 text-[34px] font-semibold leading-[1.1] tracking-[-0.025em] md:text-[40px]">
            On-device attention signals
          </h1>
          <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-fg-muted">
            OverSight processes eye and face landmarks locally to estimate whether decision-critical information was
            visually inspected.
          </p>
          <p className="mt-3 inline-flex items-center gap-2 text-[15px] font-medium text-fg">
            <LockKeyhole className="size-4 text-safe" aria-hidden /> Video never leaves this device.
          </p>

          <ul className="mt-7 space-y-3 text-[13.5px] text-fg-muted">
            <Bullet icon={<ShieldCheck className="size-4 text-safe" aria-hidden />}>
              Runs in this browser tab (MediaPipe, WebAssembly). Frames are read in memory and reduced to a few numbers.
              Nothing is uploaded or stored.
            </Bullet>
            <Bullet icon={<EyeOff className="size-4 text-fg-subtle" aria-hidden />}>
              No facial recognition, no identity, no age, gender or emotion inference, no fatigue diagnosis.
            </Bullet>
            <Bullet icon={<Camera className="size-4 text-intel" aria-hidden />}>
              Derived signals only: estimated gaze point, dwell per request region, head orientation, face present.
            </Bullet>
            <Bullet icon={<VideoOff className="size-4 text-fg-subtle" aria-hidden />}>
              Prefer not to? OverSight works without a camera using interaction timing, with manual acknowledgement for
              critical consequences.
            </Bullet>
          </ul>
        </section>

        <section aria-live="polite">
          {status === "active" ? (
            <div className="space-y-5">
              <CameraPreview />
              <CameraChecks />
              {fitError && (
                <p className="flex gap-2 rounded-md border border-warn/35 bg-warn/[0.07] px-3 py-2 text-[13px] text-warn">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {fitError} Make sure your face stays
                  visible and try again.
                </p>
              )}
              <div className="rounded-xl border border-line bg-raised p-4">
                <p className="text-[13.5px] text-fg">Calibration takes about 15 seconds.</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
                  Sit about an arm&apos;s length away. Keep your head still and follow a dot across 9 positions with your
                  eyes. Do not resize the window afterwards.
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button variant="primary" onClick={startCalibration} disabled={faces !== 1}>
                    Start calibration
                  </Button>
                  <span className="text-[12px] text-fg-subtle">
                    or press <Kbd>Space</Kbd>
                  </span>
                  {calibration && (
                    <Button variant="ghost" onClick={() => router.push("/console")} className="ml-auto">
                      Keep current calibration
                    </Button>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => getGazeHub().stopCamera()}
                className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-subtle underline-offset-2 hover:text-fg hover:underline"
              >
                <VideoOff className="size-3.5" aria-hidden /> Turn camera off
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-line bg-raised p-6">
              {failed ? (
                <>
                  <div className="flex items-center gap-2 text-warn">
                    <TriangleAlert className="size-4" aria-hidden />
                    <span className="font-medium">Camera attention signals unavailable</span>
                  </div>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-fg-muted">{error}</p>
                  {status === "denied" && (
                    <p className="mt-2 text-[12.5px] text-fg-subtle">
                      To retry, allow camera access for this site in your browser&apos;s address-bar permissions, then
                      press Try again.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <div className="grid size-11 place-items-center rounded-xl border border-line-strong bg-surface">
                    <Camera className="size-5 text-intel" aria-hidden />
                  </div>
                  <h2 className="mt-4 text-lg font-semibold">Enable camera</h2>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-muted">
                    Your browser will ask for permission. The camera feed is processed locally and is never recorded.
                  </p>
                </>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  onClick={enableCamera}
                  disabled={status === "requesting" || status === "loading-model"}
                >
                  {status === "requesting"
                    ? "Waiting for permission…"
                    : status === "loading-model"
                      ? "Loading on-device model…"
                      : failed
                        ? "Try again"
                        : "Enable camera"}
                </Button>
                <Button variant="secondary" onClick={() => router.push("/console")}>
                  Continue without camera
                </Button>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function Bullet({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}
