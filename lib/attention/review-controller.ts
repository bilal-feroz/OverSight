/**
 * Owns the ReviewSession for the approval currently on screen: wires gaze
 * frames and pointer events into it, ticks it every animation frame, and
 * publishes live measurements to the UI at ~8 Hz and live gaze trust at ~1 Hz.
 */
import { getGazeHub } from "@/lib/cv/gaze-hub";
import { EMPTY_LIVE, useLiveStore } from "@/lib/store/live-store";
import { ATTENTION_CONFIG } from "./config";
import { liveTrust } from "./live-trust";
import { ReviewSession, type ReviewSessionOptions } from "./tracker";

class ReviewController {
  session: ReviewSession | null = null;
  private raf: number | null = null;
  private unsubscribe: (() => void) | null = null;
  private lastPush = 0;
  private lastTrust = 0;

  private onPointer = (e: PointerEvent) => {
    this.session?.onPointerMove(e.clientX, e.clientY);
  };

  /** Geometry is re-read at most every 100 ms, but at once after a scroll or resize. */
  private onLayout = () => {
    this.session?.invalidateGeometry();
  };

  begin(opts: ReviewSessionOptions): ReviewSession {
    this.end();
    const session = new ReviewSession(opts);
    this.session = session;
    this.lastTrust = 0;
    // Live state is pushed from both camera frames and animation frames, so the UI
    // stays current even if rendering is throttled.
    this.unsubscribe = getGazeHub().onFrame((frame) => {
      this.session?.onFrame(frame);
      this.maybePush(performance.now());
    });
    window.addEventListener("pointermove", this.onPointer, { passive: true });
    // Capture phase: scroll events of the request's scroll container do not bubble.
    window.addEventListener("scroll", this.onLayout, { passive: true, capture: true });
    window.addEventListener("resize", this.onLayout, { passive: true });
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      const now = performance.now();
      this.session?.tick(now);
      this.maybePush(now);
    };
    this.raf = requestAnimationFrame(loop);
    return session;
  }

  private maybePush(now: number) {
    if (!this.session || now - this.lastPush < 120) return;
    this.lastPush = now;
    useLiveStore.setState(this.session.live());
    if (now - this.lastTrust >= ATTENTION_CONFIG.trust.liveUpdateMs) {
      this.lastTrust = now;
      useLiveStore.setState({ trust: liveTrust(this.session) });
    }
  }

  end() {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (typeof window !== "undefined") {
      window.removeEventListener("pointermove", this.onPointer);
      window.removeEventListener("scroll", this.onLayout, { capture: true });
      window.removeEventListener("resize", this.onLayout);
    }
    this.session = null;
    useLiveStore.setState(EMPTY_LIVE);
  }

  /** Pushes live state immediately (e.g. right after a phase change). */
  flush() {
    if (this.session) useLiveStore.setState(this.session.live());
  }
}

export const reviewController = new ReviewController();
