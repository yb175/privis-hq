// utils/coords.ts
// The single coordinate-conversion module for the web vision path.
//
// Convention (CONTRACT.md / types/index.ts):
//   BoundingBox = [x, y, width, height], top-left origin, axis-aligned.
//   DOM/detection bboxes are CSS viewport pixels. Tab screenshots are device
//   pixels. A bbox is meaningless without its reference frame.
//
// Two conversion directions live here and deliberately use DIFFERENT
// rounding. Do not "unify" them — both are pinned by tests:
//   - screenshot -> CSS (fusion path): round-half-even, byte-identical to the
//     validated Python reference (ml/fusion/fuse.py). Parity tests pin this.
//   - CSS -> screenshot (redaction path): Math.round (half-up) plus canvas-edge
//     clamping, matching the pixel-exact canvas geometry the privacy-boundary
//     tests verify.
//
// Pure functions: no I/O, no globals, no browser APIs.

/** Python round(): round-half-to-even (JS Math.round is half-up). */
export function roundHalfEven(v: number): number {
  const f = Math.floor(v);
  const d = v - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** Screenshot-pixel bbox -> CSS-pixel bbox, given per-axis scale factors. */
export function scaleBBox(
  bbox: readonly number[],
  sx: number,
  sy: number
): [number, number, number, number] {
  const [x, y, w, h] = bbox;
  return [roundHalfEven(x * sx), roundHalfEven(y * sy), roundHalfEven(w * sx), roundHalfEven(h * sy)];
}

/** Device-pixel (screenshot) -> CSS-pixel (viewport) scale factors. */
export function screenshotToViewportScale(
  screenshot: { w: number; h: number },
  viewport: { w: number; h: number }
): { sx: number; sy: number } {
  return { sx: viewport.w / screenshot.w, sy: viewport.h / screenshot.h };
}

/**
 * CSS-pixel (viewport) -> device-pixel (screenshot) scale factors.
 * Degenerate viewport dimensions fall back to 1 (no scaling).
 */
export function viewportToScreenshotScale(
  viewport: { w: number; h: number },
  screenshot: { w: number; h: number }
): { scaleX: number; scaleY: number } {
  return {
    scaleX: viewport.w > 0 ? screenshot.w / viewport.w : 1,
    scaleY: viewport.h > 0 ? screenshot.h / viewport.h : 1,
  };
}

/**
 * Scale a CSS-pixel bbox into device pixels and clamp it to the canvas edges
 * so a bbox starting off-page does not cover unrelated content: the origin is
 * floored at 0 and the right/bottom edges shrink to fit the canvas.
 * Returns null when the clamped rect is empty (nothing to paint).
 */
export function scaledClampedRect(
  bbox: readonly number[],
  scaleX: number,
  scaleY: number,
  canvasW: number,
  canvasH: number
): { x: number; y: number; w: number; h: number } | null {
  const [bx, by, bw, bh] = bbox;
  if (bw <= 0 || bh <= 0) return null;
  const x = Math.max(0, Math.round(bx * scaleX));
  const y = Math.max(0, Math.round(by * scaleY));
  const right = Math.min(canvasW, Math.round((bx + bw) * scaleX));
  const bottom = Math.min(canvasH, Math.round((by + bh) * scaleY));
  const w = right - x;
  const h = bottom - y;
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

// ── Box geometry (Phase 01, SIH26171 shared/coords.ts port) ─────────────────
// Object-form boxes for the redaction gate's merge/policy machinery. The
// tuple BoundingBox stays the wire contract; these operate on it via box().

/** Object-form box, CSS px. Gate/merge use this shape. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type { Viewport } from "../types/index.js";

/** Tuple BoundingBox -> object Box. */
export function box(bbox: readonly number[]): Box {
  return { x: bbox[0], y: bbox[1], w: bbox[2], h: bbox[3] };
}

/** IoU of two object boxes. Mirrors fuse.ts's tuple iou. */
export function iouBoxes(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/** Total area of a union of boxes, overlapping regions counted once. */
export function unionArea(boxes: readonly Box[]): number {
  if (boxes.length === 0) return 0;
  if (boxes.length === 1) return boxes[0].w * boxes[0].h;
  // ponytail: O(n²) sweep; exact and fine at page scale (≤ hundreds of boxes).
  const events: Array<{ x: number; type: 1 | -1; i: number }> = [];
  boxes.forEach((b, i) => {
    events.push({ x: b.x, type: 1, i }, { x: b.x + b.w, type: -1, i });
  });
  events.sort((a, b) => a.x - b.x || b.type - a.type);
  let area = 0;
  let prevX = 0;
  const active = new Set<number>();
  for (let k = 0; k < events.length; k++) {
    const e = events[k]!;
    if (active.size > 0 && e.x > prevX) {
      // Merge active y-intervals.
      const spans = [...active]
        .map((i) => {
          const b = boxes[i]!;
          return [b.y, b.y + b.h] as [number, number];
        })
        .sort((p, q) => p[0] - q[0]);
      let covered = 0;
      let curY = -Infinity;
      for (const [y0, y1] of spans) {
        if (y0 > curY) {
          covered += y1 - y0;
          curY = y1;
        } else if (y1 > curY) {
          covered += y1 - curY;
          curY = y1;
        }
      }
      area += covered * (e.x - prevX);
    }
    if (e.type === 1) active.add(e.i);
    else active.delete(e.i);
    prevX = e.x;
  }
  return area;
}

/** Area of `boxes` not covered by `cover`. */
export function areaOutside(boxes: readonly Box[], cover: readonly Box[]): number {
  // ponytail: pairwise clipping; O(n·m), exact, fine at page scale.
  let area = 0;
  for (const boxA of boxes) {
    let pieces: Box[] = [boxA];
    for (const boxB of cover) {
      const next: Box[] = [];
      for (const p of pieces) {
        const x1 = Math.max(p.x, boxB.x);
        const y1 = Math.max(p.y, boxB.y);
        const x2 = Math.min(p.x + p.w, boxB.x + boxB.w);
        const y2 = Math.min(p.y + p.h, boxB.y + boxB.h);
        if (x1 < x2 && y1 < y2) {
          // Split p into the covered rect plus up to 4 uncovered remainders.
          if (p.y < y1) next.push({ x: p.x, y: p.y, w: p.w, h: y1 - p.y });
          if (y2 < p.y + p.h) next.push({ x: p.x, y: y2, w: p.w, h: p.y + p.h - y2 });
          if (p.x < x1) next.push({ x: p.x, y: y1, w: x1 - p.x, h: y2 - y1 });
          if (x2 < p.x + p.w) next.push({ x: x2, y: y1, w: p.x + p.w - x2, h: y2 - y1 });
        } else {
          next.push(p);
        }
      }
      pieces = next;
    }
    for (const p of pieces) area += p.w * p.h;
  }
  return area;
}

/** Grow a box by fixed padding on every side. */
export function padBox(b: Box, px: number): Box {
  return { x: b.x - px, y: b.y - px, w: b.w + px * 2, h: b.h + px * 2 };
}

/** Clamp a box into the viewport; returns null when nothing remains. */
export function clampToViewport(b: Box, viewport: { w: number; h: number }): Box | null {
  const x = Math.max(0, b.x);
  const y = Math.max(0, b.y);
  const w = Math.min(b.x + b.w, viewport.w) - x;
  const h = Math.min(b.y + b.h, viewport.h) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}
