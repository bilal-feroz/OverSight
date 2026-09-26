"use client";

import { useEffect, useRef } from "react";
import { CircleCheck, CircleDashed, TriangleAlert } from "lucide-react";
import { getGazeHub } from "@/lib/cv/gaze-hub";
import { useCvStore } from "@/lib/store/cv-store";
import { cn } from "@/lib/utils";

/**
 * Local framing preview (mirrored). Rendered from the same MediaStream the
 * landmarker reads; nothing is recorded. No landmarks or boxes are drawn on
 * the face: this is only to help the user frame themselves.
 */
export function CameraPreview({ className }: { className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const status = useCvStore((s) => s.cameraStatus);
  const faces = useCvStore((s) => s.faceCount);

  useEffect(() => {
    const video = videoRef.current;
    const stream = getGazeHub().camera.stream;
    if (!video || !stream || status !== "active") return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
    return () => {
      video.srcObject = null;
    };
  }, [status]);

  return (
    <div className={cn("relative aspect-video overflow-hidden rounded-xl border border-line bg-canvas", className)}>
      <video
        ref={videoRef}
        muted
        playsInline
        aria-label="Local camera preview (not recorded)"
        className="size-full -scale-x-100 object-cover opacity-80"
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute left-1/2 top-1/2 h-[64%] w-[30%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-2 border-dashed transition-colors",
          faces === 1 ? "border-safe/70" : faces > 1 ? "border-warn/70" : "border-fg-subtle/50",
        )}
      />
      <div className="absolute bottom-2 left-2 rounded-md bg-canvas/80 px-2 py-1 font-mono text-[10.5px] text-fg-muted">
        Local preview · not recorded
      </div>
    </div>
  );
}

export function CameraChecks() {
  const status = useCvStore((s) => s.cameraStatus);
  const faces = useCvStore((s) => s.faceCount);
  const head = useCvStore((s) => s.head);
  const scale = useCvStore((s) => s.faceScale);

  const facing = head ? Math.abs(head.yaw) < 20 && Math.abs(head.pitch) < 22 : false;
  const distance =
    scale === null ? null : scale < 0.055 ? "far" : scale > 0.2 ? "close" : "ok";

  const items: Array<{ label: string; state: "ok" | "wait" | "warn"; hint?: string }> = [
    { label: "Camera active (processed on this device)", state: status === "active" ? "ok" : "wait" },
    {
      label: faces > 1 ? "More than one face in view" : "Face detected",
      state: faces === 1 ? "ok" : faces > 1 ? "warn" : "wait",
      hint: faces > 1 ? "Attention signals are marked unreliable with multiple people in frame." : undefined,
    },
    {
      label: "Facing the screen",
      state: faces === 1 && facing ? "ok" : faces === 1 ? "warn" : "wait",
      hint: faces === 1 && !facing ? "Face the screen directly, camera roughly at eye level." : undefined,
    },
    {
      label: distance === "far" ? "Move a little closer" : distance === "close" ? "Move back slightly" : "Comfortable distance",
      state: distance === "ok" ? "ok" : distance === null ? "wait" : "warn",
      hint: distance && distance !== "ok" ? "About an arm's length (50–70 cm) works best." : undefined,
    },
  ];

  return (
    <ul className="space-y-2.5" aria-live="polite">
      {items.map((item) => (
        <li key={item.label} className="flex items-start gap-2.5 text-[13.5px]">
          {item.state === "ok" ? (
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-safe" aria-hidden />
          ) : item.state === "warn" ? (
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          ) : (
            <CircleDashed className="mt-0.5 size-4 shrink-0 text-fg-subtle motion-safe:animate-spin [animation-duration:3s]" aria-hidden />
          )}
          <span>
            <span className={item.state === "ok" ? "text-fg" : "text-fg-muted"}>{item.label}</span>
            {item.hint && <span className="block text-[12px] text-fg-subtle">{item.hint}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
