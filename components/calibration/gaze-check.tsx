"use client";

import { useEffect, useState } from "react";
import { getGazeHub } from "@/lib/cv/gaze-hub";
import { cn } from "@/lib/utils";

/**
 * Live 3x3 check behind the calibration result: the tile the gaze estimate
 * falls in lights up, so the user (and judges) can see the mapping work.
 */
export function GazeCheckGrid() {
  const [tile, setTile] = useState<number | null>(null);

  useEffect(() => {
    let last = 0;
    return getGazeHub().onFrame((frame) => {
      const now = performance.now();
      if (now - last < 80) return;
      last = now;
      if (!frame.gaze) {
        setTile(null);
        return;
      }
      const { x, y } = frame.gaze;
      if (x < 0 || x > 1 || y < 0 || y > 1) {
        setTile(null);
        return;
      }
      setTile(Math.min(2, Math.floor(y * 3)) * 3 + Math.min(2, Math.floor(x * 3)));
    });
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 grid grid-cols-3 grid-rows-3" aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <div
          key={i}
          className={cn(
            "border border-line/60 transition-colors duration-150",
            tile === i ? "bg-intel/[0.12] shadow-[inset_0_0_0_1px_rgba(206,215,227,0.45)]" : "bg-transparent",
          )}
        />
      ))}
    </div>
  );
}
