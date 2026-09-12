// tests/test-transparency-purity.ts
// CBA-11 Unit Test: Log Purity, Security Boundary, and Fail-Closed Verification.
// Verifies Goals G1, G4, and Acceptance Rule AC-2.

import assert from "node:assert";
import {
  logTransparencyEntry,
  getTransparencyLog,
  clearTransparencyLog,
  computeRequestDigest,
  validateSanitizedForLog,
  TRANSPARENCY_STORAGE_KEY,
} from "../../../orchestrator/transparency-log.js";
import { PII_PATTERNS } from "../../../remote-agent/types.js";
import type { SanitizedPackage, TransparencyEntry } from "../../../types/index.js";

// Setup mocked chrome.storage.local
const mockStorage: Record<string, unknown> = {};
(globalThis as Record<string, unknown>).chrome = {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: mockStorage[key] }),
      set: async (items: Record<string, unknown>) => {
        Object.assign(mockStorage, items);
      },
    },
  },
};

// 38 Real-World PII Fixtures from CBA-1
const PII_CASES: { label: string; sample: string }[] = [
  // 1. National IDs
  { label: "PAN standard uppercase", sample: "ABCDE1234F" },
  { label: "PAN lowercase", sample: "abcde1234f" },
  { label: "PAN embedded in sentence", sample: "my pan is ABCDE1234F please submit" },
  { label: "Aadhaar with spaces", sample: "2345 6789 0123" },
  { label: "Aadhaar with hyphens", sample: "2345-6789-0123" },
  { label: "Aadhaar contiguous", sample: "234567890123" },
  { label: "US SSN standard", sample: "123-45-6789" },
  { label: "US SSN with spaces", sample: "123 45 6789" },
  { label: "UK NINO standard", sample: "QQ123456A" },
  { label: "UK NINO formatted", sample: "QQ 12 34 56 A" },
  { label: "Passport number", sample: "A1234567" },

  // 2. Financial & Banking
  { label: "Visa card", sample: "4111111111111111" },
  { label: "Mastercard formatted", sample: "5500-0000-0000-0004" },
  { label: "Amex card", sample: "378282246310005" },
  { label: "RuPay card", sample: "6071 2345 6789 0123" },
  { label: "IBAN UK format", sample: "GB82WEST12345698765432" },
  { label: "IBAN DE format", sample: "DE89370400440532013000" },
  { label: "Indian IFSC code", sample: "HDFC0001234" },
  { label: "UPI VPA GPay", sample: "user@okhdfcbank" },
  { label: "UPI VPA Paytm", sample: "9876543210@paytm" },
  { label: "UPI VPA PhonePe", sample: "john@ybl" },
  { label: "Raw currency dollar", sample: "$5,000.00" },
  { label: "Raw currency INR", sample: "₹50,000" },
  { label: "Raw currency EUR", sample: "1,250.50 EUR" },

  // 3. Contact & Identity
  { label: "Email standard", sample: "john.doe@company.com" },
  { label: "Email plus-address", sample: "alex+newsletter@domain.co.uk" },
  { label: "Email subdomains", sample: "admin@dev.server.corp.org" },
  { label: "Phone US format", sample: "(555) 123-4567" },
  { label: "Phone international +91", sample: "+91 98765 43210" },
  { label: "Phone international +44", sample: "+44 20 7946 0958" },
  { label: "Phone dotted format", sample: "555.123.4567" },
  { label: "IPv4 address", sample: "192.168.1.100" },
  { label: "DOB DD/MM/YYYY", sample: "15/08/1990" },
  { label: "DOB YYYY-MM-DD", sample: "1995-12-31" },

  // 4. Secrets & Auth Credentials
  {
    label: "JWT Bearer Token",
    sample: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThis",
  },
  { label: "AWS Access Key", sample: "AKIAIOSFODNN7EXAMPLE" },
  { label: "GitHub Token", sample: "ghp_1234567890abcdefghijklmnopqrstuvwxyzAB" },
  { label: "Bearer Secret", sample: "Bearer secret_token_value_abc123" },
];

function createValidPackage(goal = "Submit form"): SanitizedPackage {
  return {
    goal,
    sanitizedScreenshot: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    sanitizedContext: {
      elements: [
        {
          element_id: "el-1",
          tag: "input",
          type: "text",
          role: "textbox",
          label: null,
          text: "PAN_1",
          bbox: [10, 10, 100, 30],
        },
      ],
      browserState: {
        url: "https://portal.example/form",
        title: "Test Form",
        viewport: { w: 640, h: 480 },
      },
    },
    redacted: true,
  };
}

async function runTests() {
  console.log("=== CBA-11 Log Purity, Boundary & Fail-Closed Suite ===");

  await clearTransparencyLog();

  // 1. Valid Package Logging
  console.log("\n[1] Clean sanitized package commit");
  {
    const cleanPkg = createValidPackage("Legitimate goal");
    const digest = await computeRequestDigest(cleanPkg);

    const entry: TransparencyEntry = {
      sessionId: "sess_clean_1",
      goal: "Legitimate goal",
      step: 1,
      timestamp: Date.now(),
      model: "chatgpt",
      request: cleanPkg,
      requestDigest: digest,
      response: { type: "click", target: { name: "Submit" } },
      gate: { decision: "allow", reason: "All clear" },
    };

    await logTransparencyEntry(entry);
    const store = await getTransparencyLog();
    assert.strictEqual(store.entries.length, 1);
    assert.strictEqual(store.entries[0].sessionId, "sess_clean_1");
    assert.strictEqual(store.entries[0].request.goal, "Legitimate goal");
    assert.strictEqual(store.entries[0].error, undefined);
    assert.strictEqual(store.entries[0].requestDigest, digest);
    console.log("  ✔ Clean package successfully stored with matching digest");
  }

  // 2. Fail-Closed Property Tests for all 38 PII samples
  console.log("\n[2] Fail-Closed verification across all 38 real-world PII fixtures");
  {
    assert.strictEqual(PII_CASES.length, 38, "Must have exactly 38 PII test fixtures");
    let count = 0;
    for (const tc of PII_CASES) {
      count++;
      const leakedPkg = createValidPackage();
      // Inject raw PII directly into an element's text
      leakedPkg.sanitizedContext.elements.push({
        element_id: `leak-${count}`,
        tag: "span",
        type: null,
        role: null,
        label: null,
        text: tc.sample,
        bbox: [0, 0, 10, 10],
      });

      const initialDigest = await computeRequestDigest(leakedPkg);
      const badEntry: TransparencyEntry = {
        sessionId: `sess_pii_${count}`,
        goal: "Goal with potential leak",
        step: 1,
        timestamp: Date.now(),
        model: "chatgpt",
        request: leakedPkg,
        requestDigest: initialDigest,
        response: null,
        gate: { decision: "allow", reason: "mock" },
      };

      // Writing MUST NOT throw, and MUST NOT skip silently (G4)
      await logTransparencyEntry(badEntry);

      const store = await getTransparencyLog();
      const lastEntry = store.entries[store.entries.length - 1];

      assert.strictEqual(lastEntry.sessionId, `sess_pii_${count}`);
      // Request MUST be replaced by safe digest-only stub
      assert.strictEqual(lastEntry.request.sanitizedScreenshot, "");
      assert.deepStrictEqual(lastEntry.request.sanitizedContext.elements, []);
      assert.ok(
        lastEntry.error?.startsWith("FAIL_CLOSED:"),
        `Entry must record FAIL_CLOSED error for sample "${tc.sample}" (${tc.label})`
      );
      // Request digest preserved for audit trail
      assert.strictEqual(lastEntry.requestDigest, initialDigest);
    }
    console.log(`  ✔ All ${count} PII leaks cleanly failed closed to digest-only stubs`);
  }

  // 3. Raw Field Injection (tabId, dataUrl, detections, label)
  console.log("\n[3] Structural forbidden fields fail-closed test");
  {
    const forbiddenKeys = ["tabId", "dataUrl", "detections"];
    for (const key of forbiddenKeys) {
      const rawPkg = {
        ...createValidPackage(),
        [key]: "raw_value_leak",
      } as unknown as SanitizedPackage;

      const entry: TransparencyEntry = {
        sessionId: `sess_raw_${key}`,
        goal: "Test raw field",
        step: 1,
        timestamp: Date.now(),
        model: "chatgpt",
        request: rawPkg,
        requestDigest: await computeRequestDigest(rawPkg),
        response: null,
        gate: { decision: "block", reason: "Raw field detected" },
      };

      await logTransparencyEntry(entry);
      const store = await getTransparencyLog();
      const stored = store.entries[store.entries.length - 1];
      assert.strictEqual(stored.request.sanitizedScreenshot, "");
      assert.deepStrictEqual(stored.request.sanitizedContext.elements, []);
      assert.ok(stored.error?.includes("FAIL_CLOSED"));
    }

    // Element with unredacted user label
    const labelPkg = createValidPackage();
    labelPkg.sanitizedContext.elements[0].label = "leaked real secret";
    const labelEntry: TransparencyEntry = {
      sessionId: "sess_raw_label",
      goal: "Test label",
      step: 1,
      timestamp: Date.now(),
      model: "chatgpt",
      request: labelPkg,
      requestDigest: await computeRequestDigest(labelPkg),
      response: null,
      gate: { decision: "block", reason: "Label leak" },
    };
    await logTransparencyEntry(labelEntry);
    const store = await getTransparencyLog();
    const stored = store.entries[store.entries.length - 1];
    assert.ok(stored.error?.includes("FAIL_CLOSED"));
    console.log("  ✔ Structural raw fields (tabId, dataUrl, detections, labels) all fail closed");
  }

  // 4. AC-2 Tripwire: Grep entire storage JSON for zero PII or raw secrets
  console.log("\n[4] Acceptance Rule AC-2: Full storage serialization regex scan");
  {
    const entireStorageJson = JSON.stringify(mockStorage[TRANSPARENCY_STORAGE_KEY]);

    // Check forbidden field keys
    for (const forbidden of ['"tabId"', '"dataUrl"', '"detections"']) {
      assert.strictEqual(
        entireStorageJson.includes(forbidden),
        false,
        `AC-2 VIOLATION: Entire storage contains forbidden key ${forbidden}`
      );
    }

    // Check PII patterns
    for (const { name, re } of PII_PATTERNS) {
      assert.strictEqual(
        re.test(entireStorageJson),
        false,
        `AC-2 VIOLATION: Entire storage leaked PII pattern ${name}`
      );
    }

    // Check every raw PII sample
    for (const tc of PII_CASES) {
      assert.strictEqual(
        entireStorageJson.includes(tc.sample),
        false,
        `AC-2 VIOLATION: Stored JSON contains raw sample "${tc.sample}" (${tc.label})`
      );
    }

    console.log("  ✔ AC-2 Passed: Zero PII patterns, zero raw keys, zero fixture leaks in stored JSON");
  }

  console.log("\n============================================================");
  console.log("✅ ALL CBA-11 LOG PURITY & FAIL-CLOSED CHECKS PASSED (100%)");
  console.log("============================================================\n");
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
