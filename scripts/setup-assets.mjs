#!/usr/bin/env node
/**
 * Prepares the on-device computer-vision assets.
 *
 * 1. Copies the MediaPipe Tasks Vision WASM runtime from node_modules into
 *    public/mediapipe/wasm so it is served from this origin.
 * 2. Downloads the official MediaPipe Face Landmarker model (Apache-2.0) into
 *    public/models/face_landmarker.task, once.
 *
 * At runtime the app loads both from its own origin. No camera data is ever
 * sent anywhere; this script only fetches the model file at install time.
 */
import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmSource = path.join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const wasmTarget = path.join(root, "public", "mediapipe", "wasm");
const modelTarget = path.join(root, "public", "models", "face_landmarker.task");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const MIN_MODEL_BYTES = 1_000_000;

async function copyWasm() {
  if (!existsSync(wasmSource)) {
    console.warn("[setup-assets] @mediapipe/tasks-vision not installed yet; skipping WASM copy.");
    return;
  }
  await mkdir(wasmTarget, { recursive: true });
  const files = await readdir(wasmSource);
  for (const file of files) {
    await copyFile(path.join(wasmSource, file), path.join(wasmTarget, file));
  }
  console.log(`[setup-assets] Copied ${files.length} MediaPipe WASM files -> public/mediapipe/wasm`);
}

async function downloadModel() {
  if (existsSync(modelTarget)) {
    const { size } = await stat(modelTarget);
    if (size > MIN_MODEL_BYTES) {
      console.log(`[setup-assets] Face Landmarker model present (${(size / 1e6).toFixed(1)} MB)`);
      return;
    }
  }
  await mkdir(path.dirname(modelTarget), { recursive: true });
  console.log("[setup-assets] Downloading Face Landmarker model from storage.googleapis.com ...");
  const response = await fetch(MODEL_URL);
  if (!response.ok) {
    throw new Error(`Model download failed: HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < MIN_MODEL_BYTES) {
    throw new Error(`Model download looks truncated (${bytes.byteLength} bytes)`);
  }
  await writeFile(modelTarget, bytes);
  console.log(`[setup-assets] Saved model (${(bytes.byteLength / 1e6).toFixed(1)} MB) -> public/models`);
}

try {
  await copyWasm();
  await downloadModel();
} catch (error) {
  // Never break `npm install`; the camera screen explains how to recover.
  console.warn(`[setup-assets] ${error instanceof Error ? error.message : error}`);
  console.warn("[setup-assets] Run `npm run setup:assets` once you are online to enable camera signals.");
}
