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
 *
 *   npm run setup:assets -- --check
 *
 * only verifies that both are in place (exit code 1 if not) and prints how to
 * fix it. Run it before a demo, while you are still online: the venue's
 * network is then not needed.
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
/** FilesetResolver picks the SIMD or the no-SIMD build at runtime, so both are needed. */
const REQUIRED_WASM = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
];

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

/** Verifies the assets without changing anything. */
async function check() {
  const problems = [];
  for (const file of REQUIRED_WASM) {
    const target = path.join(wasmTarget, file);
    if (!existsSync(target)) {
      problems.push(`missing public/mediapipe/wasm/${file}`);
      continue;
    }
    const source = path.join(wasmSource, file);
    if (existsSync(source) && (await stat(source)).size !== (await stat(target)).size) {
      problems.push(`public/mediapipe/wasm/${file} does not match the installed @mediapipe/tasks-vision`);
    }
  }
  let modelMb = 0;
  if (!existsSync(modelTarget)) {
    problems.push("missing public/models/face_landmarker.task");
  } else {
    const { size } = await stat(modelTarget);
    modelMb = size / 1e6;
    if (size <= MIN_MODEL_BYTES) problems.push(`public/models/face_landmarker.task looks truncated (${size} bytes)`);
  }
  if (problems.length === 0) {
    console.log(
      `[setup-assets] OK: MediaPipe WASM runtime (${REQUIRED_WASM.length} files) and Face Landmarker model (${modelMb.toFixed(1)} MB) are in place.`,
    );
    return true;
  }
  for (const problem of problems) console.error(`[setup-assets] ${problem}`);
  console.error("[setup-assets] Fix: run `npm run setup:assets` while online. It copies the WASM runtime from node_modules");
  console.error("[setup-assets] (run `npm install` first if that is missing) and downloads the model once.");
  console.error('[setup-assets] Until then the camera cannot start; "Continue without camera" still works (interaction timing only).');
  return false;
}

if (process.argv.includes("--check")) {
  process.exit((await check()) ? 0 : 1);
}

try {
  await copyWasm();
  await downloadModel();
} catch (error) {
  // Never break `npm install`; the camera screen explains how to recover.
  console.warn(`[setup-assets] ${error instanceof Error ? error.message : error}`);
  console.warn("[setup-assets] Run `npm run setup:assets` once you are online to enable camera signals.");
}
