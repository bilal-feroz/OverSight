/**
 * On-device camera pipeline: getUserMedia -> MediaPipe Face Landmarker
 * (WASM, GPU with CPU fallback) -> per-frame eye/head features.
 *
 * Privacy: frames are read by the landmarker inside this browser tab and
 * immediately reduced to a handful of numbers (EyeFeatures). No frame is
 * stored, drawn to a persistent buffer, or sent over the network.
 */
import type { FaceLandmarker, FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import type { CameraStatus, EyeFeatures } from "@/types/cv";
import { CV_CONFIG } from "./config";
import { extractEyeFeatures } from "./features";
import { EYE_BLENDSHAPES } from "./landmarks";
import { nextStride } from "./perf";

export interface RawFrame {
  t: number;
  faceCount: number;
  features: EyeFeatures | null;
  inferenceMs: number;
}

type FrameListener = (frame: RawFrame) => void;
type StatusListener = (status: CameraStatus, error: string | null) => void;

type VideoWithRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

const EYE_SET = new Set<string>(EYE_BLENDSHAPES);

export function describeCameraError(error: unknown): { status: CameraStatus; message: string } {
  const name = (error as { name?: string } | null)?.name ?? "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return {
        status: "denied",
        message: "Camera permission was denied. OverSight will use interaction timing only.",
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return { status: "unavailable", message: "No camera was found on this device." };
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return { status: "unavailable", message: "The camera is in use by another application." };
    default:
      return { status: "error", message: "The camera could not be started." };
  }
}

export class CameraEngine {
  status: CameraStatus = "idle";
  error: string | null = null;
  stream: MediaStream | null = null;
  video: VideoWithRVFC | null = null;
  delegate: "GPU" | "CPU" | null = null;
  fps = 0;
  inferenceMs = 0;
  /** Process every n-th camera frame (adapts to inference time). */
  stride = 1;
  /** Camera frames skipped by the stride since the camera started. */
  skippedFrames = 0;
  private videoFrames = 0;

  private landmarker: FaceLandmarker | null = null;
  private running = false;
  /** Incremented by stop(); a start() that finds it changed after an await gives up. */
  private generation = 0;
  private lastVideoTime = -1;
  private lastTimestamp = 0;
  private lastFrameAt = 0;
  private handle: number | null = null;
  private usingRVFC = false;
  private frameListeners = new Set<FrameListener>();
  private statusListeners = new Set<StatusListener>();

  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(status: CameraStatus, error: string | null) {
    this.status = status;
    this.error = error;
    for (const l of this.statusListeners) l(status, error);
  }

  async start(): Promise<void> {
    if (this.status === "active" || this.status === "requesting" || this.status === "loading-model") return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      this.setStatus("unavailable", "Camera access requires a secure context (https or localhost).");
      return;
    }
    const generation = ++this.generation;
    const superseded = () => generation !== this.generation;
    this.setStatus("requesting", null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: CV_CONFIG.camera.width },
          height: { ideal: CV_CONFIG.camera.height },
          frameRate: { ideal: CV_CONFIG.camera.frameRate },
        },
      });
    } catch (error) {
      if (superseded()) return;
      const { status, message } = describeCameraError(error);
      this.setStatus(status, message);
      return;
    }
    if (superseded()) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;

    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      this.stop();
      this.setStatus("unavailable", "The camera was disconnected.");
    });

    const video = this.ensureVideo();
    video.srcObject = stream;
    try {
      await video.play();
    } catch {
      // Autoplay of a muted inline stream is allowed; ignore spurious interruptions.
    }
    if (superseded()) return;

    this.setStatus("loading-model", null);
    try {
      await this.ensureLandmarker();
    } catch (error) {
      if (superseded()) return;
      console.error("[oversight] Face Landmarker failed to load", error);
      this.stopStream();
      this.setStatus(
        "error",
        "The on-device face model could not be loaded. Run `npm run setup:assets` and reload.",
      );
      return;
    }
    // Stopped (or the camera disconnected) while the model was loading.
    if (superseded()) return;

    this.running = true;
    this.setStatus("active", null);
    this.schedule();
  }

  stop() {
    this.generation++;
    this.running = false;
    if (this.handle !== null && this.video) {
      if (this.usingRVFC) this.video.cancelVideoFrameCallback?.(this.handle);
      else cancelAnimationFrame(this.handle);
    }
    this.handle = null;
    this.stopStream();
    if (this.status === "active" || this.status === "loading-model" || this.status === "requesting") {
      this.setStatus("idle", null);
    }
  }

  private stopStream() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }

  private ensureVideo(): VideoWithRVFC {
    if (this.video) return this.video;
    const video = document.createElement("video") as VideoWithRVFC;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("aria-hidden", "true");
    // Kept in the DOM (some browsers throttle detached videos) but invisible.
    Object.assign(video.style, {
      position: "fixed",
      width: "2px",
      height: "2px",
      opacity: "0",
      pointerEvents: "none",
      left: "0",
      top: "0",
    });
    document.body.appendChild(video);
    this.video = video;
    return video;
  }

  private async ensureLandmarker() {
    if (this.landmarker) return;
    const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(CV_CONFIG.model.wasmPath);
    const options = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: CV_CONFIG.model.modelPath, delegate },
      runningMode: "VIDEO" as const,
      numFaces: CV_CONFIG.model.numFaces,
      minFaceDetectionConfidence: CV_CONFIG.model.minFaceDetectionConfidence,
      minFacePresenceConfidence: CV_CONFIG.model.minFacePresenceConfidence,
      minTrackingConfidence: CV_CONFIG.model.minTrackingConfidence,
      // Used ONLY for eye-direction and blink coefficients (see EYE_BLENDSHAPES).
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
    try {
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, options("GPU"));
      this.delegate = "GPU";
    } catch (gpuError) {
      console.warn("[oversight] GPU delegate unavailable, falling back to CPU", gpuError);
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, options("CPU"));
      this.delegate = "CPU";
    }
  }

  private schedule() {
    if (!this.running || !this.video) return;
    if (typeof this.video.requestVideoFrameCallback === "function") {
      this.usingRVFC = true;
      this.handle = this.video.requestVideoFrameCallback(() => this.process());
    } else {
      this.usingRVFC = false;
      this.handle = requestAnimationFrame(() => this.process());
    }
  }

  private process() {
    const video = this.video;
    const landmarker = this.landmarker;
    if (!this.running || !video || !landmarker) return;
    if (video.readyState >= 2 && video.videoWidth > 0 && video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = video.currentTime;
      this.videoFrames++;
      if (this.videoFrames % this.stride !== 0) {
        this.skippedFrames++;
        this.schedule();
        return;
      }
      let ts = performance.now();
      if (ts <= this.lastTimestamp) ts = this.lastTimestamp + 1;
      this.lastTimestamp = ts;

      const started = performance.now();
      let result: FaceLandmarkerResult | null = null;
      try {
        result = landmarker.detectForVideo(video, ts);
      } catch (error) {
        console.warn("[oversight] landmark detection failed for a frame", error);
      }
      const inferenceMs = performance.now() - started;
      const alpha = CV_CONFIG.performance.inferenceEmaAlpha;
      this.inferenceMs = this.inferenceMs * (1 - alpha) + inferenceMs * alpha;
      this.stride = nextStride(this.stride, this.inferenceMs);
      if (this.lastFrameAt > 0) {
        const instFps = 1000 / Math.max(1, ts - this.lastFrameAt);
        this.fps = this.fps * 0.9 + instFps * 0.1;
      }
      this.lastFrameAt = ts;

      const frame = this.toFrame(result, ts, inferenceMs, video.videoWidth / video.videoHeight);
      for (const l of this.frameListeners) l(frame);
    }
    this.schedule();
  }

  private toFrame(result: FaceLandmarkerResult | null, t: number, inferenceMs: number, aspect: number): RawFrame {
    const faces = result?.faceLandmarks ?? [];
    if (!result || faces.length === 0) return { t, faceCount: 0, features: null, inferenceMs };
    // Primary face = the largest (closest) one.
    let best = 0;
    let bestSize = -1;
    faces.forEach((lm, i) => {
      const size = lm.length > 263 ? Math.abs(lm[263].x - lm[33].x) : 0;
      if (size > bestSize) {
        bestSize = size;
        best = i;
      }
    });
    // Keep only eye-direction/blink coefficients; everything else is discarded here.
    const eyeBlendshapes =
      result.faceBlendshapes?.[best]?.categories
        .filter((c) => EYE_SET.has(c.categoryName))
        .map((c) => ({ categoryName: c.categoryName, score: c.score })) ?? null;
    const matrix = result.facialTransformationMatrixes?.[best]?.data ?? null;
    const features = extractEyeFeatures(faces[best], eyeBlendshapes, matrix, aspect);
    return { t, faceCount: faces.length, features, inferenceMs };
  }
}
