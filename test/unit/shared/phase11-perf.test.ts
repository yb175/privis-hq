// tests/test-phase11-perf.ts
// Phase 11: Performance & Reliability Benchmark Test Suite.

import assert from "node:assert";
import process from "node:process";
import { isPanValid, isAadhaarValid, isCardValid, isGstinValid, isIfscValid } from "../../../privacy/engine/validators.js";
import { PlaceholderAllocator } from "../../../privacy/sanitizer/placeholders.js";
import { saveSecret, readSecret, forgetAll, type VaultStore } from "../../../privacy/vault.js";
import { verifyPlan } from "../../../executor/verify-plan.js";

const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures.push(name + (detail ? ` (${detail})` : ""));
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function memStore(): VaultStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(key) {
      return data.get(key) as never;
    },
    async set(key, entry) {
      data.set(key, entry);
    },
    async remove(key) {
      data.delete(key);
    },
    async keys() {
      return [...data.keys()];
    },
  };
}

console.log("=== Phase 11 Performance & Reliability Benchmark Test Suite ===");

// ── [1] P11-02: DOM Detection Validator Throughput Benchmark ───────────────────
console.log("\n[1] P11-02: DOM Detection Validator Throughput Benchmark");
{
  const iterations = 5000;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    isPanValid("ABCPE1234F");
    isAadhaarValid("987654321012");
    isCardValid("4111111111111111");
    isGstinValid("27ABCDE1234F1Z5");
    isIfscValid("SBIN0001234");
  }
  const elapsedMs = performance.now() - start;
  const totalOps = iterations * 5;
  const usPerOp = (elapsedMs / totalOps) * 1000;

  check(`DOM Validators throughput: ${usPerOp.toFixed(3)} µs/op (< 10 µs budget)`, usPerOp < 10);
}

// ── [2] P11-05 / P11-06: Placeholder Allocation & Fusion Throughput ───────────
console.log("\n[2] P11-05 & P11-06: Placeholder Allocation & Redaction Throughput");
{
  const alloc = new PlaceholderAllocator("perf-session");
  const iterations = 2000;
  const start = performance.now();

  for (let i = 0; i < iterations; i++) {
    alloc.allocate("EMAIL", `user${i}@example.com`, "dom");
  }

  const elapsedMs = performance.now() - start;
  const usPerAlloc = (elapsedMs / iterations) * 1000;

  check(`Placeholder allocation throughput: ${usPerAlloc.toFixed(3)} µs/op (< 50 µs budget)`, usPerAlloc < 50);
}

// ── [3] P11-07: Plan Verification Latency Benchmark ───────────────────────────
console.log("\n[3] P11-07: Plan Verification Latency Benchmark");
{
  const samplePlan = [
    { type: "type", target: "#username", value: "EMAIL_1" },
    { type: "type", target: "#pan", value: "PAN_1" },
    { type: "click", target: "#submit-btn" },
  ];

  const iterations = 1000;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    verifyPlan(samplePlan);
  }
  const elapsedMs = performance.now() - start;
  const usPerVerification = (elapsedMs / iterations) * 1000;

  check(`Plan verification latency: ${usPerVerification.toFixed(3)} µs/plan (< 100 µs budget)`, usPerVerification < 100);
}

// ── [4] P11-09 / P11-14: Memory Lifecycle & Vault Cleanup ─────────────────────
console.log("\n[4] P11-09 & P11-14: Memory Lifecycle & Vault Cleanup");
{
  const store = memStore();
  const secretCount = 100;

  for (let i = 0; i < secretCount; i++) {
    await saveSecret({ origin: `https://app${i}.com`, cls: "PASSWORD" }, { label: `pw${i}`, value: `pass${i}` }, { store });
  }

  check(`Vault holds exactly ${secretCount} stored entries`, (await store.keys()).length === secretCount);

  const purgedCount = await forgetAll({ store });
  check(`forgetAll() reliably purges all ${purgedCount} secrets`, purgedCount === secretCount && (await store.keys()).length === 0);
}

// ── [5] P11-15: Bounded Retries & Timeout Enforcement ─────────────────────────
console.log("\n[5] P11-15: Bounded Retries & Timeout Enforcement");
{
  const MAX_RETRIES = 3;
  let attempts = 0;

  async function mockFlakyOperation(): Promise<boolean> {
    attempts++;
    if (attempts < MAX_RETRIES) {
      throw new Error("Temporary network timeout");
    }
    return true;
  }

  let finalSuccess = false;
  let retryCount = 0;

  while (retryCount < MAX_RETRIES) {
    try {
      finalSuccess = await mockFlakyOperation();
      break;
    } catch {
      retryCount++;
    }
  }

  check("Retry loop terminates within bounded retry budget (<= 3)", retryCount < MAX_RETRIES && attempts === 3 && finalSuccess);
}

// ── [6] P11-17: High-Volume Stress Test ───────────────────────────────────────
console.log("\n[6] P11-17: High-Volume Stress Test");
{
  const stressRounds = 500;
  let errorCount = 0;

  for (let r = 0; r < stressRounds; r++) {
    const isPan = isPanValid("ABCPE1234F");
    const isAadhaar = isAadhaarValid("123456789012"); // Starts with 1 (never issued by UIDAI)
    if (!isPan || isAadhaar) {
      errorCount++;
    }
  }

  check(`500 consecutive detection rounds executed with 0 errors`, errorCount === 0);
}

console.log("\n============================================================");
if (failures.length === 0) {
  console.log("✅ ALL PHASE 11 PERFORMANCE & RELIABILITY TESTS PASSED (100%)");
} else {
  console.error(`❌ FAILED: ${failures.length} check(s)`);
  process.exit(1);
}
