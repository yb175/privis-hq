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
