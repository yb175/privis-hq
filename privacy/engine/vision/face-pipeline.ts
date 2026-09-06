// privacy/engine/vision/face-pipeline.ts
// M6-D: browser-local FACE inference wired into the PRIVIS capture pipeline.
//
// Target flow (CONTRACT.md capture -> inference -> fusion -> sanitizer):
//   capturePackage() screenshot (in-memory PNG data URL)
//     -> decode to RGBA (in memory, no disk, no storage)
//     -> validated browser-local YuNet detector (M6-B/B2/C, threshold 0.35)
//     -> M4 fusion rules (privacy/engine/fuse.ts, port of ml/fusion/fuse.py)
//     -> one Detection[] list (DOM + vision) for the existing sanitizer path.
//
// FAIL-CLOSED (critical): any detector/decode/load error REJECTS
// runVisionPath(), which rejects runStep() — the policy gate is never
// evaluated and no remote request is made. A failed detector must NEVER
// degrade to detections = [] (that would send an unsanitized screenshot to
// the remote agent). Zero faces (a valid outcome) is Detection[] length 0
// with a successful inference behind it, which is different from failure.
//
// Privacy: the raw screenshot dataUrl and the RGBA pixels stay in memory in
// this module; nothing is written to disk or extension storage; the emitted
// detections carry metadata only (category/bbox/confidence/element_id).
// fetch() is used ONLY on the in-memory data: URL (same pattern as
// privacy/sanitizer/visual-redact.ts decodeImage) — never on http(s).

import type { Detection, ElementMeta, Viewport } from "../../../types/index.js";
import { fuseDetections } from "../fuse.js";
import {
  loadFaceDetector,
  type FaceDetector,
  type FaceDetectorInput,
} from "./face-detector.js";

export interface VisionPathOptions {
  /** Raw screenshot PNG data URL (already in memory from capturePackage()). */
  dataUrl: string;
  /** ElementMeta[] from the Capture Layer content script. */
  elements: readonly ElementMeta[];
  /** DOM-path detections (detectSensitive output, source:"dom"). */
  domDetections: readonly Detection[];
  /** CSS viewport dimensions. */
  viewport: Viewport;
  /**
   * Test injection for the detector factory. Default: the shared cached
   * detector (M6-A runtime design — one model load + one session per
   * service-worker lifetime; failures are not cached and are re-attempted).
   */
  loadDetector?: () => Promise<FaceDetector>;
  /**
   * Test injection for dataUrl -> RGBA decoding. Default: browser-native
   * fetch(data:) + createImageBitmap + OffscreenCanvas (service worker).
   */
  decode?: (dataUrl: string) => Promise<FaceDetectorInput>;
}

/** Browser-native decode: PNG data URL -> RGBA pixels (in memory only). */
async function decodeDataUrlToRGBA(dataUrl: string): Promise<FaceDetectorInput> {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas === "undefined") {
    // Fail closed: no browser image API -> no inference -> step fails.
    throw new Error("runVisionPath: createImageBitmap/OffscreenCanvas unavailable");
  }
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("runVisionPath: 2d context unavailable");
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return {
      width: bitmap.width,
      height: bitmap.height,
      data: imageData.data, // RGBA, same layout the detector preprocess expects
    };
  } finally {
    bitmap.close();
  }
}

// Shared detector promise: loaded once, session reused for every step
// (M6-A runtime design). A failed load resets the promise so the next step
// retries — but the CURRENT step still fails closed via the rejection.
let sharedDetector: Promise<FaceDetector> | null = null;

function getSharedDetector(): Promise<FaceDetector> {
  if (sharedDetector === null) {
    sharedDetector = loadFaceDetector().catch((err) => {
      sharedDetector = null; // don't cache failures
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`runVisionPath: face detector unavailable (fail-closed): ${detail}`);
    });
  }
  return sharedDetector;
}

/**
 * Runs the M6-D vision path on the in-memory screenshot and returns the
 * FUSED Detection[] (DOM + vision, M4 rules). Any failure (decode, model
 * load, inference, fusion input) rejects — callers must treat the rejection
 * as "abort the step, send nothing to the remote agent".
 */
export async function runVisionPath(opts: VisionPathOptions): Promise<Detection[]> {
  const decode = opts.decode ?? decodeDataUrlToRGBA;
  const loadDetector = opts.loadDetector ?? getSharedDetector;

  // Decode and load can run concurrently; both must succeed.
  const [input, detector] = await Promise.all([decode(opts.dataUrl), loadDetector()]);

  // Inference. Throws on internal failure (fail-closed); [] = no faces.
  const visionDetections = await detector.detect(input);

  // M4 fusion: screenshot-pixel bboxes -> CSS viewport coordinates.
  return fuseDetections(
    opts.elements,
    opts.domDetections,
    visionDetections,
    { w: input.width, h: input.height },
    opts.viewport
  );
}
