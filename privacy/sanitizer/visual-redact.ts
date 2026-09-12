// privacy/sanitizer/visual-redact.ts
// Canvas-based visual redaction PAINTERS.
//
// Responsibilities:
// - Canvas creation/decoding helpers shared with the redaction gate.
// - Masks/blackouts or pixelates sensitive regions on a canvas.
//
// Phase 01 encode invariant: this module no longer encodes anything. The
// ONLY image-encoding path in the tree (convertToBlob/toDataURL/
// readAsDataURL) lives in privacy/sanitizer/redaction-gate.ts, which is the
// only module permitted to turn pixels into an outbound payload. The public
// redactVisual() entry point moved there with it.

import type { Detection, Viewport } from "../../types/index.js";
import { assertValidBBox } from "../engine/normalize.js";
import { scaledClampedRect, viewportToScreenshotScale } from "../../utils/coords.js";

// Every category except FACE is blacked out; FACE is pixelated. This set is
// kept for documentation/tests: painting treats "non-FACE" as blackout, so a
// new category is masked by default (fail-safe: unknown things get hidden).
export const BLACKOUT_DEFAULT = "non-FACE categories are masked";

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
export type AnyContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(w, h);
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    return canvas;
  }
  // Fail closed: never return raw pixels when no canvas is available.
  throw new Error("redactVisual: no canvas available");
}

export async function decodeImage(dataUrl: string): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    const blob = await (await fetch(dataUrl)).blob();
    return createImageBitmap(blob);
  }
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return img;
}

export function get2dContext(canvas: AnyCanvas): AnyContext {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("redactVisual: 2d context unavailable");
  return ctx;
}

// Pixelate a region: shrink it to chunky tiles, then scale back up without smoothing.
export function pixelate(
  ctx: AnyContext,
  src: CanvasImageSource,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const tilesX = Math.max(1, Math.round(w / 16));
  const tilesY = Math.max(1, Math.round(h / 16));
  const tiny = makeCanvas(tilesX, tilesY);
  const tinyCtx = get2dContext(tiny);
  tinyCtx.drawImage(src, x, y, w, h, 0, 0, tilesX, tilesY);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tiny, 0, 0, tilesX, tilesY, x, y, w, h);
}

/**
 * Paint redactions for every detection onto an already-drawn canvas (masks
 * first, then FACE pixelation), using the pinned geometry: CSS bboxes scaled
 * to device pixels, clamped to the canvas; malformed geometry fails closed
 * via assertValidBBox. Painting order matters only in that FACE pixelation
 * samples the already-masked canvas, so a blackout under a face is never
 * repainted raw.
 */
export function paintRedactions(
  ctx: AnyContext,
  canvas: AnyCanvas,
  detections: readonly Detection[],
  viewport: Viewport
): void {
  // bboxes are CSS pixels relative to the viewport; the screenshot is device pixels.
  const { scaleX, scaleY } = viewportToScreenshotScale(viewport, {
    w: canvas.width,
    h: canvas.height,
  });

  // Geometry contract (fail closed): a malformed bbox — NaN/Infinity,
  // non-array, zero/negative size — can never be silently skipped, because
  // skipping means the sensitive region's raw pixels would cross the
  // boundary. Validate everything BEFORE painting anything.
  for (const detection of detections) {
    assertValidBBox(detection.bbox, `visual redaction (${detection.category})`);
  }

  // Masks first: overlapping/adjacent same-class masks were merged by the
  // gate into single ops; paint them as one fillRect each.
  for (const op of mergedMaskOps(detections)) {
    const rect = scaledClampedRect([op.box.x, op.box.y, op.box.w, op.box.h], scaleX, scaleY, canvas.width, canvas.height);
    if (!rect) continue;
    ctx.fillStyle = "#000";
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }

  // FACE pixelation per box (geometry pinned by the privacy-boundary tests).
  for (const detection of detections) {
    if (detection.category !== "FACE") continue;
    const rect = scaledClampedRect(detection.bbox, scaleX, scaleY, canvas.width, canvas.height);
    if (!rect) continue;
    // Pixelate from the already-redacted canvas, not the raw image, so any
    // blackout drawn underneath (overlapping PII) isn't repainted raw.
    pixelate(ctx, canvas, rect.x, rect.y, rect.w, rect.h);
  }
}

/**
 * Merged mask boxes (CSS space) for non-FACE detections.
 *
 * PROVENANCE: merge rules ported from SIH26171 redaction/merge.ts — boxes
 * overlapping by IoU > MERGE_IOU merge regardless of class (two overlapping
 * masks paint the same pixels twice whatever they were called); same-class
 * boxes closer than ADJACENCY_PX merge (adjacent text runs — prevents
 * hairline gaps). Repeat to fixpoint.
 *
 * FACE is excluded: its pixelation geometry is pinned by validated tests, so
 * faces paint per-box.
 */
export interface MaskOp {
  box: { x: number; y: number; w: number; h: number };
  cls: string;
}

export const MERGE_IOU = 0.1;
export const ADJACENCY_PX = 8;

export function mergedMaskOps(detections: readonly Detection[]): MaskOp[] {
  type Op = MaskOp & { ids: string[] };
  let pending: Op[] = [];
  for (const d of detections) {
    if (d.category === "FACE") continue;
    pending.push({
      box: { x: d.bbox[0], y: d.bbox[1], w: d.bbox[2], h: d.bbox[3] },
      cls: d.category,
      ids: [d.element_id],
    });
  }

  let merged = true;
  while (merged) {
    merged = false;
    const next: Op[] = [];
    for (const op of pending) {
      const partner = next.find((c) => shouldMerge(c, op));
      if (!partner) {
        next.push(op);
        continue;
      }
      partner.box = unionBox(partner.box, op.box);
      partner.ids.push(...op.ids);
      merged = true;
    }
    pending = next;
  }
  return pending;
}

function shouldMerge(a: MaskOp, b: MaskOp): boolean {
  if (iou(a.box, b.box) > MERGE_IOU) return true;
  if (a.cls !== b.cls) return false;
  // Adjacency: boxes touch (or nearly) in both axes.
  const horizontal = a.box.x < b.box.x + b.box.w + ADJACENCY_PX && b.box.x < a.box.x + a.box.w + ADJACENCY_PX;
  const vertical = a.box.y < b.box.y + b.box.h + ADJACENCY_PX && b.box.y < a.box.y + a.box.h + ADJACENCY_PX;
  return horizontal && vertical;
}

function unionBox(a: MaskOp["box"], b: MaskOp["box"]): MaskOp["box"] {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

function iou(a: MaskOp["box"], b: MaskOp["box"]): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}
