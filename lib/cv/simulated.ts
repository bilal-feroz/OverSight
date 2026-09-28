/**
 * SIMULATED gaze source: uses the pointer position as a gaze proxy.
 *
 * For development and rehearsing without a camera only. Whenever it is on,
 * the UI shows a persistent "Simulated gaze" banner and every assessment
 * carries a "simulated" reason. The judging demo uses the live camera.
 *
 * Production builds refuse it: otherwise a reviewer could satisfy a pause by
 * hovering the mouse over the consequence.
 */
import type { GazeFrame } from "@/types/cv";

/** Simulated gaze exists only outside production builds. */
export function isSimulationAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

export class SimulatedGazeSource {
  private x = 0.5;
  private y = 0.5;
  private timer: number | null = null;

  private onMove = (e: PointerEvent) => {
    this.x = e.clientX / window.innerWidth;
    this.y = e.clientY / window.innerHeight;
  };

  start(emit: (frame: GazeFrame) => void) {
    if (this.timer !== null) return;
    window.addEventListener("pointermove", this.onMove, { passive: true });
    this.timer = window.setInterval(() => {
      const t = performance.now();
      emit({
        t,
        source: "simulated",
        faceCount: 1,
        features: null,
        gaze: { x: this.x, y: this.y },
        gazeRaw: { x: this.x, y: this.y },
        held: false,
        inferenceMs: 0,
      });
    }, 33);
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener("pointermove", this.onMove);
  }

  get running() {
    return this.timer !== null;
  }
}
