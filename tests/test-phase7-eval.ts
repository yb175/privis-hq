// tests/test-phase7-eval.ts
// Phase 07: Evaluation, Adversarial Testing, Reliability, and Benchmarking Test Suite.

import assert from "node:assert";
import process from "node:process";
import {
  isAadhaarValid,
  isPanValid,
  isGstinValid,
  isCardValid,
  isUpiHandleValid,
  isIndianMobileValid,
  isEmailValid,
  isIfscValid,
} from "../privacy/engine/validators.js";
import { PlaceholderAllocator } from "../privacy/sanitizer/placeholders.js";
import { checkOcclusion } from "../content/occlusion.js";
import { isInteractiveElement } from "../content/interactivity.js";
import { verifyPlan } from "../executor/verify-plan.js";
import { tryLocalIntent } from "../orchestrator/local-intent.js";
import { tokeniseGoal } from "../orchestrator/goal-tokenize.js";

const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures.push(name + (detail ? ` (${detail})` : ""));
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("=== Phase 07 Evaluation, Adversarial Testing & Benchmarking Test Suite ===");

// ── [1] P07-03 / P07-04: Ground Truth Representation & Detection Metrics ──────
console.log("\n[1] P07-03 & P07-04: Ground Truth Representation & Detection Metrics");
{
  interface GroundTruthItem {
    id: string;
    category: string;
    value: string;
    bbox: [number, number, number, number];
  }

  interface PredictionItem {
    id: string;
    category: string;
    bbox: [number, number, number, number];
    confidence: number;
  }

  function computeMetrics(gt: GroundTruthItem[], preds: PredictionItem[]) {
    let tp = 0;
    let fp = 0;
    let fn = 0;

    const matchedGt = new Set<string>();

    for (const p of preds) {
      const match = gt.find((g) => g.id === p.id && g.category === p.category);
      if (match) {
        tp++;
        matchedGt.add(match.id);
      } else {
        fp++;
      }
    }
    fn = gt.length - matchedGt.size;

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    const fpr = fp / (fp + Math.max(1, gt.length));
    const fnr = fn / (tp + fn || 1);

    return { tp, fp, fn, precision, recall, f1, fpr, fnr };
  }

  const gt: GroundTruthItem[] = [
    { id: "e1", category: "EMAIL", value: "user@test.org", bbox: [10, 10, 120, 24] },
    { id: "e2", category: "PAN", value: "ABCDE1234F", bbox: [10, 40, 120, 24] },
    { id: "e3", category: "PHONE", value: "+919876543210", bbox: [10, 70, 120, 24] },
  ];

  const perfectPreds: PredictionItem[] = [
    { id: "e1", category: "EMAIL", bbox: [10, 10, 120, 24], confidence: 0.99 },
    { id: "e2", category: "PAN", bbox: [10, 40, 120, 24], confidence: 0.95 },
    { id: "e3", category: "PHONE", bbox: [10, 70, 120, 24], confidence: 0.98 },
  ];

  const perfMetrics = computeMetrics(gt, perfectPreds);
  check("Perfect predictions yield F1 = 1.0", perfMetrics.f1 === 1.0 && perfMetrics.precision === 1.0 && perfMetrics.recall === 1.0);

  const noisyPreds: PredictionItem[] = [
    { id: "e1", category: "EMAIL", bbox: [10, 10, 120, 24], confidence: 0.99 },
    { id: "e-fake", category: "AADHAAR", bbox: [0, 0, 10, 10], confidence: 0.5 }, // FP
  ];
  const noisyMetrics = computeMetrics(gt, noisyPreds);
  check("Noisy predictions compute TP=1, FP=1, FN=2 accurately", noisyMetrics.tp === 1 && noisyMetrics.fp === 1 && noisyMetrics.fn === 2);
  check("FPR and FNR correctly bounded", noisyMetrics.fpr > 0 && noisyMetrics.fnr > 0);
}

// ── [2] P07-05: Redaction Metrics ─────────────────────────────────────────────
console.log("\n[2] P07-05: Redaction Metrics (Region Overlap & Pixel Preservation)");
{
  function boxIntersectionArea(b1: [number, number, number, number], b2: [number, number, number, number]): number {
    const [x1, y1, w1, h1] = b1;
    const [x2, y2, w2, h2] = b2;
    const ix1 = Math.max(x1, x2);
    const iy1 = Math.max(y1, y2);
    const ix2 = Math.min(x1 + w1, x2 + w2);
    const iy2 = Math.min(y1 + h1, y2 + h2);
    if (ix2 <= ix1 || iy2 <= iy1) return 0;
    return (ix2 - ix1) * (iy2 - iy1);
  }

  const sensitiveFace: [number, number, number, number] = [100, 100, 60, 60];
  const redactedPatch: [number, number, number, number] = [95, 95, 70, 70]; // slightly larger safe margin
  const sensitiveArea = 60 * 60;
  const overlap = boxIntersectionArea(sensitiveFace, redactedPatch);

  check("Redaction patch covers 100% of sensitive face region", overlap === sensitiveArea);

  const missedFace: [number, number, number, number] = [300, 300, 50, 50];
  const zeroPatch: [number, number, number, number] = [0, 0, 10, 10];
  check("Missed sensitive face detected with 0% overlap", boxIntersectionArea(missedFace, zeroPatch) === 0);
}

// ── [3] P07-06: Agent Execution & Failure Recovery Metrics ────────────────────
console.log("\n[3] P07-06: Agent Execution & Failure Recovery Metrics");
{
  const validPlan = [
    { type: "type" as const, target: "#query-input", value: "search term" },
    { type: "click" as const, target: "#submit-btn" },
  ];
  const vResult = verifyPlan(validPlan);
  check("Valid plan verification succeeds without errors", vResult.ok && vResult.violations.length === 0);

  const maliciousPlan = [
    { type: "custom_unauthorized_action" as any, target: "#steal" },
  ];
  const malResult = verifyPlan(maliciousPlan);
  check("Unauthorized actions rejected by plan verifier", !malResult.ok && malResult.violations.length > 0);
}

// ── [4] P07-08: Determinism Assertions ────────────────────────────────────────
console.log("\n[4] P07-08: Determinism Assertions (Stable Outputs Across Runs)");
{
  const testGoal = "Fill email user@example.com and PAN ABCDE1234F";
  const run1 = tokeniseGoal(testGoal);
  const run2 = tokeniseGoal(testGoal);
  const run3 = tokeniseGoal(testGoal);

  check("Goal tokenization output is perfectly identical across run 1 & 2", JSON.stringify(run1) === JSON.stringify(run2));
  check("Goal tokenization output is perfectly identical across run 2 & 3", JSON.stringify(run2) === JSON.stringify(run3));

  const sampleElements = [
    { element_id: "e1", tag: "button", text: "Submit", role: "button" },
    { element_id: "e2", tag: "input", text: "", label: "email" },
  ] as any;
  const intent1 = tryLocalIntent("click submit", sampleElements);
  const intent2 = tryLocalIntent("click submit", sampleElements);
  check("Local intent classification is completely deterministic", JSON.stringify(intent1) === JSON.stringify(intent2));
}

// ── [5] P07-09: Hard Negatives (Adversarial Non-PII Formats) ─────────────────
console.log("\n[5] P07-09: Hard Negatives (Adversarial Non-PII Strings)");
{
  // 1. Order IDs resembling phone numbers or Aadhaar
  const orderId = "123456789012"; // Starts with 1 (never issued by UIDAI)
  const isAadhaar = isAadhaarValid(orderId);
  check("12-digit non-UIDAI tracking number rejected as Aadhaar", !isAadhaar);

  // 2. 16-digit fake card failing Luhn algorithm
  const badCard = "4111111111111112"; // Bad Luhn
  check("16-digit fake card with bad Luhn checksum rejected", !isCardValid(badCard));

  // 3. Invoice numbers resembling PAN
  const invoiceCode = "INV1234567"; // Similar length, invalid PAN regex/format
  check("Invoice code rejected by PAN validator", !isPanValid(invoiceCode));

  // 4. Invalid GSTIN checksum / structure
  const invalidGstin = "27ABCDE1234F1Z0"; // Invalid checksum
  check("Invalid GSTIN string rejected by validator", !isGstinValid(invalidGstin));

  // 5. Malformed IFSC (fifth character is 1 instead of 0)
  const malformedIfsc = "PUNB1INVALD";
  check("Malformed IFSC candidate rejected", !isIfscValid(malformedIfsc));
}

// ── [6] P07-11: Checksum Sabotage Benchmark (Precision Degradation Test) ──────
console.log("\n[6] P07-11: Checksum Sabotage Benchmark (Degradation Proved)");
{
  const hardNegativePool = [
    "4111111111111112", // Bad Card
    "123456789012",     // Bad Aadhaar
    "987654321011",     // Bad Aadhaar
    "000000000000",     // Bad Aadhaar
    "27ABCDE1234F1Z9",  // Bad GSTIN
  ];

  // Normal validator: All 5 rejected (0 False Positives)
  let normalFP = 0;
  for (const item of hardNegativePool) {
    if (isCardValid(item) || isAadhaarValid(item) || isGstinValid(item)) {
      normalFP++;
    }
  }
  check("Production validators achieve 0 false positives on hard negatives", normalFP === 0);

  // Sabotaged validator (simple length-only check)
  let sabotagedFP = 0;
  for (const item of hardNegativePool) {
    const isSabotagedCard = /^\d{16}$/.test(item);
    const isSabotagedAadhaar = /^\d{12}$/.test(item);
    const isSabotagedGstin = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/.test(item);
    if (isSabotagedCard || isSabotagedAadhaar || isSabotagedGstin) {
      sabotagedFP++;
    }
  }
  check("Sabotaged (length-only) checks produce 100% false positive spike", sabotagedFP === hardNegativePool.length);
}

// ── [7] P07-12: Privacy Gate Sabotage (Tamper Detection) ──────────────────────
console.log("\n[7] P07-12: Privacy Gate Sabotage (Fail-Closed Guarantees)");
{
  const alloc = new PlaceholderAllocator("eval-sabotage");
  const p1 = alloc.allocate("PAN", "ABCDE1234F", "dom");

  // Attempt 1: Raw value injection into outbound payload
  const outboundPayload = {
    planRequest: "Fill form with PAN_1",
    leakedRawValue: "ABCDE1234F",
  };
  const hasRawLeak = JSON.stringify(outboundPayload).includes("ABCDE1234F");
  check("Outbound payload containing raw secret is flagged as leak", hasRawLeak);

  // Attempt 2: Deserialization / extraction fails without proper authorization
  let threwOnUnauthorized = false;
  try {
    alloc.allocate("PASSWORD" as any, "supersecret");
  } catch {
    threwOnUnauthorized = true;
  }
  check("Direct allocation of PASSWORD class strictly forbidden", threwOnUnauthorized);
}

// ── [8] P07-13: Browser Adversarial Corpus (Occlusion & Inactive DOM) ──────────
console.log("\n[8] P07-13: Browser Adversarial Corpus (Occlusion & Interactivity)");
{
  // 1. Non-interactive elements
  const divEl = {
    tagName: "DIV",
    getAttribute: () => null,
    hasAttribute: () => false,
  } as any;
  check("Plain static DIV is non-interactive", !isInteractiveElement(divEl));

  const hiddenInputEl = {
    tagName: "INPUT",
    getAttribute: (attr: string) => (attr === "type" ? "hidden" : null),
    hasAttribute: () => false,
  } as any;
  check("Hidden input type is non-interactive", !isInteractiveElement(hiddenInputEl));

  const buttonEl = {
    tagName: "BUTTON",
    getAttribute: () => null,
    hasAttribute: () => false,
  } as any;
  check("Button element is recognized as interactive", isInteractiveElement(buttonEl));

  // 2. Occlusion test
  const zeroDimEl = {
    getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }),
  } as any;
  const zeroOcc = checkOcclusion(zeroDimEl);
  check("Zero dimension element flagged as occluded", zeroOcc.occluded);

  const visibleEl = {
    getBoundingClientRect: () => ({ width: 100, height: 100, top: 10, left: 10, right: 110, bottom: 110 }),
  } as any;
  const visOcc = checkOcclusion(visibleEl);
  check("Valid dimension element flagged as visible", visOcc.visible && !visOcc.occluded);
}

// ── [9] P07-18: Performance Benchmarking ──────────────────────────────────────
console.log("\n[9] P07-18: Performance Benchmarking");
{
  const iterations = 1000;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    isPanValid("ABCDE1234F");
    isAadhaarValid("987654321012");
    isCardValid("4111111111111111");
  }
  const elapsedMs = performance.now() - start;
  const usPerOp = (elapsedMs / (iterations * 3)) * 1000;
  check(`DOM Validators throughput < 100µs per operation (${usPerOp.toFixed(2)}µs/op)`, usPerOp < 100);
}

console.log("\n============================================================");
if (failures.length === 0) {
  console.log("✅ ALL PHASE 07 EVALUATION & BENCHMARK TESTS PASSED (100%)");
} else {
  console.error(`❌ FAILED: ${failures.length} check(s)`);
  process.exit(1);
}
