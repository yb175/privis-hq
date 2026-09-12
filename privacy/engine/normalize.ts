// privacy/engine/normalize.ts
// Canonical sensitive-finding contract enforcement.
//
// `Detection` (types/index.ts) IS the canonical finding model shared by every
// detection path (DOM rules, vision, future OCR). This module is its
// enforcement layer: every detection entering the privacy pipeline from an
// untrusted origin (content-script capture, offscreen message channel,
// external callers) must pass through normalizeDetection(s) before it reaches
// the Sanitizer or the Policy Gate.
//
// Fail-closed rule (CONTRACT.md): a finding that cannot be proven well-formed
// throws PrivacyError and aborts the step. It is NEVER silently dropped —
// dropping a finding means its raw value/pixels could cross the boundary.
//
// Error hygiene: PrivacyError messages carry stable codes plus non-sensitive
// context (element ids, field names) only. Raw detected values never appear
// in messages, so failures can be logged safely.

import type {
  BoundingBox,
  Detection,
  DetectionSource,
  SensitiveCategory,
} from "../../types/index.js";

/** Stable error codes — tests assert on these, never on message text. */
export type PrivacyErrorCode =
  | "INVALID_DETECTION" // not an object / missing required field
  | "INVALID_GEOMETRY" // bbox malformed: non-array, non-finite, non-positive size
  | "INVALID_CATEGORY" // unknown sensitive category
  | "INVALID_SOURCE" // unknown detection source
  | "INVALID_CONFIDENCE"; // confidence outside [0, 1]

/** Privacy pipeline failure with a stable, non-sensitive error code. */
export class PrivacyError extends Error {
  readonly code: PrivacyErrorCode;
  constructor(code: PrivacyErrorCode, message: string) {
    super(`PRIVIS_${code}: ${message}`);
    this.name = "PrivacyError";
    this.code = code;
  }
}

/** Every category the placeholder/redaction machinery knows how to handle. */
export const VALID_CATEGORIES: ReadonlySet<SensitiveCategory> = new Set([
  "EMAIL",
  "PAN",
  "AADHAAR",
  "AMOUNT",
  "PHONE",
  "NAME",
  "FACE",
  "PASSWORD",
]);

/**
 * Every detection source the contract accepts. "ocr" is the reserved seam for
 * the document pipeline (later phase): no detector emits it yet, but the
 * contract is closed — any other source string is rejected.
 */
export const VALID_SOURCES: ReadonlySet<DetectionSource> = new Set([
  "dom",
  "vision",
  "ocr",
]);

/**
 * Geometry contract: [x, y, w, h], top-left origin, finite numbers, positive
 * w/h. x/y may be negative (partially off-viewport elements are legitimate —
 * the visual redactor clamps them); zero/negative size or NaN/Infinity is
 * never legitimate and fails closed.
 */
export function assertValidBBox(bbox: unknown, context = "detection"): BoundingBox {
  if (!Array.isArray(bbox) || bbox.length !== 4) {
    throw new PrivacyError(
      "INVALID_GEOMETRY",
      `${context}: bbox must be a 4-number array [x, y, w, h]`
    );
  }
  const [x, y, w, h] = bbox;
  if (
    typeof x !== "number" || !Number.isFinite(x) ||
    typeof y !== "number" || !Number.isFinite(y) ||
    typeof w !== "number" || !Number.isFinite(w) ||
    typeof h !== "number" || !Number.isFinite(h)
  ) {
    throw new PrivacyError(
      "INVALID_GEOMETRY",
      `${context}: bbox contains non-finite numbers (NaN/Infinity)`
    );
  }
  if (w <= 0 || h <= 0) {
    throw new PrivacyError(
      "INVALID_GEOMETRY",
      `${context}: bbox width/height must be positive (got w=${w}, h=${h})`
    );
  }
  return [x, y, w, h];
}

/**
 * Validates one raw finding and returns a REBUILT canonical Detection.
 * Rebuilding (not passthrough) guarantees:
 * - unknown extra fields are dropped (a smuggled `text`/`value` field from a
 *   detector or message channel cannot ride along downstream), and
 * - the output shape is exactly the contract, everywhere, always.
 * Throws PrivacyError (fail closed) on any contract violation.
 */
export function normalizeDetection(raw: unknown): Detection {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new PrivacyError("INVALID_DETECTION", "detection must be a non-null object");
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.element_id !== "string" || obj.element_id.length === 0) {
    throw new PrivacyError("INVALID_DETECTION", "detection requires a non-empty element_id string");
  }
  if (typeof obj.category !== "string" || !VALID_CATEGORIES.has(obj.category as SensitiveCategory)) {
    throw new PrivacyError(
      "INVALID_CATEGORY",
      `detection "${obj.element_id}" has unknown category`
    );
  }
  if (typeof obj.source !== "string" || !VALID_SOURCES.has(obj.source as DetectionSource)) {
    throw new PrivacyError(
      "INVALID_SOURCE",
      `detection "${obj.element_id}" has unknown source`
    );
  }
  if (
    typeof obj.confidence !== "number" ||
    !Number.isFinite(obj.confidence) ||
    obj.confidence < 0 ||
    obj.confidence > 1
  ) {
    throw new PrivacyError(
      "INVALID_CONFIDENCE",
      `detection "${obj.element_id}" confidence must be a finite number in [0, 1]`
    );
  }

  return {
    element_id: obj.element_id,
    category: obj.category as SensitiveCategory,
    bbox: assertValidBBox(obj.bbox, `detection "${obj.element_id}"`),
    confidence: obj.confidence,
    source: obj.source as DetectionSource,
  };
}

/**
 * Validates a whole findings list (e.g. a detector response or an offscreen
 * message payload). Fail closed on the first malformed entry.
 */
export function normalizeDetections(raws: readonly unknown[]): Detection[] {
  return raws.map((raw) => normalizeDetection(raw));
}
