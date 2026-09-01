// privacy/sanitizer/visual-redact.ts
// Canvas-based visual redaction engine
//
// Responsibilities:
// - Takes in-memory screenshot data URL, sensitive bounding boxes, and viewport dimensions.
// - Masks/blackouts or pixelates sensitive regions on an OffscreenCanvas.
// - Returns sanitized image data URL (raw image is never emitted or retained).

import type { Detection, Viewport } from "../../types/index.js";

/**
 * Redacts sensitive bounding box regions on an in-memory image copy.
 * @param dataUrl Raw screenshot data URL
 * @param detections Sensitive detected regions
 * @param viewport Viewport dimensions for DPI scaling
 */
export async function redactVisual(
  dataUrl: string,
  detections: Detection[],
  viewport: Viewport
): Promise<string> {
  // TODO: Implement in chunks
  throw new Error("Not implemented");
}
