// privacy/engine/detect-dom.ts
// Local Privacy Vision Engine — DOM detection path.
//
// Responsibilities:
// - Identifies sensitive categories (PAN, Aadhaar, Email, Phone, Amount,
//   Password, Name) from extracted DOM element metadata.
// - Emits Detection records with bounding boxes, confidence scores, and
//   source: "dom".
//
// This is detection only. Placeholder substitution and the real-value mapping
// live in the Sanitizer (privacy/sanitizer/structural-redact.ts); pixel
// redaction lives in privacy/sanitizer/visual-redact.ts. The engine's output
// feeds fusion (fuse.ts) and then the Sanitizer — never the remote agent.
//
// Privacy: pure local computation, no I/O, no network, no persistence.

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

// Confidence: 0.95 for regex / input[type] hits, 0.7 for label-only hits.
const CONFIDENCE_HIT = 0.95;
const CONFIDENCE_LABEL = 0.7;

const PAN_RE = /[A-Z]{5}[0-9]{4}[A-Z]/;
const EMAIL_RE = /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/;
// Indian mobile: optional +91 country code, starts 6-9, 10 digits total.
const PHONE_RE = /^(\+91)?[6-9][0-9]{9}$/;
// Currency symbol / currency unit in value text.
const AMOUNT_TEXT_RE = /[₹$€£]|\b(?:inr|rs\.?)\b/i;

// Label-only fallbacks are restricted to the documented password / amount / name
// rules; PAN, phone, Aadhaar, and email are only detected from strong regex/type
// evidence, never from a bare label.
const PASSWORD_LABEL_RE = /otp|password/i;
const AMOUNT_LABEL_RE = /salary|amount|ctc|reimbursement|inr|₹|rs\.?/i;
const NAME_LABEL_RE = /name/i;

// "2341 5678 9012" -> "234156789012", so grouped Aadhaar still matches.
function compactDigits(s: string): string {
  return s.replace(/[\s-]/g, "");
}

/**
 * Detects a single sensitive entity in one element, or null when nothing matches.
 * Stronger (regex/type) signals win over label-only hits.
 */
function detectElement(
  el: ElementMeta
): { category: SensitiveCategory; confidence: number } | null {
  const tag = (el.tag ?? "").toLowerCase();
  const role = (el.role ?? "").toLowerCase();
  const label = (el.label ?? "").trim();
  const type = (el.type ?? "").toLowerCase();
  const text = el.text.trim();
  const compact = compactDigits(text);

  // Buttons are CTAs, not data fields: skip so a label like "Pay ₹100" isn't
  // treated as AMOUNT and its whole label replaced with a placeholder.
  if (tag === "button" || role === "button") return null;

  // Pass 1: strong regex / input-type hits only. These always win, regardless
  // of any label, so "Phone" with an email value is EMAIL, not PHONE.
  // PHONE before AADHAAR so "+91 98765 43210" isn't read as 12 digits.
  if (type === "password") return { category: "PASSWORD", confidence: CONFIDENCE_HIT };
  if (PAN_RE.test(text.toUpperCase())) return { category: "PAN", confidence: CONFIDENCE_HIT };
  if (PHONE_RE.test(compact)) return { category: "PHONE", confidence: CONFIDENCE_HIT };
  if (/^[0-9]{12}$/.test(compact)) return { category: "AADHAAR", confidence: CONFIDENCE_HIT };
  if (type === "email" || EMAIL_RE.test(text)) return { category: "EMAIL", confidence: CONFIDENCE_HIT };
  if (AMOUNT_TEXT_RE.test(text)) return { category: "AMOUNT", confidence: CONFIDENCE_HIT };

  // Pass 2: label-only fallbacks (0.7) — documented password / amount / name.
  if (PASSWORD_LABEL_RE.test(label)) return { category: "PASSWORD", confidence: CONFIDENCE_LABEL };
  if (AMOUNT_LABEL_RE.test(label)) return { category: "AMOUNT", confidence: CONFIDENCE_LABEL };
  if (NAME_LABEL_RE.test(label)) return { category: "NAME", confidence: CONFIDENCE_LABEL };

  return null;
}

/**
 * Detects sensitive entities in extracted DOM element metadata.
 * @param elements Extracted DOM element metadata
 */
export function detectSensitive(elements: ElementMeta[]): Detection[] {
  const detections: Detection[] = [];
  for (const el of elements) {
    const hit = detectElement(el);
    if (hit) {
      detections.push({
        element_id: el.element_id,
        category: hit.category,
        bbox: el.bbox,
        confidence: hit.confidence,
        source: "dom",
      });
    }
  }
  return detections;
}
