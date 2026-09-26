/**
 * One Euro filter (Casiez et al., CHI 2012): low jitter when the gaze is
 * still, low lag when it moves. Timestamps in seconds.
 */
class LowPass {
  value: number | null = null;
  filter(x: number, alpha: number): number {
    this.value = this.value === null ? x : alpha * x + (1 - alpha) * this.value;
    return this.value;
  }
}

function alpha(dt: number, cutoff: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuroFilter {
  private x = new LowPass();
  private dx = new LowPass();
  private lastT: number | null = null;

  constructor(
    private readonly minCutoff: number,
    private readonly beta: number,
    private readonly dCutoff: number,
  ) {}

  reset() {
    this.x = new LowPass();
    this.dx = new LowPass();
    this.lastT = null;
  }

  filter(value: number, tSec: number): number {
    if (this.lastT === null) {
      this.lastT = tSec;
      this.dx.filter(0, 1);
      return this.x.filter(value, 1);
    }
    const dt = Math.max(1e-3, tSec - this.lastT);
    this.lastT = tSec;
    const prev = this.x.value ?? value;
    const edx = this.dx.filter((value - prev) / dt, alpha(dt, this.dCutoff));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.x.filter(value, alpha(dt, cutoff));
  }
}

export class OneEuroFilter2D {
  private fx: OneEuroFilter;
  private fy: OneEuroFilter;

  constructor(minCutoff: number, beta: number, dCutoff: number) {
    this.fx = new OneEuroFilter(minCutoff, beta, dCutoff);
    this.fy = new OneEuroFilter(minCutoff, beta, dCutoff);
  }

  reset() {
    this.fx.reset();
    this.fy.reset();
  }

  filter(x: number, y: number, tSec: number): { x: number; y: number } {
    return { x: this.fx.filter(x, tSec), y: this.fy.filter(y, tSec) };
  }
}
