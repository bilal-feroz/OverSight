"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Play, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const VIDEO_SRC = "/videos/oversight-explainer.mp4";

/** OverSight as a 10-second video, for everyone who scrolls straight past the copy. */
export function ExplainerVideoButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const titleId = useId();

  // Focus moves to the player on open (so Space pauses it) and back to the trigger on close.
  useEffect(() => {
    if (!open) return;
    const returnTo = trigger.current;
    video.current?.focus();
    return () => returnTo?.focus();
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={cn(buttonVariants({ variant: "shiny", size: "sm" }), className)}
      >
        i ain&apos;t reading allat
        <Play aria-hidden />
        <span className="sr-only">: watch a 10-second video instead</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[70] grid place-items-center bg-canvas/80 p-4 backdrop-blur-sm"
          onMouseDown={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            // Keys stay inside the dialog, so page shortcuts never fire while the video plays.
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") setOpen(false);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="stage-glow w-full max-w-3xl animate-rise-in rounded-2xl border border-line-strong bg-raised p-4 outline-none sm:p-5"
          >
            <div className="mb-3 flex items-center justify-between gap-4">
              <h2 id={titleId} className="text-[15px] font-semibold">
                OverSight in 10 seconds
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close video"
                className="rounded-md p-1 text-fg-subtle hover:bg-surface hover:text-fg"
              >
                <X className="size-4" />
              </button>
            </div>
            <video
              ref={video}
              src={VIDEO_SRC}
              controls
              autoPlay
              playsInline
              preload="auto"
              className="aspect-video w-full rounded-lg bg-black"
            />
          </div>
        </div>
      )}
    </>
  );
}
