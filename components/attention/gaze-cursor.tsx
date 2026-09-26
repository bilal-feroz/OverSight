"use client";

import { useEffect, useRef } from "react";
import { getGazeHub } from "@/lib/cv/gaze-hub";
import { cn } from "@/lib/utils";

/**
 * Follows the smoothed gaze estimate, updated per frame outside React.
 * `variant="debug"` is a crisp crosshair (diagnostics); `variant="soft"` is
 * a diffuse glow used by the attention overlay.
 */
export function GazeCursor({ variant = "debug" }: { variant?: "debug" | "soft" }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hub = getGazeHub();
    return hub.onFrame((frame) => {
      const el = ref.current;
      if (!el) return;
      if (!frame.gaze) {
        el.style.opacity = "0";
        return;
      }
      const x = frame.gaze.x * window.innerWidth;
      const y = frame.gaze.y * window.innerHeight;
      el.style.opacity = frame.held ? "0.5" : "1";
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    });
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 z-[60] opacity-0 transition-opacity duration-150"
      style={{ willChange: "transform" }}
    >
      {variant === "debug" ? (
        <div className="-translate-x-1/2 -translate-y-1/2">
          <div className="relative size-7 rounded-full border-2 border-intel/90 shadow-[0_0_0_4px_rgba(69,200,240,0.12)]">
            <div className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-intel" />
          </div>
        </div>
      ) : (
        <div
          className={cn(
            "size-24 -translate-x-1/2 -translate-y-1/2 rounded-full",
            "bg-[radial-gradient(circle,rgba(69,200,240,0.28)_0%,rgba(69,200,240,0.08)_45%,transparent_70%)]",
          )}
        />
      )}
    </div>
  );
}
