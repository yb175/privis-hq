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

// Session-stable tokens: the same real value always maps to the same placeholder
// (user@x.com is EMAIL_1 every step), and counters start per category.
const tokenByValue = new Map<string, string>();
const nextIndex: Record<string, number> = {};

function tokenFor(category: SensitiveCategory, value: string): string {
  const key = `${category}\u0000${value}`;
  let token = tokenByValue.get(key);
  if (!token) {
    const n = (nextIndex[category] = (nextIndex[category] ?? 0) + 1);
    token = `${category}_${n}`;
    tokenByValue.set(key, token);
  }
  return token;
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
  const byId = new Map<string, Detection>();
  for (const d of detections) byId.set(d.element_id, d);

  const sanitized: ElementMeta[] = [];
  const map: Record<string, string> = {};

  for (const el of elements) {
    const d = byId.get(el.element_id);
    const text = el.text.trim();
    let out = el;
    if (d && text) {
      if (d.category === "PASSWORD") {
        // Password value is never extracted; redacted by input type, no placeholder.
        out = { ...el, text: "" };
      } else if (d.category === "FACE") {
        // Face is redacted as pixels only; never placeholder-swapped or text-blanked.
        out = el;
      } else {
        map[el.element_id] = el.text; // real value stays local, never sent to remote
        out = { ...el, text: tokenFor(d.category, el.text) };
      }
    }
    sanitized.push(out);
  }
  return { sanitized, map };
}
