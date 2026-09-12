// tests/test-detection-engine.ts
// Phase 02: Comprehensive Detection Engine Test Suite.
// Covers candidate extraction, validators, context qualification, caption disqualification,
// category classification, confidence scoring, structural DOM detection, provenance,
// deduplication, overlap merge policy, hard negatives, and determinism.

import assert from "node:assert";
import type { Detection, ElementMeta } from "../../../types/index.js";
import {
  detectSensitive,
  scanText,
  detectLexical,
  disqualifiedByCaption,
  isAadhaarValid,
  isPanValid,
  isGstinValid,
  isIfscValid,
  isKnownIfscBank,
  isUpiHandleValid,
  isCardValid,
  isIndianMobileValid,
  isEmailValid,
  isPincodeValid,
  isPassportValid,
  isDrivingLicenceValid,
  isPlausibleBirthDate,
  verhoeffCheckDigit,
  gstinCheckChar,
  normalizeDetection,
  normalizeDetections,
  deduplicateDetections,
  mergeOverlappingDetections,
  sortDetections,
} from "../../../privacy/engine/index.js";
import { applyPlaceholders } from "../../../privacy/sanitizer/structural-redact.js";

const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures.push(name + (detail ? ` (${detail})` : ""));
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function el(
  element_id: string,
  tag: string,
  text: string,
  extra: Partial<ElementMeta> = {}
): ElementMeta {
  return {
    element_id,
    tag,
    type: extra.type ?? null,
    role: extra.role ?? null,
    label: extra.label ?? null,
    text,
    bbox: extra.bbox ?? [0, 0, 100, 30],
  };
}

console.log("=== Phase 02 Detection Engine Test Suite ===");

// ── [1] P02-03: Candidate Extraction & Determinism ───────────────────────────
console.log("\n[1] Deterministic Candidate Extraction");
{
  const validAadhaar = `23412341234${verhoeffCheckDigit("23412341234")}`;
  const text = `Contact support at help@privis.ai or verify Aadhaar ${validAadhaar} on portal`;
  const m1 = scanText(text);
  const m2 = scanText(text);

  check("candidate extraction is deterministic (m1 === m2)", JSON.stringify(m1) === JSON.stringify(m2));
  check("identifies multiple distinct candidate classes", m1.length >= 2);
  check("preserves exact substring spans", m1.every((m) => text.slice(m.start, m.end) === m.text));
  check("input text is never mutated", text.startsWith("Contact support"));
}

// ── [2] P02-04: Deterministic PII Validators & Checksums ────────────────────
console.log("\n[2] Deterministic PII Validators & Checksums");
{
  const validAadhaar = `23412341234${verhoeffCheckDigit("23412341234")}`;
  const invalidAadhaar = "234123412340";
  check("Verhoeff checksum validates genuine Aadhaar", isAadhaarValid(validAadhaar));
  check("Verhoeff rejects corrupted Aadhaar check digit", !isAadhaarValid(invalidAadhaar));

  check("PAN individual entity code validated", isPanValid("ABCPE1234F"));
  check("PAN company entity code validated", isPanValid("ABCCE1234F"));
  check("PAN with invalid entity code rejected", !isPanValid("ABCZE1234F"));

  const gstinBase = "27ABCPE1234F1Z";
  const gstinValid = gstinBase + gstinCheckChar(gstinBase);
  check("GSTIN checksum validates", isGstinValid(gstinValid));
  check("GSTIN with bad check char rejected", !isGstinValid(gstinBase + "9"));

  check("IFSC known bank validated", isKnownIfscBank("HDFC0001234"));
  check("IFSC format validated", isIfscValid("SBIN0000001"));
  check("IFSC with non-zero 5th char rejected", !isIfscValid("SBIN1000001"));

  check("UPI recognized PSP validated", isUpiHandleValid("user@okhdfcbank"));
  check("UPI unrecognized handle rejected", !isUpiHandleValid("user@randomdomain"));

  check("Indian mobile number (+91) validated", isIndianMobileValid("+91 98765 43210"));
  check("Mobile number starting with invalid digit rejected", !isIndianMobileValid("5123456789"));
}

// ── [3] P02-05 & P02-06: Context Qualification & Negative Suppression ───────
console.log("\n[3] Context Qualification & Negative Suppression");
{
  const validAadhaar = `23412341234${verhoeffCheckDigit("23412341234")}`;

  // Negative context suppresses false positives
  const invoiceText = `Invoice no. ${validAadhaar}`;
  const invMatches = scanText(invoiceText);
  check("Invoice number label suppresses Verhoeff-valid number", invMatches.length === 0);

  const orderText = `Order Ref #${validAadhaar}`;
  const orderMatches = scanText(orderText);
  check("Order reference label suppresses candidate", orderMatches.length === 0);

  // Positive context
  const posMatches = scanText(`Aadhaar: ${validAadhaar}`);
  check("Genuine context permits Aadhaar detection", posMatches.length === 1 && posMatches[0]?.cls === "AADHAAR");

  // Currency amounts
  const priceText = `Total amount ₹ 123456789012`;
  check("Money marker suppresses numeric identifier", scanText(priceText).length === 0);

  // Account qualification requires label
  check("Bare 12 digits without label is not detected as ACCOUNT",
    scanText("123456789012").every((m) => m.cls !== "ACCOUNT"));
  check("Account number with label context is detected as ACCOUNT",
    scanText("Savings A/c No: 123456789012").some((m) => m.cls === "ACCOUNT"));

  // DOB qualification requires birth context
  check("Standard date without birth context is not DOB",
    scanText("Report date: 15/08/1990").every((m) => m.cls !== "DOB"));
  check("Date with DOB label is detected as DOB",
    scanText("Date of Birth: 15/08/1990").some((m) => m.cls === "DOB"));
}

// ── [4] P02-07 & P02-08: Classification Priority & Confidence Scoring ──────
console.log("\n[4] Classification Priority & Confidence Scoring");
{
  // GSTIN contains PAN; GSTIN pattern must claim span first
  const gstinBase = "27ABCPE1234F1Z";
  const gstin = gstinBase + gstinCheckChar(gstinBase);
  const matches = scanText(gstin);
  check("GSTIN takes priority over embedded PAN substring", matches.length === 1 && matches[0]?.cls === "GSTIN");
  check("GSTIN carries high confidence (0.99)", matches[0]?.confidence === 0.99);

  // Card detection has Luhn validation
  const cardMatches = scanText("4111 1111 1111 1111");
  check("Valid Visa card detected with 0.97 confidence", cardMatches[0]?.cls === "CARD" && cardMatches[0]?.confidence === 0.97);
}

// ── [5] P02-09: Structural DOM Detection ───────────────────────────────────
console.log("\n[5] Structural DOM Detection");
{
  const elements: ElementMeta[] = [
    el("el-1", "input", "secretpass", { type: "password" }),
    el("el-2", "input", "arjun@privis.ai", { type: "email" }),
    el("el-3", "input", "ABCPE1234F", { role: "textbox" }),
    el("el-4", "button", "Pay ₹500", { role: "button" }),
    el("el-5", "input", "9876543210", { label: "Mobile Number" }),
    el("el-6", "input", "15/08/1990", { label: "Date of Birth" }),
  ];

  const detections = detectSensitive(elements);
  check("input[type=password] detected as PASSWORD", detections.some((d) => d.element_id === "el-1" && d.category === "PASSWORD"));
  check("input[type=email] detected as EMAIL", detections.some((d) => d.element_id === "el-2" && d.category === "EMAIL"));
  check("PAN value in textbox detected as PAN", detections.some((d) => d.element_id === "el-3" && d.category === "PAN"));
  check("button with price text detected as AMOUNT", detections.some((d) => d.element_id === "el-4" && d.category === "AMOUNT"));
  check("Mobile input detected as PHONE", detections.some((d) => d.element_id === "el-5" && d.category === "PHONE"));
}

// ── [6] P02-10: Detection Provenance ─────────────────────────────────────────
console.log("\n[6] Detection Provenance");
{
  const detections = detectSensitive([el("e-1", "input", "ABCPE1234F")]);
  check("Detection preserves closed source 'dom'", detections[0]?.source === "dom");
  check("Detection has valid bbox", detections[0]?.bbox.length === 4);
  check("Detection does not include raw secret value in keys", !("text" in (detections[0] ?? {})));
}

// ── [7] P02-11 & P02-12: Deduplication & Overlap Merging ─────────────────────
console.log("\n[7] Deterministic Deduplication & Overlap Merging");
{
  const d1: Detection = { element_id: "el-1", category: "EMAIL", bbox: [10, 20, 100, 30], confidence: 0.8, source: "dom" };
  const d2: Detection = { element_id: "el-1", category: "EMAIL", bbox: [10, 20, 100, 30], confidence: 0.95, source: "dom" };
  const d3: Detection = { element_id: "el-2", category: "PAN", bbox: [10, 60, 120, 30], confidence: 0.9, source: "dom" };

  const deduped = deduplicateDetections([d1, d2, d3]);
  check("Duplicate detection collapses to higher confidence", deduped.length === 2 && deduped[0]?.confidence === 0.95);

  // Deduplication order independence
  const reversed = deduplicateDetections([d3, d2, d1]);
  check("Deduplication result is order-independent", JSON.stringify(deduped) === JSON.stringify(reversed));

  // Overlapping detections with same category merge
  const box1: Detection = { element_id: "e-a", category: "EMAIL", bbox: [10, 10, 50, 20], confidence: 0.9, source: "dom" };
  const box2: Detection = { element_id: "e-b", category: "EMAIL", bbox: [30, 10, 50, 20], confidence: 0.95, source: "dom" };
  const merged = mergeOverlappingDetections([box1, box2], 0.2);
  check("Overlapping same-category boxes merge into union bbox", merged.length === 1 && merged[0]?.bbox[2] === 70);

  // Distinct categories NEVER merge
  const boxPan: Detection = { element_id: "e-c", category: "PAN", bbox: [10, 10, 50, 20], confidence: 0.9, source: "dom" };
  const mergedDistinct = mergeOverlappingDetections([box1, boxPan], 0.2);
  check("Overlapping distinct categories do NOT merge", mergedDistinct.length === 2);
}

// ── [8] P02-13: Hard-Negative Test Corpus ────────────────────────────────────
console.log("\n[8] Hard-Negative Test Corpus");
{
  const hardNegatives = [
    { text: "Invoice # 987654321012", desc: "12-digit invoice number" },
    { text: "Tracking ID: 1234 5678 9012", desc: "Waybill tracking" },
    { text: "SKU-9876543210", desc: "Product SKU" },
    { text: "UUID: 123e4567-e89b-12d3-a456-426614174000", desc: "UUID" },
    { text: "Total Balance: $1,250.00", desc: "Dollar amount" },
    { text: "Payment of ₹50,000 received on 12/04/2024", desc: "Transaction date with amount" },
    { text: "Case Docket: 234123412348", desc: "Legal docket number" },
    { text: "4111 1111 1111 1112", desc: "Luhn-invalid card number" },
  ];

  for (const item of hardNegatives) {
    const hits = scanText(item.text);
    check(`Hard negative rejected: ${item.desc}`, hits.length === 0, `Got: ${JSON.stringify(hits)}`);
  }
}

// ── [9] P02-14: Detection Quality Regression & Normalization ─────────────────
console.log("\n[9] Detection Quality Regression & Normalization");
{
  const valid = normalizeDetections([
    { element_id: "el-1", category: "PAN", bbox: [10, 10, 100, 30], confidence: 0.95, source: "dom" },
  ]);
  check("Normalized valid detection retains canonical shape", valid.length === 1 && valid[0]?.category === "PAN");

  // Sanitizer integration
  const elements = [el("el-1", "input", "ABCPE1234F")];
  const { sanitized, map } = applyPlaceholders(elements, valid);
  check("Sanitizer correctly swaps detected value to placeholder PAN_1", sanitized[0]?.text === "PAN_1");
  check("Real value isolated in local map only", map["el-1"] === "ABCPE1234F");
}

console.log("\n============================================================");
if (failures.length === 0) {
  console.log("✅ ALL PHASE 02 DETECTION ENGINE TESTS PASSED (100%)");
  console.log("============================================================\n");
} else {
  console.error(`❌ ${failures.length} check(s) failed:`, failures);
  process.exit(1);
}
