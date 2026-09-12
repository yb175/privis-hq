// privacy/engine/detect-lexical.ts
// L1 lexical detection over DOM text — Aadhaar, PAN, GSTIN, IFSC, UPI, card,
// account, passport, licence, email, phone, DOB.
//
// PROVENANCE: scanText()/disqualifiedByCaption()/PATTERNS ported from the
// approved reference repo PravAl2028/SIH26171, extension/src/redaction/
// l1-lexical.ts (author-granted permission, Phase 01). Adapted to PRIVIS types
// (SensitiveCategory instead of PlaceholderClass; ElementMeta instead of
// ObservedElement — PRIVIS elements carry one text value per element, so the
// textRuns machinery was not needed). Match/context logic is unchanged.
//
// Every numeric pattern goes through validators.ts before it becomes a
// Detection. A twelve-digit invoice number is not an Aadhaar, and shipping a
// regex without the checksum is how the precision metric gets thrown away.
//
// But the checksum is only half of it. About one random twelve-digit string in
// ten passes Verhoeff, so on a page of order numbers the arithmetic alone still
// lets one in ten through. Two context rules close that gap:
//
//   Negative context   a match preceded by "invoice", "order", "receipt", "txn"
//                      and the like is rejected however well it validates. The
//                      label is better evidence than the checksum.
//   Required context   classes with no checksum at all — a bank account number
//                      is just digits, a birth date is just a date — are only
//                      reported when a keyword nearby says what they are.
//
// Node-pure, string in / matches out.

import type { Detection, ElementMeta, SensitiveCategory } from "../../types/index.js";
import {
  isAadhaarValid,
  isCardValid,
  isDrivingLicenceValid,
  isEmailValid,
  isGstinValid,
  isIfscValid,
  isIndianMobileValid,
  isKnownIfscBank,
  isPanValid,
  isPassportValid,
  isPlausibleBirthDate,
  isUpiHandleValid,
} from "./validators.js";

export interface LexicalMatch {
  cls: SensitiveCategory;
  start: number;
  end: number;
  text: string;
  reason: string;
  confidence: number;
}

/** How far either side of a match to read for context words. */
const CONTEXT_WINDOW = 40;

/**
 * A label that says the number is something else. These beat any checksum: a business
 * that prints "Invoice no." above a twelve-digit number is telling you what it is.
 */
const NEGATIVE_CONTEXT =
  /\b(invoice|inv|order|ord|receipt|challan|txn|transaction|reference|ref|ticket|po|purchase\s*order|batch|sku|serial|isbn|case|docket|voucher|bill|awb|tracking|consignment|uuid|guid)\b(?:\s*(?:no|number|num|nos|id|#)\.?)?[\s.:#-]*$/i;

/** Currency, decimals and thousands separators: an amount, not an identifier. */
const MONEY_BEFORE = /(₹|rs\.?|inr|usd|\$|total|amount|balance|paid|due)\s*[-]?\s*$/i;
const MONEY_AFTER = /^\s*(\.\d{1,2}\b|%|\s*(lakh|crore|cr|k|inr|rs\.?)\b)/i;

const ACCOUNT_CONTEXT =
  /\b(a\/c|ac|acct|account|bank\s*account|savings|current|beneficiary)\s*(no\.?|number|#)?[\s.:#-]*$/i;

const DOB_CONTEXT =
  /\b(dob|d\.o\.b|date\s*of\s*birth|birth\s*date|born|janm|janam)\b[\s.:#-]*$/i;

/** A date caption that says the date is not personal data. */
const NON_BIRTH_DATE_CONTEXT =
  /\b(filed|issued|issue|expir(y|es|ation)|valid\s*(?:until|from|through|till)|last\s*(?:updated|modified|edited|paid)|payment|received|notified|date\s*of\s*(?:issue|filing|registration|appointment|joining|recruitment|purchase|payment|transaction|invoice|receipt|report|submission|verification))\b(?:\s*(?:on|date|dt\.?))?[\s.:#-]*$/i;

const IFSC_CONTEXT = /\b(ifsc|ifs\s*code|branch\s*code|neft|rtgs)\b[\s.:#-]*$/i;

/**
 * Ordered because the first match at a position wins: GSTIN contains a PAN, and a card
 * number contains runs that look like other things.
 */
interface Pattern {
  cls: SensitiveCategory;
  re: RegExp;
  /**
   * Whether a preceding "Invoice no." style label disqualifies this match.
   *
   * True only for classes that are otherwise just digits. An email address after
   * "Ref:" is still an email address, and an early version of this rule suppressed it
   * -- the label tells you what a *number* is, not what an email is.
   */
  labelCanDisqualify: boolean;
  /** Rejects, or upgrades/downgrades the confidence. Returning null drops the match. */
  check(
    text: string,
    before: string,
    after: string,
  ): { reason: string; confidence: number } | null;
}

const PATTERNS: readonly Pattern[] = [
  {
    cls: "GSTIN",
    labelCanDisqualify: true,
    re: /\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/g,
    check: (text) =>
      isGstinValid(text) ? { reason: "gstin-checksum", confidence: 0.99 } : null,
  },
  {
    cls: "AADHAAR",
    labelCanDisqualify: true,
    re: /(?<![a-zA-Z0-9_.-])\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b(?![a-zA-Z0-9_.-])/g,
    check: (text, before) => {
      if (!isAadhaarValid(text)) return null;
      if (/[a-zA-Z0-9]-$/.test(before)) return null;
      return { reason: "verhoeff-ok", confidence: 0.98 };
    },
  },
  {
    cls: "CARD",
    labelCanDisqualify: true,
    re: /\b(?:\d[ -]?){12,18}\d\b/g,
    check: (text) =>
      isCardValid(text) ? { reason: "luhn-and-issuer", confidence: 0.97 } : null,
  },
  {
    cls: "PAN",
    labelCanDisqualify: true,
    re: /\b[A-Z]{5}\d{4}[A-Z]\b/g,
    check: (text) => (isPanValid(text) ? { reason: "pan-structure", confidence: 0.94 } : null),
  },
  {
    cls: "IFSC",
    labelCanDisqualify: false,
    re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g,
    check: (text, before) => {
      if (!isIfscValid(text)) return null;
      if (isKnownIfscBank(text)) return { reason: "ifsc-known-bank", confidence: 0.97 };
      // Four letters, a zero and six alphanumerics is a shape a great many product
      // codes share, so an unknown bank needs the label to vouch for it.
      if (IFSC_CONTEXT.test(before)) return { reason: "ifsc-labelled", confidence: 0.85 };
      return null;
    },
  },
  {
    cls: "UPI",
    labelCanDisqualify: false,
    re: /(?<![a-zA-Z0-9._%+-])\b[a-zA-Z0-9._-]{2,64}@[a-zA-Z]{2,32}\b(?!\.)/g,
    check: (text) => (isUpiHandleValid(text) ? { reason: "upi-psp", confidence: 0.96 } : null),
  },
  {
    cls: "EMAIL",
    labelCanDisqualify: false,
    re: /\b[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9-]{1,63}(?:\.[a-zA-Z0-9-]{1,63})+\b/g,
    check: (text) => (isEmailValid(text) ? { reason: "email-shape", confidence: 0.95 } : null),
  },
  {
    cls: "PHONE",
    labelCanDisqualify: true,
    re: /(?<![\d@.])(?:\+91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?![\d.])/g,
    check: (text) =>
      isIndianMobileValid(text) ? { reason: "in-mobile-series", confidence: 0.9 } : null,
  },
  {
    cls: "PASSPORT",
    labelCanDisqualify: true,
    re: /\b[A-PR-WY][1-9]\d\s?\d{4}\d\b/g,
    check: (text) =>
      isPassportValid(text) ? { reason: "passport-shape", confidence: 0.88 } : null,
  },
  {
    cls: "LICENCE",
    labelCanDisqualify: true,
    re: /\b[A-Z]{2}[\s-]?\d{2}[\s-]?(?:19|20)\d{2}\d{7}\b/g,
    check: (text) =>
      isDrivingLicenceValid(text) ? { reason: "licence-shape", confidence: 0.9 } : null,
  },
  {
    cls: "ACCOUNT",
    labelCanDisqualify: true,
    re: /\b\d{9,18}\b/g,
    check: (text, before) => {
      // No checksum exists for a bank account number, so the label has to carry it.
      if (!ACCOUNT_CONTEXT.test(before)) return null;
      return { reason: "account-with-label", confidence: 0.85 };
    },
  },
  {
    cls: "DOB",
    labelCanDisqualify: false,
    re: /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}-\d{2}-\d{2})\b/g,
    check: (text, before) => {
      // Every expiry date, issue date and timestamp on the page matches this shape.
      // Only the words around it say which one is a birthday.
      if (!DOB_CONTEXT.test(before)) return null;
      if (!isPlausibleBirthDate(text)) return null;
      return { reason: "dob-with-label", confidence: 0.92 };
    },
  },
];

/**
 * Is this value captioned as something that is not personal data?
 *
 * "Waybill 736561952930" is Verhoeff-valid and is not an Aadhaar number. "Filed on
 * 04/07/2023" is a real date and is not a birthday. The caption is the evidence, and it
 * is the single highest-precision signal on a page full of identifier-shaped strings.
 */
export function disqualifiedByCaption(before: string, after: string, cls?: string): boolean {
  if (NEGATIVE_CONTEXT.test(before)) return true;
  if (/\b(?:uuid|guid)\b/i.test(before) || /[a-z0-9]+-[a-z0-9]+-$/i.test(before)) return true;
  if (cls === "DOB" && NON_BIRTH_DATE_CONTEXT.test(before)) return true;
  return MONEY_BEFORE.test(before) || MONEY_AFTER.test(after);
}

/** How much text either side of a match counts as its caption. */
export const CAPTION_WINDOW = CONTEXT_WINDOW;

/** Matches within one string, checksum-validated and context-checked. */
export function scanText(text: string): LexicalMatch[] {
  const matches: LexicalMatch[] = [];
  const taken: Array<[number, number]> = [];

  for (const pattern of PATTERNS) {
    pattern.re.lastIndex = 0;
    let m: RegExpExecArray | null;

    while ((m = pattern.re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      // A GSTIN contains a PAN; whichever pattern claimed the span first keeps it.
      if (taken.some(([s, e]) => start < e && end > s)) continue;

      const before = text.slice(Math.max(0, start - CONTEXT_WINDOW), start);
      const after = text.slice(end, end + CONTEXT_WINDOW);

      if (pattern.labelCanDisqualify && disqualifiedByCaption(before, after, pattern.cls)) {
        continue;
      }

      const verdict = pattern.check(m[0], before, after);
      if (!verdict) continue;

      taken.push([start, end]);
      matches.push({
        cls: pattern.cls,
        start,
        end,
        text: m[0],
        reason: verdict.reason,
        confidence: verdict.confidence,
      });
    }
  }

  return matches.sort((a, b) => a.start - b.start);
}

/**
 * Lexical detection over extracted elements.
 *
 * Only `text` (the field's own value) is scanned. Labels and placeholders are
 * deliberately excluded — "Aadhaar number" is a label, not an Aadhaar number, and
 * scanning it produces nothing but noise.
 *
 * One Detection per element: the strongest lexical match in its value. The DOM
 * rule layer (detect-dom.ts) keeps its own type/label evidence and calls this
 * for value-shape evidence.
 */
export function detectLexical(elements: ElementMeta[]): Detection[] {
  const detections: Detection[] = [];
  for (const el of elements) {
    const text = el.text?.trim();
    if (!text) continue;
    const matches = scanText(text);
    if (matches.length === 0) continue;
    // Highest confidence wins; ties break to the earliest (scanText is sorted).
    const best = matches.reduce((a, b) => (b.confidence > a.confidence ? b : a));
    detections.push({
      element_id: el.element_id,
      category: best.cls,
      bbox: el.bbox,
      confidence: best.confidence,
      source: "dom",
    });
  }
  return detections;
}
