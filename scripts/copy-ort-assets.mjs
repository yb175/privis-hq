// scripts/copy-ort-assets.mjs
// Copies local inference assets into dist/ so the extension packages them:
//
// 1. ONNX Runtime Web WASM assets -> dist/ort/ (the M6-A runtime loads these
//    from chrome.runtime.getURL at runtime — never fetched from the network).
// 2. The validated YuNet 2023mar model -> dist/models/ (M6-C face detector
//    asset), with a build-time SHA-256 verification (supply-chain gate — the
//    same hash the detector re-verifies at load).
//
// Keep in sync with privacy/engine/vision/ort-runtime.ts (ORT_WASM_ASSET_DIR)
// and privacy/engine/vision/face-detector.ts (MODEL_ASSET_URL).

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "node_modules", "onnxruntime-web", "dist");
const dest = join(root, "dist", "ort");

const ASSETS = [
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
];

// Validated YuNet 2023mar artifact (M6-B/M6-B2 approved, SHA-256 pinned).
const MODEL_SRC = join(root, "ml", "models", "face_detection_yunet", "face_detection_yunet_2023mar.onnx");
const MODEL_DEST = join(root, "dist", "models", "face_detection_yunet_2023mar.onnx");
const MODEL_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4";
const MODEL_SIZE = 232589;

if (existsSync(MODEL_SRC)) {
  const bytes = readFileSync(MODEL_SRC);
  if (bytes.length !== MODEL_SIZE) {
    throw new Error(`copy-ort-assets: model size mismatch: ${MODEL_SRC} is ${bytes.length} bytes, expected ${MODEL_SIZE}`);
  }
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== MODEL_SHA256) {
    throw new Error(`copy-ort-assets: model SHA-256 mismatch: ${MODEL_SRC} is ${sha}, expected ${MODEL_SHA256}`);
  }
  mkdirSync(dirname(MODEL_DEST), { recursive: true });
  copyFileSync(MODEL_SRC, MODEL_DEST);
  console.log("copy-ort-assets: face_detection_yunet_2023mar.onnx (verified) -> dist/models/");
} else {
  throw new Error(`copy-ort-assets: validated model missing at ${MODEL_SRC} (M6-C asset)`);
}

if (!existsSync(src)) {
  throw new Error(`copy-ort-assets: onnxruntime-web not installed at ${src} — run npm install`);
}
// Fail loudly (with the actual contents) if a future version renames assets.
for (const name of ASSETS) {
  if (!existsSync(join(src, name))) {
    throw new Error(
      `copy-ort-assets: expected asset "${name}" missing from ${src}. ` +
        `Available: ${readdirSync(src).filter((f) => f.startsWith("ort-wasm")).join(", ")}`
    );
  }
}

mkdirSync(dest, { recursive: true });
for (const name of ASSETS) {
  copyFileSync(join(src, name), join(dest, name));
  console.log(`copy-ort-assets: ${name} -> dist/ort/`);
}
