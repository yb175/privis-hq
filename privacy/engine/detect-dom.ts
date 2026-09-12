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
import { scanText } from "./detect-lexical.js";

export const CATEGORIES: SensitiveCategory[] = [
  "EMAIL",
  "PAN",
  "AADHAAR",
  "AMOUNT",
  "PHONE",
  "NAME",
  "FACE",
  "PASSWORD",
  "CARD",
  "IFSC",
  "GSTIN",
  "UPI",
  "ACCOUNT",
  "DOB",
  "PASSPORT",
  "LICENCE",
];

// Confidence: 0.95 for input[type] hits, 0.7 for label-only hits. Lexical
// (checksum-validated) hits carry their own per-class confidence from
// detect-lexical.ts (0.85-0.99).
const CONFIDENCE_HIT = 0.95;
const CONFIDENCE_LABEL = 0.7;

// Value-text currency marker (the lexical layer covers identifiers, not money).
const AMOUNT_TEXT_RE = /[₹$€£]|\b(?:inr|rs\.?)\b/i;

// Label-only fallbacks are restricted to the documented password / amount / name
// rules; identifier classes are only detected from checksum/type evidence,
// never from a bare label.
const PASSWORD_LABEL_RE = /otp|password/i;
const AMOUNT_LABEL_RE = /salary|amount|ctc|reimbursement|inr|₹|rs\.?/i;
const NAME_LABEL_RE = /name/i;

/**
 * Detects a single sensitive entity in one element, or null when nothing matches.
 * Stronger (input-type / checksum) signals win over label-only hits.
 */
function detectElement(
  el: ElementMeta
): { category: SensitiveCategory; confidence: number } | null {
  const tag = (el.tag ?? "").toLowerCase();
  const role = (el.role ?? "").toLowerCase();
  const label = (el.label ?? "").trim();
  const type = (el.type ?? "").toLowerCase();
  const text = el.text.trim();

  // Buttons are CTAs, not data fields: skip so a label like "Pay ₹100" isn't
  // treated as AMOUNT and its whole label replaced with a placeholder.
  if (tag === "button" || role === "button") return null;

  // Pass 1a: input-type evidence — the page itself declares the class.
  if (type === "password") return { category: "PASSWORD", confidence: CONFIDENCE_HIT };
  if (type === "email") return { category: "EMAIL", confidence: CONFIDENCE_HIT };

  // Pass 1b: value-shape evidence via the checksum-validated lexical layer
  // (SIH26171 L1 port). A bare regex used to live here; every identifier now
  // goes through validators.ts — a twelve-digit invoice number is not an
  // Aadhaar. Highest-confidence lexical match in the value wins.
  if (text) {
    const matches = scanText(text);
    if (matches.length > 0) {
      const best = matches.reduce((a, b) => (b.confidence > a.confidence ? b : a));
      return { category: best.cls, confidence: best.confidence };
    }
  }

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
