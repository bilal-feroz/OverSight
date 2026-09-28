/**
 * ReviewSession: live measurement for one approval request.
 *
 * Every gaze estimate carries its own uncertainty (sigma per axis). Instead
 * of "did the dot touch the box", each registered semantic region gets a soft
 * weight exp(-d^2/2) for the elliptical distance d (in sigma units) from the
 * estimate to the region, and dwell accumulates time x weight. Estimates in
 * transit between fixations add nothing. At approval time the session also
 * reports, per target, whether gaze at the measured error can tell it apart
 * from the title, summary and decision buttons at all (separability).
 *
 * The session keeps only derived numbers: dwell per region, visibility,
 * fixations, scroll depth, pointer distance. `snapshot()` hands them to the
 * deterministic AttentionEngine when the reviewer clicks Approve.
 *
 * Layout and time come from a GeometrySource (see ./geometry), never from
 * the DOM directly, so the same code runs against scripted layouts in tests.
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
import type { CalibrationQuality, GazeEstimate, GazeFrame, GazeSourceKind } from "@/types/cv";
import { CV_CONFIG } from "@/lib/cv/config";
import { FixationDetector, type Fixation } from "@/lib/cv/fixation";
import { clamp } from "@/lib/utils";
import type { LiveState } from "@/lib/store/live-store";
import { ATTENTION_CONFIG } from "./config";
import type { GeometrySource } from "./geometry";
import {
  binIndex,
  containsPoint,
  hitMargin,
  intersect,
  relativeTo,
  severityWeight,
  softWeight,
  sweepCoverage,
  targetSeparation,
  visibleFraction,
} from "./regions";
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
  /** Layout and clock (the DOM in the browser, a scripted layout in tests). */
  geometry: GeometrySource;
  gazeSource: GazeSourceKind;
  calibrated: boolean;
  calibrationQuality: CalibrationQuality | null;
  /** The display changed since calibration (see isCalibrationStale). */
  calibrationStale: boolean;
  /** Calibration from an older format, accuracy not measured on held-out points. */
  legacyCalibration: boolean;
  /** Calibration gaze error (1 sigma per axis), CSS px. */
  gazeSigmaPx: { x: number; y: number } | null;
  /** Measured precision (jitter) of the calibration, CSS px; null for legacy models. */
  gazePrecisionPx?: number | null;
  /** Clicks suggest the calibration has drifted (see lib/cv/drift.ts). */
  driftSuspected?: boolean;
}

export type GazeSignalOptions = Pick<
  ReviewSessionOptions,
  | "gazeSource"
  | "calibrated"
  | "calibrationQuality"
  | "calibrationStale"
  | "legacyCalibration"
  | "gazeSigmaPx"
  | "gazePrecisionPx"
  | "driftSuspected"
>;

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

/** I-DT dispersion: from measured precision when known, else from the error (legacy rule). */
function fixationDispersion(opts: Pick<ReviewSessionOptions, "gazeSigmaPx" | "gazePrecisionPx">): number {
  const t = ATTENTION_CONFIG.targets;
  if (opts.gazePrecisionPx != null) {
    return clamp(opts.gazePrecisionPx * t.fixationPrecisionFactor, t.fixationDispersionMinPx, t.fixationDispersionMaxPx);
  }
  const sigma = opts.gazeSigmaPx ? Math.max(opts.gazeSigmaPx.x, opts.gazeSigmaPx.y) : 0;
  return Math.max(t.fixationMinDispersionPx, sigma * t.fixationSigmaFactor);
}

export class ReviewSession {
  readonly approvalId: string;
  readonly openedAt: number;
  phase: "reviewing" | "rereview" | "closed" = "reviewing";
  reReview: ReReviewState | null = null;
  /** Region with the highest soft weight right now (UI only). */
  currentRegionId: string | null = null;
  lastGazePx: { x: number; y: number } | null = null;
  lastEstimate: GazeEstimate | null = null;

  private opts: ReviewSessionOptions;
  private readonly geo: GeometrySource;
  private readonly cfg = ATTENTION_CONFIG.targets;
  private readonly signalCfg = ATTENTION_CONFIG.signal;
  private frames: FrameCounts = { total: 0, face: 0, multiFace: 0, facing: 0, gaze: 0, onScreen: 0 };
  private targets: Map<string, TargetAcc>;
  private regionDwell = new Map<string, number>();
  private weights = new Map<string, number>();
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
  private lastGeometryAt = -Infinity;
  private speed = 0;
  private sigmaSum = { x: 0, y: 0 };
  private confidenceSum = 0;
  private uncertainFrames = 0;
  private postureOut = 0;

  constructor(opts: ReviewSessionOptions) {
    this.opts = opts;
    this.geo = opts.geometry;
    this.approvalId = opts.approvalId;
    this.openedAt = this.geo.now();
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
    this.fixations = new FixationDetector(fixationDispersion(opts), this.cfg.fixationMinDurationMs);
    this.refreshGeometry();
  }

  /**
   * The gaze signal can change while a request is open (camera finishing
   * start-up after a reload, calibration completed, simulation toggled).
   * Frames are counted from the moment they arrive, so nothing is back-filled.
   */
  updateSignal(signal: GazeSignalOptions) {
    this.opts = { ...this.opts, ...signal };
    this.margin = hitMargin(signal.gazeSigmaPx);
    this.fixations.setDispersion(fixationDispersion(this.opts));
  }

  /** Region outline margin for the UI (dwell itself is weighted by the per-frame error). */
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
    const clip = this.geo.clipRect();
    this.cardRect = this.geo.cardRect();
    this.geometry.clear();
    for (const { meta, rect } of this.geo.regions(this.approvalId)) {
      this.geometry.set(meta.id, {
        meta,
        rect,
        visible: intersect(rect, clip),
        fraction: visibleFraction(rect, clip),
      });
    }
  }

  /** Re-read region geometry on the next tick (scroll, resize, layout change). */
  invalidateGeometry() {
    this.lastGeometryAt = -Infinity;
  }

  /** Called every animation frame: geometry (throttled), visibility, hover, focus, scroll. */
  tick(now: number) {
    const dt = clamp(now - this.lastTick, 0, this.cfg.maxTickDtMs);
    this.lastTick = now;
    if (now - this.lastGeometryAt >= this.cfg.geometryRefreshMs) {
      this.refreshGeometry();
      this.lastGeometryAt = now;
    }
    if (this.phase !== "reviewing") return;
    for (const acc of this.targets.values()) {
      const g = this.geometry.get(acc.id);
      if (g && g.fraction >= this.cfg.visibleFraction) acc.visibleMs += dt;
      if (this.pointer && g?.visible && containsPoint(g.visible, this.pointer.x, this.pointer.y)) {
        acc.hoverMs += dt;
      }
    }
    if (this.geo.focused()) this.focusedMs += dt;
    this.scrollDepth = Math.max(this.scrollDepth, this.geo.scrollDepth());
  }

  onPointerMove(x: number, y: number) {
    if (this.pointer && this.phase === "reviewing") {
      this.pointerDistance += Math.hypot(x - this.pointer.x, y - this.pointer.y);
    }
    this.pointer = { x, y };
  }

  /** The frame's estimate, or one built from the calibration error for frames without it. */
  private estimateOf(frame: GazeFrame): GazeEstimate | null {
    if (frame.estimate) return frame.estimate;
    if (!frame.gaze) return null;
    const { width, height } = this.geo.viewport();
    const floor = CV_CONFIG.uncertainty.simulatedSigmaPx;
    const sigma = this.opts.gazeSigmaPx ?? { x: floor, y: floor };
    return {
      x: frame.gaze.x * width,
      y: frame.gaze.y * height,
      sigmaX: sigma.x,
      sigmaY: sigma.y,
      confidence: frame.faceCount === 1 ? 1 : 0,
      postureZ: 0,
      held: frame.held,
    };
  }

  onFrame(frame: GazeFrame) {
    if (this.phase === "closed") return;
    // If animation frames are throttled (hidden pane, power saving), keep geometry
    // and visibility current from the camera frames themselves.
    const now = this.geo.now();
    if (now - this.lastTick > this.cfg.tickStallMs) this.tick(now);
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

    const est = this.estimateOf(frame);
    if (!est) {
      this.lastGazeT = null;
      this.currentRegionId = null;
      this.lastGazePx = null;
      this.lastEstimate = null;
      this.weights.clear();
      this.speed = 0;
      return;
    }
    if (reviewing) this.frames.gaze++;
    const firstOfRun = this.lastGazeT === null;
    const gap = firstOfRun ? 0 : frame.t - (this.lastGazeT as number);
    const dt = firstOfRun ? this.cfg.firstFrameDtMs : clamp(gap, 0, this.cfg.maxFrameDtMs);
    this.lastGazeT = frame.t;

    const px = est.x;
    const py = est.y;
    const sigma = { x: est.sigmaX, y: est.sigmaY };
    // Speed of the (already smoothed) estimate, EMA over frames: transit between fixations.
    if (!firstOfRun && this.lastGazePx && gap >= this.cfg.transitMinGapMs && gap <= this.cfg.maxFrameDtMs) {
      const inst = Math.min(
        this.cfg.transitSpeedCapPxPerS,
        Math.hypot(px - this.lastGazePx.x, py - this.lastGazePx.y) / (gap / 1000),
      );
      this.speed = this.cfg.transitSpeedSmoothing * inst + (1 - this.cfg.transitSpeedSmoothing) * this.speed;
    } else if (firstOfRun || gap > this.cfg.maxFrameDtMs) {
      this.speed = 0;
    }
    const transit = this.speed > this.cfg.transitSpeedPxPerS;
    this.lastGazePx = { x: px, y: py };
    this.lastEstimate = est;
    const { width: vw, height: vh } = this.geo.viewport();
    const onScreen = px >= 0 && px <= vw && py >= 0 && py <= vh;

    // Soft weight for every visible region.
    this.weights.clear();
    let best: string | null = null;
    let bestW = 0;
    if (onScreen) {
      for (const [id, g] of this.geometry) {
        if (!g.visible) continue;
        const w = softWeight(g.visible, px, py, sigma);
        if (w < 1e-4) continue;
        this.weights.set(id, w);
        if (w > bestW) {
          bestW = w;
          best = id;
        }
      }
    }
    this.currentRegionId = bestW >= this.cfg.currentRegionMinWeight ? best : null;
    this.lastOnCard = !!this.cardRect && containsPoint(this.cardRect, px, py);

    if (this.phase === "rereview" && this.reReview) {
      const g = this.geometry.get(this.reReview.targetId);
      this.reReview = stepReReview(this.reReview, {
        dtMs: dt,
        targetVisible: !!g && g.fraction >= this.cfg.visibleFraction,
        gazeWeight: transit ? 0 : (this.weights.get(this.reReview.targetId) ?? 0),
        faceOk: frame.faceCount === 1,
      });
      return;
    }
    if (!reviewing) return;

    this.sigmaSum.x += sigma.x;
    this.sigmaSum.y += sigma.y;
    this.confidenceSum += est.confidence;
    this.uncertainFrames++;
    if (est.postureZ > CV_CONFIG.uncertainty.postureZ0) this.postureOut++;

    if (!onScreen) {
      this.offScreenMs += dt;
      this.pushSample(frame.t, px, py, null, false, false);
      return;
    }
    this.frames.onScreen++;
    if (this.lastOnCard) this.cardGazeMs += dt;
    else this.offCardGazeMs += dt;

    const oriented = frame.t - this.openedAt >= this.cfg.orientationMs;
    if (oriented && !transit) {
      for (const [id, w] of this.weights) {
        const g = this.geometry.get(id);
        if (!g || g.meta.role === "review-target") continue;
        this.regionDwell.set(id, (this.regionDwell.get(id) ?? 0) + dt * w);
        const acc = this.targets.get(id);
        if (acc) {
          acc.dwellMs += dt * w;
          acc.bins[binIndex(g.rect, px, acc.bins.length)] += dt * w;
        }
      }
    }
    if (oriented) {
      const fixation = this.fixations.push(frame.t, px, py);
      if (fixation) this.attributeFixation(fixation);
    }
    this.pushSample(frame.t, px, py, this.currentRegionId, this.lastOnCard, true);
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

  /** Mean per-frame sigma during the review, or the calibration sigma before any frame. */
  private sigmaEff(): { x: number; y: number } | null {
    if (this.uncertainFrames > 0) {
      return { x: this.sigmaSum.x / this.uncertainFrames, y: this.sigmaSum.y / this.uncertainFrames };
    }
    return this.opts.gazeSigmaPx;
  }

  private fixationWeight(id: string, x: number, y: number): number {
    const g = this.geometry.get(id);
    const sigma = this.lastEstimate
      ? { x: this.lastEstimate.sigmaX, y: this.lastEstimate.sigmaY }
      : this.sigmaEff();
    if (!g?.visible || !sigma) return 0;
    return softWeight(g.visible, x, y, sigma);
  }

  private attributeFixation(fix: Fixation) {
    for (const acc of this.targets.values()) {
      if (this.fixationWeight(acc.id, fix.x, fix.y) < this.cfg.fixationMinWeight) continue;
      acc.fixations += 1;
      const t = fix.start - this.openedAt;
      acc.firstFixationMs = acc.firstFixationMs === null ? t : Math.min(acc.firstFixationMs, t);
    }
  }

  /**
   * Separation (sigma units) of a target from the title, summary and other
   * context regions and from the decision buttons; null when unknown.
   */
  private separationOf(id: string, sigma: { x: number; y: number } | null): number | null {
    const g = this.geometry.get(id);
    if (!g || !sigma) return null;
    const competitors: RectLike[] = [...this.geometry.values()]
      .filter((c) => c.meta.role === "context" && c.meta.id !== id)
      .map((c) => c.rect);
    competitors.push(...this.geo.controlRects());
    const s = targetSeparation(g.rect, competitors, sigma);
    return Number.isFinite(s) ? s : null;
  }

  /** Stops the initial review measurement (at the approval click). */
  freeze() {
    if (this.frozenElapsed === null) this.frozenElapsed = this.geo.now() - this.openedAt;
    this.phase = "closed";
  }

  startReReview(state: ReReviewState) {
    this.freeze();
    // The layout is about to change (pause view or refocus): re-read it on the next tick.
    this.invalidateGeometry();
    this.reReview = state;
    this.phase = state.method === "gaze" ? "rereview" : "closed";
  }

  /** Switches a running re-review to manual acknowledgement. */
  useManual() {
    if (this.reReview) this.reReview = { ...this.reReview, method: "manual" };
    this.phase = "closed";
  }

  snapshot(now = this.geo.now()): ReviewSnapshot {
    const elapsedMs = this.frozenElapsed ?? now - this.openedAt;
    const ongoing = this.fixations.current();
    const sigmaEff = this.sigmaEff();
    const minSeparation = ATTENTION_CONFIG.trust.minSeparationSigma;
    const targets: TargetStats[] = [...this.targets.values()].map((acc) => {
      let fixations = acc.fixations;
      let first = acc.firstFixationMs;
      if (ongoing && this.fixationWeight(acc.id, ongoing.x, ongoing.y) >= this.cfg.fixationMinWeight) {
        fixations += 1;
        const t = ongoing.start - this.openedAt;
        first = first === null ? t : Math.min(first, t);
      }
      const g = this.geometry.get(acc.id);
      const separation = this.separationOf(acc.id, sigmaEff);
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
        sweepAvailable: !!g && !!sigmaEff && sigmaEff.x <= g.rect.width / this.cfg.sweepMaxSigmaFraction,
        separation,
        conclusive: separation === null || separation >= minSeparation,
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
      calibrationStale: this.opts.calibrationStale,
      legacyCalibration: this.opts.legacyCalibration,
      driftSuspected: this.opts.driftSuspected ?? false,
      frames: { ...this.frames },
      effectiveFps: elapsedMs > 0 ? this.frames.gaze / (elapsedMs / 1000) : 0,
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
      sigmaEffPx: sigmaEff,
      meanEstimateConfidence: this.uncertainFrames > 0 ? this.confidenceSum / this.uncertainFrames : null,
      postureOutRatio: this.uncertainFrames > 0 ? this.postureOut / this.uncertainFrames : 0,
      viewport: this.geo.viewport(),
    };
  }

  live(): LiveState {
    const elapsedMs = this.frozenElapsed ?? this.geo.now() - this.openedAt;
    const sigma = this.lastEstimate ? { x: this.lastEstimate.sigmaX, y: this.lastEstimate.sigmaY } : this.sigmaEff();
    const minSeparation = ATTENTION_CONFIG.trust.minSeparationSigma;
    const targets = [...this.targets.values()].map((acc) => {
      const separation = this.separationOf(acc.id, sigma);
      return {
        id: acc.id,
        dwellMs: acc.dwellMs,
        requiredDwellMs: acc.requiredDwellMs,
        visible: acc.visibleMs >= this.cfg.minVisibleForGazeMs,
        weight: this.weights.get(acc.id) ?? 0,
        separation,
        conclusive: separation === null || separation >= minSeparation,
        fixations: acc.fixations,
      };
    });
    const gazeUsable = this.opts.gazeSource !== "none" && this.opts.calibrated;
    const counted = targets.filter((t) => t.visible && t.conclusive);
    let coverage: number | null = null;
    if (gazeUsable && counted.length) {
      let w = 0;
      let v = 0;
      for (const t of counted) {
        const weight = severityWeight(this.targets.get(t.id)?.severity ?? "LOW");
        w += weight;
        v += weight * Math.min(1, t.dwellMs / Math.max(1, t.requiredDwellMs));
      }
      coverage = w ? v / w : 0;
    }
    const total = this.cardGazeMs + this.offCardGazeMs;
    const criticalMs = Math.min(
      this.cardGazeMs,
      [...this.targets.keys()].reduce((acc, id) => acc + (this.regionDwell.get(id) ?? 0), 0),
    );
    const est = this.lastEstimate;
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
      estimate: est
        ? { sigmaX: est.sigmaX, sigmaY: est.sigmaY, confidence: est.confidence, postureZ: est.postureZ }
        : null,
    };
  }
}
