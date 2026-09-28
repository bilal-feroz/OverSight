/**
 * SYNTHETIC eye / head / screen geometry for calibration tests.
 *
 * A reviewer sits `distanceCm` from a screen that spans about +-14 x +-9
 * degrees. Looking at a point on the screen needs a gaze direction; the eyes
 * supply what the head does not (eye-in-head angle = gaze angle - head angle).
 * Features are linear in the eye-in-head angle plus noise, head pose and face
 * position are "measured" with noise, like MediaPipe's outputs.
 *
 * This reproduces the identifiability problem behind finding F1 (a head-still
 * calibration cannot learn head-pose compensation). It is a regression guard
 * for the fitting code, NOT a model of real accuracy: numbers from it must
 * never be presented as measurements.
 */
import type { EyeFeatures } from "@/types/cv";
import type { CalibrationSample } from "@/lib/cv/calibration";
import { CV_CONFIG } from "@/lib/cv/config";
import { gaussian, rng } from "./gaze-sim";

export const SCREEN = {
  widthCm: 30,
  heightCm: 19,
  distanceCm: 60,
  viewport: { width: 1440, height: 900 },
};

/** Head pose and position: degrees; cm right / down of the screen axis; cm from the screen. */
export interface Head {
  yaw: number;
  pitch: number;
  x: number;
  y: number;
  z: number;
}

export const REST: Head = { yaw: 0, pitch: 0, x: 0, y: 0, z: SCREEN.distanceCm };

const DEG = 180 / Math.PI;

export interface EyeSimOptions {
  /** Noise multiplier (1 = default webcam-like noise). */
  noise?: number;
}

/** Features of one frame while looking at normalized screen point `target` with head `head`. */
export function eyeFeatures(target: { x: number; y: number }, head: Head, rand: () => number, opts: EyeSimOptions = {}): EyeFeatures {
  const k = opts.noise ?? 1;
  const n = (sd: number) => gaussian(rand) * sd * k;
  const px = (target.x - 0.5) * SCREEN.widthCm;
  const py = (target.y - 0.5) * SCREEN.heightCm;
  // Gaze direction in the world, then what the eyes add on top of the head.
  const ex = Math.atan2(px - head.x, head.z) * DEG - head.yaw;
  const ey = Math.atan2(py - head.y, head.z) * DEG - head.pitch;
  return {
    irisH: 0.5 + 0.0075 * ex + n(0.004),
    irisV: 0.0045 * ey + n(0.003),
    openness: 0.3 - 0.003 * ey + n(0.006),
    bsH: 0.025 * ex + n(0.04),
    bsV: -0.025 * ey + n(0.04),
    yaw: head.yaw + n(0.7),
    pitch: head.pitch + n(0.7),
    roll: n(0.5),
    faceX: 0.5 - head.x / 69 + n(0.002),
    faceY: 0.45 + head.y / 39 + n(0.002),
    faceScale: (0.0913 * SCREEN.distanceCm) / head.z + n(0.0008),
    blink: false,
  };
}

const FPS = 30;

/**
 * The 9-point grid with the head "still": a little sway, and the slight
 * turn toward each target people make without noticing.
 */
export function gridSamples(seed: number, opts: EyeSimOptions = {}): CalibrationSample[] {
  const rand = rng(seed);
  const out: CalibrationSample[] = [];
  const frames = Math.round((CV_CONFIG.calibration.sampleMs / 1000) * FPS);
  CV_CONFIG.calibration.points.forEach(([x, y], pointIndex) => {
    const sway = { yaw: gaussian(rand) * 0.3, pitch: gaussian(rand) * 0.3, x: 0, y: 0 };
    for (let i = 0; i < frames; i++) {
      const head: Head = {
        yaw: 1.5 * (x - 0.5) * 2 + sway.yaw,
        pitch: 1 * (y - 0.5) * 2 + sway.pitch,
        x: sway.x,
        y: sway.y,
        z: SCREEN.distanceCm,
      };
      out.push({ features: eyeFeatures({ x, y }, head, rand, opts), target: { x, y }, pointIndex });
    }
  });
  return out;
}

/**
 * Head sweep: eyes on each dot while the head turns left/right and nods. The
 * eyes also shift a little sideways (neck pivot and natural sway), so yaw and
 * face position vary independently of the target and of each other.
 */
export function sweepSamples(seed: number, opts: EyeSimOptions & { yawAmp?: number; pitchAmp?: number } = {}): CalibrationSample[] {
  const rand = rng(seed);
  const out: CalibrationSample[] = [];
  const cfg = CV_CONFIG.calibration.headSweep;
  const frames = Math.round((cfg.sampleMs / 1000) * FPS);
  const yawAmp = opts.yawAmp ?? 9;
  const pitchAmp = opts.pitchAmp ?? 6;
  cfg.points.forEach(([x, y], k) => {
    const phase = rand() * Math.PI * 2;
    for (let i = 0; i < frames; i++) {
      const t = i / FPS;
      const yaw = yawAmp * Math.sin((2 * Math.PI * t) / 1.4 + phase);
      const pitch = pitchAmp * Math.sin((2 * Math.PI * t) / 0.9 + phase * 0.7);
      const head: Head = {
        yaw,
        pitch,
        x: 10 * Math.sin(yaw / DEG) + 1.8 * Math.sin((2 * Math.PI * t) / 1.9 + phase),
        y: 6 * Math.sin(pitch / DEG) + 0.8 * Math.sin((2 * Math.PI * t) / 1.3),
        z: SCREEN.distanceCm + 1.5 * Math.sin((2 * Math.PI * t) / 2.1),
      };
      out.push({ features: eyeFeatures({ x, y }, head, rand, opts), target: { x, y }, pointIndex: cfg.groupBase + k });
    }
  });
  return out;
}

/** Held-out validation dots, head still. */
export function validationSamples(seed: number, points = CV_CONFIG.calibration.validation.points, groupBase = CV_CONFIG.calibration.validation.groupBase, opts: EyeSimOptions = {}): CalibrationSample[] {
  const rand = rng(seed);
  const out: CalibrationSample[] = [];
  const frames = Math.round((CV_CONFIG.calibration.sampleMs / 1000) * FPS);
  points.forEach(([x, y], k) => {
    const sway = { yaw: gaussian(rand) * 0.4, pitch: gaussian(rand) * 0.4 };
    for (let i = 0; i < frames; i++) {
      const head: Head = { ...REST, yaw: 1.5 * (x - 0.5) * 2 + sway.yaw, pitch: (y - 0.5) * 2 + sway.pitch };
      out.push({ features: eyeFeatures({ x, y }, head, rand, opts), target: { x, y }, pointIndex: groupBase + k });
    }
  });
  return out;
}
