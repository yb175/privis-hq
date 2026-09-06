// privacy/engine/vision/face-detector.ts
// Browser-local YuNet FACE detection — ML-6C (Box 2, vision path).
//
// Faithful TypeScript port of the VALIDATED offline reference
// (ml/inference/yunet_detector.py), which reproduces OpenCV's
// cv2.FaceDetectorYN exactly (M6-B cross-check). Same artifact, same
// preprocessing, same decode, same NMS, same operating point (0.35 — the
// M6-B2 approved threshold). Do not redesign the algorithm here; change the
// Python reference first, then re-port.
//
// UNWIRED: this module is not connected to the service-worker capture
// pipeline, sanitizer, policy gate, remote agent, executor, or DOM/vision
// fusion. Those come in later milestones.
//
// Privacy rules (mirrors ort-runtime.ts):
// - Inference is local (ORT Web WASM via the M6-A runtime). The only fetch
//   is chrome.runtime.getURL() for the packaged model file — extension-local
//   bytes, never the network, never a CDN.
// - Input is in-memory RGBA pixels; nothing is written to disk; the model
//   never sees or produces image content — output is Detection metadata only.
// - SHA-256 of the model is verified before the session is created
//   (supply-chain gate, same hash as the offline validation).

import type { Detection } from "../../../types/index.js";
import * as ort from "onnxruntime-web/wasm";
import { getVisionRuntime } from "./ort-runtime.js";

/** The validated YuNet 2023mar artifact (opencv_zoo, MIT © 2020 Shiqi Yu).
 * Keep in sync with scripts/copy-ort-assets.mjs and the offline reference. */
const MODEL_ASSET_URL = "dist/models/face_detection_yunet_2023mar.onnx";
const EXPECTED_SHA256 =
  "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4";
const EXPECTED_SIZE = 232589;

/** The 2023mar artifact declares a fixed [1,3,640,640] input (ONNX Runtime
 * enforces it; OpenCV DNN did not — documented M6-B deviation). */
const INPUT_SIZE = 640;
const STRIDES = [8, 16, 32] as const;
/** M6-B2 approved operating point (upstream default was 0.60; 0.35 is the
 * evidence-backed threshold — see ml/models/face_detection_yunet/README.md). */
export const SCORE_THRESHOLD = 0.35;
const NMS_IOU_THRESHOLD = 0.3;
const TOP_K = 5000;

/** In-memory RGBA image (ImageData-shaped). Suitable for the capture/runtime
 * architecture; the detector never persists it. */
export interface FaceDetectorInput {
  readonly width: number;
  readonly height: number;
  /** RGBA, 8-bit, length = width * height * 4. */
  readonly data: Uint8ClampedArray | Uint8Array;
}

/** Loaded, verified, ready detector. Obtain via loadFaceDetector(). */
export interface FaceDetector {
  /** Detect faces. Metadata only; deterministic; fail-explicit (rejects —
   * never resolves to a "no faces" sentinel on error). */
  detect(input: FaceDetectorInput): Promise<Detection[]>;
  /** Extension-local model URL used (diagnostics/tests). */
  readonly modelUrl: string;
}

// ---------------------------------------------------------------------------
// Numeric parity helpers
// ---------------------------------------------------------------------------

/** Python round(): round-half-to-even (JS Math.round is half-up). */
function roundHalfEven(v: number): number {
  const f = Math.floor(v);
  const d = v - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ---------------------------------------------------------------------------
// Preprocessing — port of yunet_detector.preprocess (PIL semantics)
// ---------------------------------------------------------------------------

interface Resized {
  /** RGB, nw*nh*3, row-major. */
  rgb: Float64Array;
  nw: number;
  nh: number;
  /** letterbox scale = INPUT_SIZE / max(w, h) */
  scale: number;
}

/**
 * Pillow Resampling.BILINEAR (triangle filter, support scaled on downscale),
 * applied separably, computed in float. Pillow's encoder quantizes weights to
 * fixed point; the residual sub-LSB intensity difference is a documented,
 * tolerance-covered deviation (boxes <= 1 px, confidence <= 0.01).
 */
function resizeBilinearRGB(
  src: FaceDetectorInput,
  nw: number,
  nh: number
): Float64Array {
  const { width: sw, height: sh, data } = src;
  const out = new Float64Array(nw * nh * 3);
  // Intermediate: horizontally-resampled rows at output width, input height.
  const mid = new Float64Array(nw * sh * 3);
  const xs = sw / nw; // per-axis scale
  for (let oy = 0; oy < sh; oy++) {
    const srcRow = oy * sw * 4;
    for (let ox = 0; ox < nw; ox++) {
      const center = (ox + 0.5) * xs - 0.5;
      const support = Math.max(1, xs);
      const x0 = Math.ceil(center - support);
      const x1 = Math.floor(center + support);
      let wsum = 0;
      let r = 0, g = 0, b = 0;
      for (let x = x0; x <= x1; x++) {
        const xc = x < 0 ? 0 : x > sw - 1 ? sw - 1 : x; // clamp, PIL-style
        const t = (x - center) / xs;
        const w = Math.max(0, 1 - Math.abs(t));
        if (w === 0) continue;
        wsum += w;
        const i = srcRow + xc * 4;
        r += w * data[i];
        g += w * data[i + 1];
        b += w * data[i + 2];
      }
      const m = (oy * nw + ox) * 3;
      mid[m] = r / wsum;
      mid[m + 1] = g / wsum;
      mid[m + 2] = b / wsum;
    }
  }
  const ys = sh / nh;
  for (let oy = 0; oy < nh; oy++) {
    const center = (oy + 0.5) * ys - 0.5;
    const support = Math.max(1, ys);
    const y0 = Math.ceil(center - support);
    const y1 = Math.floor(center + support);
    for (let ox = 0; ox < nw; ox++) {
      let wsum = 0;
      let r = 0, g = 0, b = 0;
      for (let y = y0; y <= y1; y++) {
        const yc = y < 0 ? 0 : y > sh - 1 ? sh - 1 : y;
        const t = (y - center) / ys;
        const w = Math.max(0, 1 - Math.abs(t));
        if (w === 0) continue;
        wsum += w;
        const m = (yc * nw + ox) * 3;
        r += w * mid[m];
        g += w * mid[m + 1];
        b += w * mid[m + 2];
      }
      const o = (oy * nw + ox) * 3;
      out[o] = r / wsum;
      out[o + 1] = g / wsum;
      out[o + 2] = b / wsum;
    }
  }
  return out;
}

function preprocess(input: FaceDetectorInput): { blob: Float32Array; scale: number } {
  const { width: w, height: h } = input;
  const scale = INPUT_SIZE / Math.max(w, h);
  const nw = Math.max(1, roundHalfEven(w * scale));
  const nh = Math.max(1, roundHalfEven(h * scale));
  const rgb = w === nw && h === nh
    ? // identity: PIL resize to the same size is a copy
      rgbaToRgb(input)
    : resizeBilinearRGB(input, nw, nh);
  // Letterbox: anchor top-left, zero-pad right/bottom to 640x640; BGR, NCHW.
  const blob = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const s = (y * nw + x) * 3;
      const r = rgb[s], g = rgb[s + 1], b = rgb[s + 2];
      const p = y * INPUT_SIZE + x;
      blob[p] = b;                       // channel 0 = B
      blob[INPUT_SIZE * INPUT_SIZE + p] = g; // channel 1 = G
      blob[2 * INPUT_SIZE * INPUT_SIZE + p] = r; // channel 2 = R
    }
  }
  return { blob, scale };
}

function rgbaToRgb(input: FaceDetectorInput): Float64Array {
  const { width: w, height: h, data } = input;
  const out = new Float64Array(w * h * 3);
  for (let i = 0, o = 0; i < w * h * 4; i += 4, o += 3) {
    out[o] = data[i];
    out[o + 1] = data[i + 1];
    out[o + 2] = data[i + 2];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Decode + NMS — port of decode_stride / nms (validated against OpenCV)
// ---------------------------------------------------------------------------

interface Candidate {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
}

function decodeStride(
  cls: Float32Array,
  obj: Float32Array,
  bbox: Float32Array,
  stride: number
): Candidate[] {
  const cols = INPUT_SIZE / stride;
  const n = cols * cols;
  if (cls.length !== n || obj.length !== n || bbox.length !== n * 4) {
    throw new Error(
      `face-detector: malformed YuNet output at stride ${stride}: expected ${n} cells,` +
        ` got cls=${cls.length}, obj=${obj.length}, bbox=${bbox.length}`
    );
  }
  const out: Candidate[] = [];
  for (let idx = 0; idx < n; idx++) {
    const score = Math.sqrt(clamp01(cls[idx]) * clamp01(obj[idx]));
    if (score < SCORE_THRESHOLD) continue;
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const b = idx * 4;
    const cx = (c + bbox[b]) * stride;
    const cy = (r + bbox[b + 1]) * stride;
    const w = Math.exp(bbox[b + 2]) * stride;
    const h = Math.exp(bbox[b + 3]) * stride;
    out.push({ x: cx - w / 2, y: cy - h / 2, w, h, score });
  }
  return out;
}

function iou(a: Candidate, b: Candidate): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

function nms(candidates: Candidate[]): Candidate[] {
  // Score-descending, ties by candidate order — deterministic (Python parity).
  const order = candidates.map((c, i) => ({ c, i })).sort((p, q) =>
    q.c.score - p.c.score || p.i - q.i
  );
  const suppressed = new Array<boolean>(candidates.length).fill(false);
  const kept: Candidate[] = [];
  for (const { c, i } of order) {
    if (suppressed[i]) continue;
    kept.push(c);
    if (kept.length >= TOP_K) break;
    for (const { c: oc, i: j } of order) {
      if (j !== i && !suppressed[j] && iou(c, oc) > NMS_IOU_THRESHOLD) {
        suppressed[j] = true;
      }
    }
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Detector lifecycle
// ---------------------------------------------------------------------------

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

/**
 * Load the YuNet 2023mar model and return a ready detector.
 *
 * In the extension the model is read from the packaged asset
 * (dist/models/, copied at build time). `modelBytes` lets a test harness
 * inject already-loaded bytes (same supply-chain checks still apply).
 * Fails explicitly — never returns a detector that would silently emit [].
 */
export async function loadFaceDetector(
  modelBytes?: Uint8Array
): Promise<FaceDetector> {
  let bytes: Uint8Array;
  if (modelBytes !== undefined) {
    bytes = modelBytes;
  } else {
    const url = chrome.runtime.getURL(MODEL_ASSET_URL);
    const res = await fetch(url); // extension-local bytes only
    if (!res.ok) throw new Error(`face-detector: model fetch failed: ${res.status}`);
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  if (bytes.length !== EXPECTED_SIZE) {
    throw new Error(
      `face-detector: model size mismatch: expected ${EXPECTED_SIZE}, got ${bytes.length}`
    );
  }
  const sha = await sha256Hex(bytes);
  if (sha !== EXPECTED_SHA256) {
    throw new Error(
      `face-detector: model SHA-256 mismatch: expected ${EXPECTED_SHA256}, got ${sha}`
    );
  }
  const runtime = await getVisionRuntime();
  const session = await runtime.createSession(bytes);
  const inputName = session.inputNames[0];
  const outputNames = new Set(session.outputNames);

  return {
    modelUrl: chrome.runtime.getURL(MODEL_ASSET_URL),
    async detect(input: FaceDetectorInput): Promise<Detection[]> {
      const { blob, scale } = preprocess(input);
      const feeds = { [inputName]: new ort.Tensor("float32", blob, [1, 3, INPUT_SIZE, INPUT_SIZE]) };
      const raw = await session.run(feeds);
      const candidates: Candidate[] = [];
      for (const stride of STRIDES) {
        for (const prefix of [`cls_${stride}`, `obj_${stride}`, `bbox_${stride}`] as const) {
          if (!outputNames.has(prefix)) {
            throw new Error(`face-detector: model output "${prefix}" missing`);
          }
        }
        candidates.push(
          ...decodeStride(
            raw[`cls_${stride}`].data as Float32Array,
            raw[`obj_${stride}`].data as Float32Array,
            raw[`bbox_${stride}`].data as Float32Array,
            stride
          )
        );
      }
      const picked = nms(candidates);
      const wImg = input.width;
      const hImg = input.height;
      const detections: Detection[] = [];
      for (const c of picked) {
        const x0 = Math.max(0, c.x / scale);
        const y0 = Math.max(0, c.y / scale);
        const x1 = Math.min(wImg, (c.x + c.w) / scale);
        const y1 = Math.min(hImg, (c.y + c.h) / scale);
        if (x1 - x0 < 1 || y1 - y0 < 1) continue; // degenerate after clipping
        detections.push({
          // vision-<i> per the fusion contract for unmatched vision
          // detections (ml/README.md, ML-4). Final element_id alignment with
          // DOM elements belongs to fusion (M4), not the detector.
          element_id: `vision-${detections.length}`,
          category: "FACE",
          bbox: [
            roundHalfEven(x0),
            roundHalfEven(y0),
            roundHalfEven(x1 - x0),
            roundHalfEven(y1 - y0),
          ],
          confidence: roundHalfEven(c.score * 10000) / 10000,
          source: "vision",
        });
      }
      return detections;
    },
  };
}
