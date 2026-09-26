/**
 * ReviewSession: live measurement for one approval request.
 *
 * Every gaze frame is mapped onto the bounding boxes of the registered
 * semantic regions (with a noise margin from calibration error). The
 * session accumulates only derived numbers: dwell per region, visibility,
 * fixations, scroll depth, pointer distance. `snapshot()` hands them to the
 * deterministic AttentionEngine when the reviewer clicks Approve.
 */
import type { RiskLevel } from "@/types/approval";
import type {
  FrameCounts,
  GazeSampleRecord,
  RectLike,
  RegionMeta,
  ReReviewState,
  ReviewSnapshot,
  TargetStats,
} from "@/types/attention";
import type { CalibrationQuality, GazeFrame, GazeSourceKind } from "@/types/cv";
import { FixationDetector, type Fixation } from "@/lib/cv/fixation";
import { clamp } from "@/lib/utils";
import type { LiveState } from "@/lib/store/live-store";
import { ATTENTION_CONFIG } from "./config";
import {
  binIndex,
  bottom,
  containsPoint,
  expandRect,
  hitMargin,
  intersect,
  rectFromDOM,
  relativeTo,
  right,
  severityWeight,
  sweepCoverage,
  visibleFraction,
} from "./regions";
import { regionRegistry } from "./registry";
import { stepReReview } from "./rereview";

export interface ReviewTarget {
  id: string;
  label: string;
  severity: RiskLevel;
  words: number;
  requiredDwellMs: number;
}

export interface ReviewSessionOptions {
  approvalId: string;
  targets: ReviewTarget[];
  getCard: () => HTMLElement | null;
  getScrollContainer: () => HTMLElement | null;
  gazeSource: GazeSourceKind;
  calibrated: boolean;
  calibrationQuality: CalibrationQuality | null;
  gazeSigmaPx: { x: number; y: number } | null;
}

interface TargetAcc extends ReviewTarget {
  dwellMs: number;
  visibleMs: number;
  hoverMs: number;
  fixations: number;
  firstFixationMs: number | null;
  bins: number[];
}

interface Geometry {
  meta: RegionMeta;
  rect: RectLike;
  visible: RectLike | null;
  fraction: number;
}

const MAX_SAMPLES = 1800;

function distanceToRect(r: RectLike, x: number, y: number): number {
  const dx = Math.max(r.left - x, 0, x - right(r));
  const dy = Math.max(r.top - y, 0, y - bottom(r));
  return Math.hypot(dx, dy);
}

export class ReviewSession {
  readonly approvalId: string;
  readonly openedAt: number;
  phase: "reviewing" | "rereview" | "closed" = "reviewing";
  reReview: ReReviewState | null = null;
  currentRegionId: string | null = null;
  lastGazePx: { x: number; y: number } | null = null;

  private opts: ReviewSessionOptions;
  private readonly cfg = ATTENTION_CONFIG.targets;
  private readonly signalCfg = ATTENTION_CONFIG.signal;
  private frames: FrameCounts = { total: 0, face: 0, multiFace: 0, facing: 0, gaze: 0, onScreen: 0 };
  private targets: Map<string, TargetAcc>;
  private regionDwell = new Map<string, number>();
  private cardGazeMs = 0;
  private offCardGazeMs = 0;
  private offScreenMs = 0;
  private scrollDepth = 0;
  private pointerDistance = 0;
  private pointer: { x: number; y: number } | null = null;
  private focusedMs = 0;
  private samples: GazeSampleRecord[] = [];
  private lastSampleT = -Infinity;
  private lastGazeT: number | null = null;
  private lastTick: number;
  private fixations: FixationDetector;
  private geometry = new Map<string, Geometry>();
  private cardRect: RectLike | null = null;
  private margin: { x: number; y: number };
  private frozenElapsed: number | null = null;
  private lastOnCard = false;

  constructor(opts: ReviewSessionOptions) {
    this.opts = opts;
    this.approvalId = opts.approvalId;
    this.openedAt = performance.now();
    this.lastTick = this.openedAt;
    this.targets = new Map(
      opts.targets.map((t) => [
        t.id,
        {
          ...t,
          dwellMs: 0,
          visibleMs: 0,
          hoverMs: 0,
          fixations: 0,
          firstFixationMs: null,
          bins: new Array<number>(this.cfg.sweepBins).fill(0),
        },
      ]),
    );
    this.margin = hitMargin(opts.gazeSigmaPx);
    const sigma = opts.gazeSigmaPx ? Math.max(opts.gazeSigmaPx.x, opts.gazeSigmaPx.y) : 0;
    this.fixations = new FixationDetector(
      Math.max(this.cfg.fixationMinDispersionPx, sigma * this.cfg.fixationSigmaFactor),
      this.cfg.fixationMinDurationMs,
    );
    this.refreshGeometry();
  }

  /**
   * The gaze signal can change while a request is open (camera finishing
   * start-up after a reload, calibration completed, simulation toggled).
   * Frames are counted from the moment they arrive, so nothing is back-filled.
   */
  updateSignal(signal: Pick<ReviewSessionOptions, "gazeSource" | "calibrated" | "calibrationQuality" | "gazeSigmaPx">) {
    this.opts = { ...this.opts, ...signal };
    this.margin = hitMargin(signal.gazeSigmaPx);
    const sigma = signal.gazeSigmaPx ? Math.max(signal.gazeSigmaPx.x, signal.gazeSigmaPx.y) : 0;
    this.fixations.setDispersion(Math.max(this.cfg.fixationMinDispersionPx, sigma * this.cfg.fixationSigmaFactor));
  }

  get gazeMarginPx() {
    return this.margin;
  }

  get targetIds(): string[] {
    return [...this.targets.keys()];
  }

  /** Card-relative gaze samples recorded during the initial review (for the heatmap). */
  get gazeSamples(): readonly GazeSampleRecord[] {
    return this.samples;
  }

  refreshGeometry() {
    let clip: RectLike = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const container = this.opts.getScrollContainer();
    if (container) {
      const c = intersect(clip, rectFromDOM(container.getBoundingClientRect()));
      if (c) clip = c;
    }
    const card = this.opts.getCard();
    this.cardRect = card ? rectFromDOM(card.getBoundingClientRect()) : null;
    this.geometry.clear();
    for (const { el, meta } of regionRegistry.list(this.approvalId)) {
      if (!el.isConnected) continue;
      const rect = rectFromDOM(el.getBoundingClientRect());
      if (rect.width <= 0 || rect.height <= 0) continue;
      this.geometry.set(meta.id, {
        meta,
        rect,
        visible: intersect(rect, clip),
        fraction: visibleFraction(rect, clip),
      });
    }
  }

  /** Called every animation frame: geometry, visibility, hover, focus, scroll. */
  tick(now: number) {
    const dt = clamp(now - this.lastTick, 0, 100);
    this.lastTick = now;
    this.refreshGeometry();
    if (this.phase !== "reviewing") return;
    for (const acc of this.targets.values()) {
      const g = this.geometry.get(acc.id);
      if (g && g.fraction >= this.cfg.visibleFraction) acc.visibleMs += dt;
      if (this.pointer && g?.visible && containsPoint(g.visible, this.pointer.x, this.pointer.y)) {
        acc.hoverMs += dt;
      }
    }
    if (document.visibilityState === "visible" && document.hasFocus()) this.focusedMs += dt;
    const container = this.opts.getScrollContainer();
    const depth =
      container && container.scrollHeight > 0
        ? clamp((container.scrollTop + container.clientHeight) / container.scrollHeight, 0, 1)
        : 1;
    this.scrollDepth = Math.max(this.scrollDepth, depth);
  }

  onPointerMove(x: number, y: number) {
    if (this.pointer && this.phase === "reviewing") {
      this.pointerDistance += Math.hypot(x - this.pointer.x, y - this.pointer.y);
    }
    this.pointer = { x, y };
  }

  onFrame(frame: GazeFrame) {
    if (this.phase === "closed") return;
    // If animation frames are throttled (hidden pane, power saving), keep geometry
    // and visibility current from the camera frames themselves.
    const now = performance.now();
    if (now - this.lastTick > 200) this.tick(now);
    const reviewing = this.phase === "reviewing";
    if (reviewing) {
      this.frames.total++;
      if (frame.faceCount === 1) this.frames.face++;
      else if (frame.faceCount > 1) this.frames.multiFace++;
      const f = frame.features;
      const facing =
        frame.faceCount === 1 &&
        (frame.source === "simulated" ||
          (f !== null &&
            Math.abs(f.yaw) <= this.signalCfg.facingYawDeg &&
            Math.abs(f.pitch) <= this.signalCfg.facingPitchDeg));
      if (facing) this.frames.facing++;
    }

    if (!frame.gaze) {
      this.lastGazeT = null;
      this.currentRegionId = null;
      this.lastGazePx = null;
      return;
    }
    if (reviewing) this.frames.gaze++;
    const dt = this.lastGazeT === null ? 33 : clamp(frame.t - this.lastGazeT, 0, 100);
    this.lastGazeT = frame.t;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const px = frame.gaze.x * vw;
    const py = frame.gaze.y * vh;
    this.lastGazePx = { x: px, y: py };
    const onScreen = px >= 0 && px <= vw && py >= 0 && py <= vh;

    const hits: string[] = [];
    let primary: string | null = null;
    let best = Infinity;
    if (onScreen) {
      for (const [id, g] of this.geometry) {
        if (!g.visible) continue;
        if (!containsPoint(expandRect(g.visible, this.margin.x, this.margin.y), px, py)) continue;
        hits.push(id);
        const d = distanceToRect(g.visible, px, py);
        if (d < best) {
          best = d;
          primary = id;
        }
      }
    }
    this.currentRegionId = primary;
    this.lastOnCard = !!this.cardRect && containsPoint(this.cardRect, px, py);

    if (this.phase === "rereview" && this.reReview) {
      const g = this.geometry.get(this.reReview.targetId);
      this.reReview = stepReReview(this.reReview, {
        dtMs: dt,
        targetVisible: !!g && g.fraction >= this.cfg.visibleFraction,
        gazeOnTarget: hits.includes(this.reReview.targetId),
        faceOk: frame.faceCount === 1,
      });
      return;
    }
    if (!reviewing) return;

    if (!onScreen) {
      this.offScreenMs += dt;
      this.pushSample(frame.t, px, py, null, false, false);
      return;
    }
    this.frames.onScreen++;
    if (this.lastOnCard) this.cardGazeMs += dt;
    else this.offCardGazeMs += dt;

    const oriented = frame.t - this.openedAt >= this.cfg.orientationMs;
    for (const id of hits) {
      const g = this.geometry.get(id);
      if (!g || g.meta.role === "review-target" || !oriented) continue;
      this.regionDwell.set(id, (this.regionDwell.get(id) ?? 0) + dt);
      const acc = this.targets.get(id);
      if (acc) {
        acc.dwellMs += dt;
        acc.bins[binIndex(g.rect, px, acc.bins.length)] += dt;
      }
    }
    if (oriented) {
      const fixation = this.fixations.push(frame.t, px, py);
      if (fixation) this.attributeFixation(fixation);
    }
    this.pushSample(frame.t, px, py, primary, this.lastOnCard, true);
  }

  private pushSample(t: number, x: number, y: number, regionId: string | null, onCard: boolean, onScreen: boolean) {
    if (!this.cardRect || this.samples.length >= MAX_SAMPLES || t - this.lastSampleT < 30) return;
    this.lastSampleT = t;
    this.samples.push({
      t: t - this.openedAt,
      x: x - this.cardRect.left,
      y: y - this.cardRect.top,
      regionId,
      onCard,
      onScreen,
    });
  }

  private inTarget(id: string, x: number, y: number): boolean {
    const g = this.geometry.get(id);
    return !!g?.visible && containsPoint(expandRect(g.visible, this.margin.x, this.margin.y), x, y);
  }

  private attributeFixation(fix: Fixation) {
    for (const acc of this.targets.values()) {
      if (!this.inTarget(acc.id, fix.x, fix.y)) continue;
      acc.fixations += 1;
      const t = fix.start - this.openedAt;
      acc.firstFixationMs = acc.firstFixationMs === null ? t : Math.min(acc.firstFixationMs, t);
    }
  }

  /** Stops the initial review measurement (at the approval click). */
  freeze() {
    if (this.frozenElapsed === null) this.frozenElapsed = performance.now() - this.openedAt;
    this.phase = "closed";
  }

  startReReview(state: ReReviewState) {
    this.freeze();
    this.reReview = state;
    this.phase = state.method === "gaze" ? "rereview" : "closed";
  }

  /** Switches a running re-review to manual acknowledgement. */
  useManual() {
    if (this.reReview) this.reReview = { ...this.reReview, method: "manual" };
    this.phase = "closed";
  }

  snapshot(now = performance.now()): ReviewSnapshot {
    const elapsedMs = this.frozenElapsed ?? now - this.openedAt;
    const ongoing = this.fixations.current();
    const targets: TargetStats[] = [...this.targets.values()].map((acc) => {
      let fixations = acc.fixations;
      let first = acc.firstFixationMs;
      if (ongoing && this.inTarget(acc.id, ongoing.x, ongoing.y)) {
        fixations += 1;
        const t = ongoing.start - this.openedAt;
        first = first === null ? t : Math.min(first, t);
      }
      return {
        id: acc.id,
        label: acc.label,
        severity: acc.severity,
        words: acc.words,
        requiredDwellMs: acc.requiredDwellMs,
        dwellMs: acc.dwellMs,
        visibleMs: acc.visibleMs,
        hoverMs: acc.hoverMs,
        fixations,
        firstFixationMs: first,
        sweep: sweepCoverage(acc.bins, this.cfg.sweepBinMinMs),
      };
    });
    const regionRects: ReviewSnapshot["regionRects"] = {};
    if (this.cardRect) {
      for (const [id, g] of this.geometry) {
        if (g.meta.role === "review-target") continue;
        regionRects[id] = { ...relativeTo(g.rect, this.cardRect), role: g.meta.role, label: g.meta.label };
      }
    }
    return {
      approvalId: this.approvalId,
      elapsedMs,
      gazeSource: this.opts.gazeSource,
      calibrated: this.opts.calibrated,
      calibrationQuality: this.opts.calibrationQuality,
      frames: { ...this.frames },
      targets,
      regionDwellMs: Object.fromEntries(this.regionDwell),
      cardGazeMs: this.cardGazeMs,
      offCardGazeMs: this.offCardGazeMs,
      offScreenMs: this.offScreenMs,
      scrollDepth: this.scrollDepth,
      pointerDistancePx: this.pointerDistance,
      focusedMs: this.focusedMs,
      gazeSamples: [...this.samples],
      regionRects,
      cardSize: this.cardRect
        ? { width: this.cardRect.width, height: this.cardRect.height }
        : { width: 0, height: 0 },
      gazeSigmaPx: this.opts.gazeSigmaPx,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  }

  live(): LiveState {
    const elapsedMs = this.frozenElapsed ?? performance.now() - this.openedAt;
    const targets = [...this.targets.values()].map((acc) => ({
      id: acc.id,
      dwellMs: acc.dwellMs,
      requiredDwellMs: acc.requiredDwellMs,
      visible: acc.visibleMs >= this.cfg.minVisibleForGazeMs,
    }));
    const gazeUsable = this.opts.gazeSource !== "none" && this.opts.calibrated;
    const visible = [...this.targets.values()].filter((a) => a.visibleMs >= this.cfg.minVisibleForGazeMs);
    let coverage: number | null = null;
    if (gazeUsable && visible.length) {
      let w = 0;
      let v = 0;
      for (const a of visible) {
        const weight = severityWeight(a.severity);
        w += weight;
        v += weight * Math.min(1, a.dwellMs / Math.max(1, a.requiredDwellMs));
      }
      coverage = w ? v / w : 0;
    }
    const total = this.cardGazeMs + this.offCardGazeMs;
    const criticalMs = Math.min(
      this.cardGazeMs,
      [...this.targets.keys()].reduce((acc, id) => acc + (this.regionDwell.get(id) ?? 0), 0),
    );
    return {
      approvalId: this.approvalId,
      elapsedMs,
      coverage,
      targets,
      regionId: this.currentRegionId,
      onCard: this.lastOnCard,
      gazeActive: this.lastGazeT !== null,
      reReview: this.reReview,
      distribution:
        total > 0
          ? {
              critical: criticalMs / total,
              other: Math.max(0, this.cardGazeMs - criticalMs) / total,
              offCard: this.offCardGazeMs / total,
            }
          : { critical: 0, other: 0, offCard: 0 },
    };
  }
}
