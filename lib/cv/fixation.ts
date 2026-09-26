/**
 * Streaming dispersion-threshold (I-DT) fixation detector. The dispersion
 * threshold is set from the calibration error, so noisy webcam gaze does
 * not fragment one real fixation into many.
 */
export interface Fixation {
  start: number;
  end: number;
  duration: number;
  x: number;
  y: number;
}

interface Pt {
  t: number;
  x: number;
  y: number;
}

function dispersion(pts: Pt[]): number {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return maxX - minX + (maxY - minY);
}

function toFixation(pts: Pt[]): Fixation {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  const start = pts[0].t;
  const end = pts[pts.length - 1].t;
  return { start, end, duration: end - start, x: x / pts.length, y: y / pts.length };
}

export class FixationDetector {
  private pts: Pt[] = [];
  private active = false;

  constructor(
    private dispersionPx: number,
    private readonly minDurationMs: number,
  ) {}

  setDispersion(px: number) {
    this.dispersionPx = px;
  }

  /** Adds a gaze sample; returns a fixation when one just ended. */
  push(t: number, x: number, y: number): Fixation | null {
    this.pts.push({ t, x, y });
    if (dispersion(this.pts) <= this.dispersionPx) {
      if (!this.active && this.pts[this.pts.length - 1].t - this.pts[0].t >= this.minDurationMs) {
        this.active = true;
      }
      return null;
    }
    const last = this.pts.pop() as Pt;
    const completed = this.active && this.pts.length > 0 ? toFixation(this.pts) : null;
    this.active = false;
    this.pts = [last];
    return completed;
  }

  /** The fixation in progress, if the current window already qualifies. */
  current(): Fixation | null {
    return this.active && this.pts.length > 0 ? toFixation(this.pts) : null;
  }

  flush(): Fixation | null {
    const f = this.current();
    this.pts = [];
    this.active = false;
    return f;
  }
}
