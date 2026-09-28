/**
 * GazeHub: the single client-side entry point for gaze.
 *
 *   CameraEngine (MediaPipe) --raw features--> calibration model --> One Euro --> GazeFrame
 *   SimulatedGazeSource (pointer, dev only) ---------------------------------> GazeFrame
 *
 * Consumers (attention tracker, calibration UI, diagnostics) subscribe here.
 * Clicking a control marked `data-gaze-anchor` applies a small, capped drift
 * correction (implicit recalibration: people look at what they click).
 * Only the calibration model (a few dozen numbers) is persisted, in
 * sessionStorage, so a reload does not force recalibration. A calibration
 * stored by an older version is still restored, as a legacy model.
 */
import type {
  CalibrationModel,
  DisplayState,
  EyeFeatures,
  GazeEstimate,
  GazeFrame,
  GazePoint,
  GazeSourceKind,
} from "@/types/cv";
import { useCvStore } from "@/lib/store/cv-store";
import { CameraEngine, type RawFrame } from "./camera-engine";
import {
  CURRENT_CALIBRATION_VERSION,
  gazeSigmaPx,
  isCalibrationStale,
  parseCalibrationModel,
  predictGaze,
  type CalibrationSample,
} from "./calibration";
import { median } from "@/lib/math/stats";
import { CV_CONFIG } from "./config";
import { INITIAL_DRIFT, anchorWeight, driftInflation, driftResidual, updateBias, updateDrift, type DriftState } from "./drift";
import { OneEuroFilter2D } from "./one-euro";
import { SimulatedGazeSource, isSimulationAllowed } from "./simulated";
import { gazeEstimate, postureZ } from "./uncertainty";

const CALIBRATION_KEY = "oversight.calibration.v2";
/** Calibrations stored before held-out validation existed; restored as legacy (trust capped at medium). */
const LEGACY_CALIBRATION_KEY = "oversight.calibration.v1";
const CAMERA_KEY = "oversight.camera.enabled";

/** The viewport, where the window sits on the screen, and the zoom (devicePixelRatio). */
export function currentDisplay(): DisplayState {
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    screen: { x: window.screenX, y: window.screenY },
    dpr: window.devicePixelRatio || 1,
  };
}

function safeSession(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

class GazeHub {
  readonly camera = new CameraEngine();
  calibration: CalibrationModel | null = null;
  latest: GazeFrame | null = null;

  private simulator = new SimulatedGazeSource();
  private filter = new OneEuroFilter2D(CV_CONFIG.gaze.minCutoff, CV_CONFIG.gaze.beta, CV_CONFIG.gaze.dCutoff);
  private lastGaze: GazePoint | null = null;
  private lastGazeAt = 0;
  private lastStorePush = 0;
  private frameListeners = new Set<(frame: GazeFrame) => void>();
  private rawListeners = new Set<(frame: RawFrame) => void>();
  private displayWatchBound = false;
  private anchorsBound = false;
  /** Recent uncorrected (smoothed) gaze estimates, for drift correction. */
  private recent: Array<{ t: number; x: number; y: number; postureZ: number }> = [];
  /** Drift correction in normalized viewport units. */
  private bias = { x: 0, y: 0 };
  /**
   * Offset validated by the last calibration or quick recheck. Drift residuals
   * are measured against it, not against the click-learned bias, so the
   * monitor sees how far the model itself has moved.
   */
  private reference = { x: 0, y: 0 };
  private drift: DriftState = INITIAL_DRIFT;
  private lastPointerDownAt = -Infinity;
  /** Timestamps of recent frames that carried eye features (or simulated gaze). */
  private featureTimes: number[] = [];

  constructor() {
    this.camera.onFrame((raw) => this.handleRaw(raw));
    this.camera.onStatus((status, error) => {
      if (status === "active") safeSession()?.setItem(CAMERA_KEY, "1");
      useCvStore.setState({
        cameraStatus: status,
        cameraError: error,
        delegate: this.camera.delegate,
        source: this.source,
        ...(status !== "active" ? { faceCount: 0, gaze: null, gazeRaw: null, head: null, faceScale: null, iris: null } : {}),
      });
    });
  }

  get source(): GazeSourceKind {
    if (this.simulator.running) return "simulated";
    if (this.camera.status === "active") return "camera";
    return "none";
  }

  /** Frames currently carry a calibrated gaze estimate. */
  get calibrated(): boolean {
    return this.source === "simulated" || (this.source === "camera" && this.calibration !== null);
  }

  /** The calibration was restored from an older format (accuracy not measured on held-out points). */
  get isLegacyCalibration(): boolean {
    return this.calibration !== null && this.calibration.version < CURRENT_CALIBRATION_VERSION;
  }

  onFrame(listener: (frame: GazeFrame) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onRawFrame(listener: (frame: RawFrame) => void): () => void {
    this.rawListeners.add(listener);
    return () => this.rawListeners.delete(listener);
  }

  async startCamera(): Promise<void> {
    this.bindDisplayWatch();
    this.bindAnchors();
    await this.camera.start();
    useCvStore.setState({ source: this.source });
  }

  stopCamera() {
    this.camera.stop();
    safeSession()?.removeItem(CAMERA_KEY);
    useCvStore.setState({ source: this.source });
  }

  /** Re-enables the camera after a reload if it was on and permission is already granted (no prompt). */
  async resumeCameraIfPermitted(): Promise<void> {
    if (safeSession()?.getItem(CAMERA_KEY) !== "1" || this.camera.status !== "idle") return;
    try {
      const permission = await navigator.permissions.query({ name: "camera" as PermissionName });
      if (permission.state !== "granted") return;
    } catch {
      return;
    }
    await this.startCamera();
  }

  /** Pointer-as-gaze simulation; refused in production builds (see isSimulationAllowed). */
  setSimulated(on: boolean) {
    if (on && !isSimulationAllowed()) return;
    if (on) {
      this.simulator.start((frame) =>
        this.publish({ ...frame, estimate: frame.gaze ? this.estimateFor(frame.gaze, 1, null, false) : null }),
      );
    } else this.simulator.stop();
    useCvStore.setState({ simulated: on, source: this.source });
  }

  setCalibration(model: CalibrationModel | null) {
    this.calibration = model;
    this.filter.reset();
    this.lastGaze = null;
    this.resetDrift();
    const storage = safeSession();
    if (model) storage?.setItem(CALIBRATION_KEY, JSON.stringify(model));
    else storage?.removeItem(CALIBRATION_KEY);
    storage?.removeItem(LEGACY_CALIBRATION_KEY);
    this.bindDisplayWatch();
    this.pushCalibration();
  }

  restoreCalibration() {
    const storage = safeSession();
    for (const key of [CALIBRATION_KEY, LEGACY_CALIBRATION_KEY]) {
      const raw = storage?.getItem(key);
      if (!raw) continue;
      let model: CalibrationModel | null = null;
      try {
        model = parseCalibrationModel(JSON.parse(raw));
      } catch {
        model = null;
      }
      if (!model) {
        storage?.removeItem(key);
        continue;
      }
      this.calibration = model;
      this.bindDisplayWatch();
      this.pushCalibration();
      return;
    }
  }

  private pushCalibration() {
    const model = this.calibration;
    const v = model?.version === 2 ? model.validation : null;
    useCvStore.setState({
      calibration: model
        ? {
            version: model.version,
            quality: model.quality,
            sigmaPx: gazeSigmaPx(model) ?? { x: 0, y: 0 },
            validation: v
              ? {
                  points: v.points,
                  medianPx: v.medianPx,
                  p90Px: v.p90Px,
                  worstPointPx: v.worstPointPx,
                  precisionPx: v.precisionPx,
                }
              : null,
            headSweep: model.version === 2 ? model.headSweep : null,
            adaptive: model.version === 2 ? model.adaptive : false,
            viewport: model.viewport,
            pointCount: model.pointCount,
            sampleCount: model.sampleCount,
            createdAt: model.createdAt,
          }
        : null,
      calibrationStale: model && typeof window !== "undefined" ? isCalibrationStale(model, currentDisplay()) : false,
    });
  }

  /** Re-checks whether the display still matches the calibration. */
  refreshStale() {
    if (!this.calibration || typeof window === "undefined") return;
    const stale = isCalibrationStale(this.calibration, currentDisplay());
    if (stale !== useCvStore.getState().calibrationStale) useCvStore.setState({ calibrationStale: stale });
  }

  resetDrift() {
    this.bias = { x: 0, y: 0 };
    this.reference = { x: 0, y: 0 };
    this.drift = INITIAL_DRIFT;
    this.recent = [];
    this.pushDrift();
  }

  /** Applies a quick-recheck offset (already capped) and clears the drift alarm. */
  applyRecheck(offset: { x: number; y: number }) {
    this.bias = { ...offset };
    this.reference = { ...offset };
    this.drift = INITIAL_DRIFT;
    this.pushDrift();
  }

  private pushDrift() {
    const w = typeof window === "undefined" ? 0 : window.innerWidth;
    const h = typeof window === "undefined" ? 0 : window.innerHeight;
    useCvStore.setState({
      driftPx: { x: Math.round(this.bias.x * w), y: Math.round(this.bias.y * h) },
      drift: { ...this.drift },
    });
  }

  /** Clicks only teach anything when the signal is sound: one face, fresh and usable calibration, enough frames. */
  private anchorSignalOk(): boolean {
    const cv = useCvStore.getState();
    return (
      this.source === "camera" &&
      !!this.calibration &&
      this.calibration.quality !== "poor" &&
      !cv.calibrationStale &&
      this.latest?.faceCount === 1 &&
      cv.effectiveFps >= CV_CONFIG.drift.minFps
    );
  }

  /** One anchor observation: update the drift monitor, then the capped translation correction. */
  private observeAnchor(el: Element) {
    const kind = el.getAttribute("data-gaze-anchor");
    const role = el.closest("[data-attention-role]")?.getAttribute("data-attention-role") ?? null;
    const weight = anchorWeight(kind, role);
    if (weight <= 0 || !this.anchorSignalOk() || !this.calibration) return;
    const cfg = CV_CONFIG.drift;
    const now = performance.now();
    const pts = this.recent.filter((p) => now - p.t <= cfg.windowMs);
    if (pts.length < cfg.minSamples) return;
    if (median(pts.map((p) => p.postureZ)) > cfg.maxPostureZ) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const r = el.getBoundingClientRect();
    const anchor = { x: (r.left + r.width / 2) / vw, y: (r.top + r.height / 2) / vh };
    const raw = { x: median(pts.map((p) => p.x)), y: median(pts.map((p) => p.y)) };
    const sigma = gazeSigmaPx(this.calibration);
    if (sigma) {
      const residual = driftResidual(
        { x: (raw.x + this.reference.x) * vw, y: (raw.y + this.reference.y) * vh },
        { x: anchor.x * vw, y: anchor.y * vh },
        sigma,
      );
      this.drift = updateDrift(this.drift, residual, weight);
    }
    const estimate = { x: raw.x + this.bias.x, y: raw.y + this.bias.y };
    if (Math.hypot((anchor.x - estimate.x) * vw, (anchor.y - estimate.y) * vh) <= cfg.maxDistancePx) {
      this.bias = updateBias(this.bias, anchor, estimate, weight);
    }
    this.pushDrift();
  }

  private bindAnchors() {
    if (this.anchorsBound || typeof window === "undefined") return;
    this.anchorsBound = true;
    window.addEventListener(
      "pointerdown",
      (e) => {
        this.lastPointerDownAt = performance.now();
        const target = e.target instanceof Element ? e.target.closest("[data-gaze-anchor]") : null;
        if (target) this.observeAnchor(target);
      },
      { capture: true, passive: true },
    );
    // Keyboard focus of an anchored input (the manual acknowledgement field); a click already counted.
    window.addEventListener(
      "focusin",
      (e) => {
        if (performance.now() - this.lastPointerDownAt < 500) return;
        const target = e.target instanceof HTMLInputElement ? e.target.closest("[data-gaze-anchor]") : null;
        if (target) this.observeAnchor(target);
      },
      { capture: true },
    );
  }

  /**
   * Watches for display changes that invalidate the calibration: resize, zoom,
   * and moving the window (which fires no event, hence the focus / pointerdown
   * checks and a slow poll).
   */
  private bindDisplayWatch() {
    if (this.displayWatchBound || typeof window === "undefined") return;
    this.displayWatchBound = true;
    const check = () => this.refreshStale();
    window.addEventListener("resize", check);
    window.addEventListener("focus", check);
    window.addEventListener("pointerdown", check, { capture: true, passive: true });
    window.setInterval(check, CV_CONFIG.calibration.staleCheckMs);
  }

  /** The gaze point in CSS px with its per-frame uncertainty (see ./uncertainty). */
  private estimateFor(
    gaze: GazePoint,
    faceCount: number,
    features: EyeFeatures | null,
    held: boolean,
  ): GazeEstimate | null {
    const simulated = this.simulator.running;
    const sim = CV_CONFIG.uncertainty.simulatedSigmaPx;
    const base = simulated ? { x: sim, y: sim } : gazeSigmaPx(this.calibration);
    if (!base || typeof window === "undefined") return null;
    const model = this.calibration;
    return gazeEstimate({
      gaze,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      base,
      faceCount,
      postureZ: !simulated && model?.version === 2 ? postureZ(features, model.posture) : 0,
      held,
      driftInflation: simulated ? 1 : driftInflation(this.drift),
    });
  }

  private handleRaw(raw: RawFrame) {
    for (const l of this.rawListeners) l(raw);
    // While simulation is on, camera frames feed diagnostics/calibration only.
    if (this.simulator.running) return;

    let gaze: GazePoint | null = null;
    let gazeRaw: GazePoint | null = null;
    let held = false;
    const f = raw.features;
    if (raw.faceCount >= 1 && f && this.calibration) {
      if (f.blink) {
        if (this.lastGaze && raw.t - this.lastGazeAt <= CV_CONFIG.gaze.blinkHoldMs) {
          gaze = this.lastGaze;
          held = true;
        }
      } else {
        gazeRaw = predictGaze(this.calibration, f);
        if (raw.t - this.lastGazeAt > 500) this.filter.reset();
        const smoothed = this.filter.filter(gazeRaw.x, gazeRaw.y, raw.t / 1000);
        const pz = this.calibration.version === 2 ? postureZ(f, this.calibration.posture) : 0;
        this.recent.push({ t: raw.t, x: smoothed.x, y: smoothed.y, postureZ: pz });
        if (this.recent.length > 60) this.recent.splice(0, this.recent.length - 60);
        gaze = { x: smoothed.x + this.bias.x, y: smoothed.y + this.bias.y };
        this.lastGaze = gaze;
        this.lastGazeAt = raw.t;
      }
    }
    this.publish({
      t: raw.t,
      source: "camera",
      faceCount: raw.faceCount,
      features: f,
      gaze,
      estimate: gaze ? this.estimateFor(gaze, raw.faceCount, f, held) : null,
      gazeRaw,
      held,
      inferenceMs: raw.inferenceMs,
    });
  }

  /** Frames with eye features per second over the last window: the rate evidence actually arrives at. */
  private effectiveFps(t: number): number {
    const span = CV_CONFIG.camera.effectiveFpsWindowMs;
    while (this.featureTimes.length && t - this.featureTimes[0] > span) this.featureTimes.shift();
    const n = this.featureTimes.length;
    if (n < 2) return 0;
    return (n - 1) / Math.max(1e-3, (this.featureTimes[n - 1] - this.featureTimes[0]) / 1000);
  }

  private publish(frame: GazeFrame) {
    this.latest = frame;
    if (frame.features || frame.source === "simulated") this.featureTimes.push(frame.t);
    for (const l of this.frameListeners) l(frame);
    const now = performance.now();
    if (now - this.lastStorePush < 150) return;
    this.lastStorePush = now;
    const f = frame.features;
    useCvStore.setState({
      faceCount: frame.faceCount,
      effectiveFps: this.effectiveFps(frame.t),
      fps: frame.source === "camera" ? this.camera.fps : 30,
      inferenceMs: this.camera.inferenceMs,
      gaze: frame.gaze,
      gazeRaw: frame.gazeRaw,
      head: f ? { yaw: f.yaw, pitch: f.pitch, roll: f.roll } : null,
      faceScale: f ? f.faceScale : null,
      iris: f ? { h: f.irisH, v: f.irisV, openness: f.openness } : null,
      blink: f?.blink ?? false,
      source: this.source,
    });
  }
}

let hub: GazeHub | null = null;

/** Client-only singleton. */
export function getGazeHub(): GazeHub {
  if (!hub) hub = new GazeHub();
  return hub;
}

export type { GazeHub };

/**
 * Collects labeled feature samples while the calibration UI shows each target.
 * Training and held-out validation samples are kept apart from the moment
 * they are recorded, so a validation sample can never reach the fit.
 */
export class CalibrationCollector {
  readonly train: CalibrationSample[] = [];
  readonly validation: CalibrationSample[] = [];
  private point: { index: number; target: { x: number; y: number }; role: "train" | "validation" } | null = null;
  private collecting = false;
  private counts = new Map<number, number>();
  private unsubscribe: () => void;

  constructor(target: GazeHub = getGazeHub()) {
    this.unsubscribe = target.onRawFrame((raw) => {
      if (!this.collecting || !this.point || raw.faceCount !== 1 || !raw.features || raw.features.blink) return;
      const sample = { features: raw.features, target: this.point.target, pointIndex: this.point.index };
      (this.point.role === "train" ? this.train : this.validation).push(sample);
      this.counts.set(this.point.index, (this.counts.get(this.point.index) ?? 0) + 1);
    });
  }

  setPoint(index: number, target: { x: number; y: number }, role: "train" | "validation" = "train") {
    this.point = { index, target, role };
    this.collecting = false;
  }

  /** Samples recorded so far for one point. */
  samplesOf(index: number): CalibrationSample[] {
    return [...this.train, ...this.validation].filter((s) => s.pointIndex === index);
  }

  setCollecting(on: boolean) {
    this.collecting = on;
  }

  count(index: number): number {
    return this.counts.get(index) ?? 0;
  }

  dispose() {
    this.unsubscribe();
  }
}
