// privacy/sanitizer/structural-redact.ts
// DOM detection rules and structural placeholder replacement
//
// Responsibilities:
// - Identifies sensitive categories (PAN, Aadhaar, Email, Phone, Amount, Password, Name).
// - Emits detection metadata with bounding boxes and confidence scores.
// - Substitutes real values with stable tokens (e.g. EMAIL_1, PAN_1).
// - Isolates real values in a local lookup map (never emitted upstream).

import type { Detection, ElementMeta, SensitiveCategory } from "../../types/index.js";

export const CATEGORIES: SensitiveCategory[] = [
  "EMAIL",
  "PAN",
  "AADHAAR",
  "AMOUNT",
  "PHONE",
  "NAME",
  "FACE",
  "PASSWORD",
];

/**
 * Detects sensitive entities in extracted DOM element metadata.
 * @param elements Extracted DOM element metadata
 */
export function detectSensitive(elements: ElementMeta[]): Detection[] {
  // TODO: Implement in chunks
  return [];
}

/**
 * Replaces sensitive values with stable placeholders and builds local mapping.
 * @param elements Extracted DOM element metadata
 * @param detections Detected sensitive entities
 */
export function applyPlaceholders(
  elements: ElementMeta[],
  detections: Detection[]
): { sanitized: ElementMeta[]; map: Record<string, string> } {
  // TODO: Implement in chunks
  return { sanitized: elements, map: {} };
}
