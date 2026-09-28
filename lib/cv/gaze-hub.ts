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
 * sessionStorage, so a reload does not force recalibration.
 */
import type { CalibrationModel, DisplayState, GazeFrame, GazePoint, GazeSourceKind } from "@/types/cv";
import { useCvStore } from "@/lib/store/cv-store";
import { CameraEngine, type RawFrame } from "./camera-engine";
import {
  CURRENT_CALIBRATION_VERSION,
  isCalibrationStale,
  predictGaze,
  type CalibrationSample,
} from "./calibration";
import { clamp } from "@/lib/utils";
import { median } from "@/lib/math/stats";
import { CV_CONFIG } from "./config";
import { OneEuroFilter2D } from "./one-euro";
import { SimulatedGazeSource, isSimulationAllowed } from "./simulated";

const CALIBRATION_KEY = "oversight.calibration.v1";
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
  private recent: Array<{ t: number; x: number; y: number }> = [];
  /** Drift correction in normalized viewport units. */
  private bias = { x: 0, y: 0 };

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
    if (on) this.simulator.start((frame) => this.publish(frame));
    else this.simulator.stop();
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
    this.bindDisplayWatch();
    this.pushCalibration();
  }

  restoreCalibration() {
    const raw = safeSession()?.getItem(CALIBRATION_KEY);
    if (!raw) return;
    try {
      const model = JSON.parse(raw) as CalibrationModel;
      if (model?.version === 1 && model.x?.weights && model.y?.weights) {
        this.calibration = model;
        this.bindDisplayWatch();
        this.pushCalibration();
      }
    } catch {
      safeSession()?.removeItem(CALIBRATION_KEY);
    }
  }

  private pushCalibration() {
    const model = this.calibration;
    useCvStore.setState({
      calibration: model
        ? {
            quality: model.quality,
            errorPx: model.errorPx,
            errorNorm: model.errorNorm,
            viewport: model.viewport,
            pointCount: model.pointCount,
            sampleCount: model.sampleCount,
            createdAt: model.createdAt,
          }
        : null,
      calibrationStale: model ? isCalibrationStale(model, currentDisplay()) : false,
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
    this.recent = [];
    useCvStore.setState({ driftPx: { x: 0, y: 0 } });
  }

  private bindAnchors() {
    if (this.anchorsBound || typeof window === "undefined") return;
    this.anchorsBound = true;
    window.addEventListener(
      "pointerdown",
      (e) => {
        const target = e.target instanceof Element ? e.target.closest("[data-gaze-anchor]") : null;
        if (!target || this.source !== "camera" || !this.calibration) return;
        const cfg = CV_CONFIG.drift;
        const now = performance.now();
        const pts = this.recent.filter((p) => now - p.t <= cfg.windowMs);
        if (pts.length < cfg.minSamples) return;
        const r = target.getBoundingClientRect();
        const tx = (r.left + r.width / 2) / window.innerWidth;
        const ty = (r.top + r.height / 2) / window.innerHeight;
        const ex = median(pts.map((p) => p.x)) + this.bias.x;
        const ey = median(pts.map((p) => p.y)) + this.bias.y;
        const distPx = Math.hypot((tx - ex) * window.innerWidth, (ty - ey) * window.innerHeight);
        if (distPx > cfg.maxDistancePx) return;
        this.bias = {
          x: clamp(this.bias.x + cfg.learningRate * (tx - ex), -cfg.maxX, cfg.maxX),
          y: clamp(this.bias.y + cfg.learningRate * (ty - ey), -cfg.maxY, cfg.maxY),
        };
        useCvStore.setState({
          driftPx: { x: Math.round(this.bias.x * window.innerWidth), y: Math.round(this.bias.y * window.innerHeight) },
        });
      },
      { capture: true, passive: true },
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
        this.recent.push({ t: raw.t, x: smoothed.x, y: smoothed.y });
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
      gazeRaw,
      held,
      inferenceMs: raw.inferenceMs,
    });
  }

  private publish(frame: GazeFrame) {
    this.latest = frame;
    for (const l of this.frameListeners) l(frame);
    const now = performance.now();
    if (now - this.lastStorePush < 150) return;
    this.lastStorePush = now;
    const f = frame.features;
    useCvStore.setState({
      faceCount: frame.faceCount,
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

/** Collects labeled feature samples while the calibration UI shows each target. */
export class CalibrationCollector {
  readonly samples: CalibrationSample[] = [];
  private point: { index: number; target: { x: number; y: number } } | null = null;
  private collecting = false;
  private counts = new Map<number, number>();
  private unsubscribe: () => void;

  constructor(target: GazeHub = getGazeHub()) {
    this.unsubscribe = target.onRawFrame((raw) => {
      if (!this.collecting || !this.point || raw.faceCount !== 1 || !raw.features || raw.features.blink) return;
      this.samples.push({ features: raw.features, target: this.point.target, pointIndex: this.point.index });
      this.counts.set(this.point.index, (this.counts.get(this.point.index) ?? 0) + 1);
    });
  }

  setPoint(index: number, target: { x: number; y: number }) {
    this.point = { index, target };
    this.collecting = false;
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
