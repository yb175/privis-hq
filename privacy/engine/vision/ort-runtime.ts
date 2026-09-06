// privacy/engine/vision/ort-runtime.ts
// Browser-side local ONNX Runtime Web foundation — ML-6A (Box 2, vision path).
//
// Runtime infrastructure ONLY. This module knows nothing about faces, OCR,
// categories, DOM elements, Detection[] or sanitizer policy — model-specific
// preprocessing/postprocessing begins in ML-6B.
//
// Privacy rules:
// - WASM execution only, inside the extension process. No network inference,
//   no CDN: every ORT asset (glue .mjs + .wasm) is packaged in the extension
//   (copied to dist/ort/ at build time by scripts/copy-ort-assets.mjs) and
//   located exclusively through chrome.runtime.getURL().
// - No Python, no local server, no screenshots, no persistence.

import * as ort from "onnxruntime-web/wasm";

/**
 * Extension-package-relative directory holding the ORT WASM assets.
 * Keep in sync with scripts/copy-ort-assets.mjs.
 */
const ORT_WASM_ASSET_DIR = "dist/ort/";

/** Initialized vision runtime. Obtain via getVisionRuntime(). */
export interface VisionRuntime {
  /** Extension-local URL of the WASM asset directory (diagnostics/tests). */
  readonly wasmAssetUrl: string;
  /**
   * Create an inference session from an extension-local model URL
   * (e.g. chrome.runtime.getURL("dist/models/<name>.onnx")) or from raw
   * model bytes already in memory. Rejects explicitly on any failure —
   * it never returns a half-initialized session.
   */
  createSession(
    model: string | URL | Uint8Array | ArrayBuffer
  ): Promise<ort.InferenceSession>;
}

async function initRuntime(): Promise<VisionRuntime> {
  // Resolve ORT's WASM assets through chrome.runtime.getURL so every byte
  // comes from inside the extension package — never a CDN or the network.
  // chrome.runtime.getURL preserves the trailing slash; normalize anyway so
  // ORT's prefix join can never produce ".../ortort-wasm-...".
  const wasmAssetUrl = chrome.runtime.getURL(ORT_WASM_ASSET_DIR).replace(/\/*$/, "/");
  ort.env.wasm.wasmPaths = wasmAssetUrl;
  // MV3 service workers have no cross-origin isolation (no SharedArrayBuffer):
  // pin single-threaded execution so ORT never tries to spawn worker threads.
  ort.env.wasm.numThreads = 1;
  // SIMD is supported by every Chromium build we target.
  ort.env.wasm.simd = true;
  return {
    wasmAssetUrl,
    createSession: (model) => {
      // Branch to ort.InferenceSession.create's overloads
      // (string uri | Uint8Array bytes) — narrowing each call to one overload.
      const options = { executionProviders: ["wasm"] as const };
      if (typeof model === "string" || model instanceof URL) {
        return ort.InferenceSession.create(model.toString(), options);
      }
      const bytes = model instanceof Uint8Array ? model : new Uint8Array(model);
      // WASM-only in ML-6A. WebGPU/offscreen execution is future work;
      // it would be added here, behind capability detection.
      return ort.InferenceSession.create(bytes, options);
    },
  };
}

let runtimePromise: Promise<VisionRuntime> | null = null;

/**
 * Get the shared vision runtime. Safe to call repeatedly and concurrently —
 * initialization happens once and is idempotent. Failures are NOT cached
 * (a later call retries) and always reject with an explicit error; callers
 * must treat a rejection as "ML unavailable", never as "no detections found".
 */
export function getVisionRuntime(): Promise<VisionRuntime> {
  runtimePromise ??= initRuntime().catch((err) => {
    runtimePromise = null; // allow retry; never cache a failed init
    throw new Error(
      `getVisionRuntime: local ORT Web initialization failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  });
  return runtimePromise;
}
