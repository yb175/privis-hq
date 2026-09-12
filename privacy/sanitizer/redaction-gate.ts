// privacy/sanitizer/redaction-gate.ts
// THE GATE — the one-way redaction boundary.
//
// PROVENANCE: seal()/encode()/receipt/manifest structure ported from the
// approved reference repo PravAl2028/SIH26171, extension/src/redaction/gate.ts
// (author-granted permission, Phase 01), adapted to PRIVIS: data-URL in/out
// instead of raw ImageBitmap/bytes, Detection[] instead of Finding[], merge
// rules from redaction/merge.ts applied to mask ops (see visual-redact.ts).
//
// This file is the only module in the tree permitted to encode a canvas.
// tests/test-encode-invariant.ts greps both the source tree and the built
// bundles for encoding calls (convertToBlob / toDataURL / readAsDataURL)
// outside this file, so the invariant is enforced by a test, not by memory.
//
// The weak claim, which every team makes: we redact PII before sending.
// The strong claim, which this file buys: the encoder that produces the
// outbound payload cannot read the unredacted buffer, because by the time it
// runs that buffer does not exist in this process.
//
// Two steps, not interchangeable:
//
//   seal(raw, detections, viewport)   paints redactions onto a fresh canvas,
//                                     closes the source bitmap, and stamps a
//                                     receipt into a WeakMap keyed by that
//                                     canvas.
//   encode(sealed)                    the single encoding call in the project.
//                                     Throws if the canvas carries no receipt.
//
// The receipt lives in a WeakMap so it is collected with the canvas and cannot
// be carried anywhere the pixels are not. There is no way to look up "the
// receipt for these findings" — only "the receipt for this canvas".
//
// Where the two hashes are computed, and one ordering constraint.
// `manifestHash` is computed in seal(), over the canonicalised manifest.
// `hash`, over the encoded bytes, cannot be: the bytes do not exist until the
// encoder has run, and encoding is the one thing seal() must not do. So
// encode() completes the receipt with the byte digest. The outbound boundary
// (remote-agent/receipt.ts) then recomputes both independently and refuses to
// transmit on either mismatch — that is the guarantee that actually matters.
//
// Deviations from the SIH26171 gate, deliberately:
// - FACE is pixelated (PRIVIS's test-pinned geometry), not filter-blurred.
// - No per-class confidence floor / 'keep' mode: PRIVIS paints every finding
//   (over-redaction is recoverable, a leak is not) and the policy gate
//   escalates low-confidence detections to human approval upstream.
// - No Set-of-Mark chips (PRIVIS's model contract has no element indexing
//   yet; available in the source repo when that lands).

import type {
  Detection,
  RedactionManifest,
  RedactionReceipt,
  Viewport,
} from "../../types/index.js";
import { areaOutside, unionArea } from "../../utils/coords.js";
import {
  decodeImage,
  get2dContext,
  makeCanvas,
  mergedMaskOps,
  paintRedactions,
  type AnyCanvas,
} from "./visual-redact.js";

/** The scheme name that goes in the manifest, so a future format change is detectable. */
export const POLICY_VERSION = "privis-p1";

/** A canvas that has been through seal(). The receipt is what encode() looks for. */
export interface SealedCanvas {
  canvas: AnyCanvas;
  receipt: RedactionReceipt;
  manifest: RedactionManifest;
}

/** The decoded source image, closed by seal() on every path. */
export interface SourceBitmap {
  readonly width: number;
  readonly height: number;
  close(): void;
}

/**
 * The receipts. A WeakMap keyed by canvas, so a receipt cannot outlive the
 * pixels it describes and cannot be handed to anything holding a different
 * canvas.
 */
const RECEIPTS = new WeakMap<AnyCanvas, RedactionReceipt>();

/**
 * Paint every finding onto a fresh canvas, then stamp the receipt.
 *
 * The source bitmap is closed before this returns, on every path. That is the
 * sentence the whole module exists to make true: after seal(), the unredacted
 * pixels are not reachable from this process, so no later mistake — a debug
 * flag, a caching layer, a well-meaning refactor — can encode them.
 */
export async function seal(
  raw: SourceBitmap,
  detections: Detection[],
  viewport: Viewport,
  now: () => number = Date.now
): Promise<SealedCanvas> {
  let sealed: SealedCanvas | undefined;
  try {
    const canvas = makeCanvas(raw.width, raw.height);
    const ctx = get2dContext(canvas);
    if (!ctx) throw new Error("gate: no 2d context");

    ctx.drawImage(raw as unknown as CanvasImageSource, 0, 0);
    paintRedactions(ctx, canvas, detections, viewport);

    const manifest = buildManifest(detections, viewport);
    const receipt: RedactionReceipt = {
      algo: "SHA-256",
      // Filled by encode(): these bytes do not exist yet, and producing them
      // is the one thing seal() must not do.
      hash: "",
      manifestHash: await manifestDigest(manifest),
      sealedAt: now(),
    };

    sealed = { canvas, receipt, manifest: { ...manifest, receipt } };
    RECEIPTS.set(canvas, receipt);
    return sealed;
  } finally {
    // Every path, including a throwing makeCanvas: the unredacted pixels must
    // not survive this call in any reachable form.
    raw.close();
  }
}

/**
 * Encode sealed pixels. The only encoder call in the project.
 *
 * Throws when handed a canvas with no receipt. That is not a defensive
 * nicety: it is what makes "unsealed pixels cannot leave" a property of the
 * code rather than of whoever remembered to call seal first.
 */
export async function encode(
  sealed: SealedCanvas
): Promise<{ dataUrl: string; sha256: string; manifest: RedactionManifest }> {
  const receipt = RECEIPTS.get(sealed.canvas);
  if (!receipt) throw new Error("gate: unsealed canvas reached the encoder");
  if (receipt !== sealed.receipt) {
    throw new Error("gate: receipt does not belong to this canvas");
  }

  const dataUrl = await canvasToPngDataUrl(sealed.canvas);
  const sha256 = await digest(dataUrlToBytes(dataUrl));

  // Complete the receipt in place, so the manifest the boundary verifies is
  // the one the gate produced rather than a copy someone assembled afterwards.
  receipt.hash = sha256;
  sealed.receipt.hash = sha256;
  sealed.manifest.receipt.hash = sha256;

  return { dataUrl, sha256, manifest: sealed.manifest };
}

/**
 * The full gate path for the orchestrator: decode → seal → encode.
 * Returns the sanitized data URL plus the manifest carrying the receipt every
 * outbound boundary verifies.
 */
export async function sealAndRedact(
  dataUrl: string,
  detections: Detection[],
  viewport: Viewport,
  now: () => number = Date.now
): Promise<{ sanitizedScreenshot: string; manifest: RedactionManifest }> {
  const img = await decodeImage(dataUrl);
  const raw: SourceBitmap =
    "close" in img && typeof (img as any).close === "function"
      ? (img as ImageBitmap)
      : Object.assign(img, { close: () => {} });
  const sealed = await seal(raw, detections, viewport, now);
  const encoded = await encode(sealed);
  return { sanitizedScreenshot: encoded.dataUrl, manifest: encoded.manifest };
}

/**
 * Compatibility entry point (the pre-gate public API): sanitized data URL only.
 * The manifest/receipt are computed and discarded — callers that cross the
 * network must use sealAndRedact() and attach the manifest.
 */
export async function redactVisual(
  dataUrl: string,
  detections: Detection[],
  viewport: Viewport
): Promise<string> {
  return (await sealAndRedact(dataUrl, detections, viewport)).sanitizedScreenshot;
}

// ── Encoding: the only place pixels become an outbound payload ────────────────

async function canvasToPngDataUrl(canvas: AnyCanvas): Promise<string> {
  const offscreen = canvas as OffscreenCanvas;
  if (typeof offscreen.convertToBlob === "function") {
    return blobToDataUrl(await offscreen.convertToBlob({ type: "image/png" }));
  }
  return (canvas as HTMLCanvasElement).toDataURL("image/png");
}

function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader !== "undefined") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
    return `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
  });
}

/** Decode a data: URL to its raw bytes (for independent digest recomputation). */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma === -1) {
    throw new Error("gate: not a data URL");
  }
  const meta = dataUrl.slice(5, comma);
  const payload = dataUrl.slice(comma + 1);
  if (!meta.includes("base64")) {
    throw new Error("gate: only base64 data URLs are supported");
  }
  const bin = atob(payload);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ── Digests ───────────────────────────────────────────────────────────────────

/** SHA-256 over bytes, hex. The outbound boundary recomputes this independently. */
export async function digest(bytes: Uint8Array): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── The manifest ──────────────────────────────────────────────────────────────

function buildManifest(detections: Detection[], viewport: Viewport): Omit<RedactionManifest, "receipt"> {
  const counts: Partial<Record<Detection["category"], number>> = {};
  for (const d of detections) {
    counts[d.category] = (counts[d.category] ?? 0) + 1;
  }

  // Painted area, in CSS px: merged mask boxes + per-box FACE regions.
  const painted: Array<{ x: number; y: number; w: number; h: number }> =
    mergedMaskOps(detections).map((op) => op.box);
  for (const d of detections) {
    if (d.category === "FACE") {
      painted.push({ x: d.bbox[0], y: d.bbox[1], w: d.bbox[2], h: d.bbox[3] });
    }
  }
  const detectedBoxes = detections.map((d) => ({
    x: d.bbox[0],
    y: d.bbox[1],
    w: d.bbox[2],
    h: d.bbox[3],
  }));

  // Two different numbers, deliberately. How much of the page is hidden, and
  // how much of what we hid covered nothing anyone detected (over-redaction).
  const viewportArea = Math.max(1, viewport.w * viewport.h);
  const paintedArea = unionArea(painted);
  const redactedFraction = clamp01(paintedArea / viewportArea);
  const overRedactedFraction =
    paintedArea === 0 ? 0 : clamp01(areaOutside(painted, detectedBoxes) / paintedArea);

  return { counts, redactedFraction, overRedactedFraction, policyVersion: POLICY_VERSION };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** SHA-256 over the canonicalised manifest, hex. The boundary recomputes it. */
export async function manifestDigest(
  manifest: Omit<RedactionManifest, "receipt">
): Promise<string> {
  return digest(new TextEncoder().encode(canonicaliseManifest(manifest)));
}

/**
 * The canonical form. Deterministic by construction: fixed key order, sorted
 * category names, and every number formatted to a fixed precision so float
 * noise cannot change the string. Two processes have to agree on this string.
 */
export function canonicaliseManifest(manifest: Omit<RedactionManifest, "receipt">): string {
  const counts = Object.keys(manifest.counts)
    .sort()
    .map((k) => `${k}=${String(manifest.counts[k as Detection["category"]] ?? 0)}`);
  return [
    `v=${manifest.policyVersion}`,
    `rf=${num(manifest.redactedFraction)}`,
    `orf=${num(manifest.overRedactedFraction)}`,
    `counts=${counts.join(",")}`,
  ].join("\n");
}

/** Six decimal places, always. */
function num(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : "0.000000";
}
