// tests/test-transparency-digest.ts
// CBA-11 Unit Test: SHA-256 Tamper Digest Verification
// Verifies Goal G3 and Acceptance Rule AC-4.

import assert from "node:assert";
import { computeRequestDigest } from "../../../orchestrator/transparency-log.js";
import type { SanitizedPackage } from "../../../types/index.js";

async function runDigestTests() {
  console.log("=== CBA-11 SHA-256 Request Digest & Tamper Detection Suite ===");

  const samplePkg: SanitizedPackage = {
    goal: "Verify employee information",
    sanitizedScreenshot: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    sanitizedContext: {
      elements: [
        {
          element_id: "el-name",
          tag: "input",
          type: "text",
          role: "textbox",
          label: null,
          text: "NAME_1",
          bbox: [10, 20, 200, 25],
        },
        {
          element_id: "el-pan",
          tag: "input",
          type: "text",
          role: "textbox",
          label: null,
          text: "PAN_1",
          bbox: [10, 60, 200, 25],
        },
      ],
      browserState: {
        url: "https://portal.internal/onboarding",
        title: "Employee Portal",
        viewport: { w: 800, h: 600 },
      },
    },
    redacted: true,
  };

  // 1. Valid SHA-256 Hex Digest Format
  console.log("\n[1] SHA-256 format & determinism");
  {
    const digest1 = await computeRequestDigest(samplePkg);
    const digest2 = await computeRequestDigest(samplePkg);

    assert.strictEqual(typeof digest1, "string");
    assert.strictEqual(digest1.length, 64, "SHA-256 hex string must be 64 characters");
    assert.ok(/^[0-9a-f]{64}$/.test(digest1), "Digest must be lowercase hexadecimal");
    assert.strictEqual(digest1, digest2, "Digest must be strictly deterministic across calls");
    console.log(`  ✔ Deterministic 64-char SHA-256 digest computed: ${digest1.slice(0, 16)}…`);
  }

  // 2. Tamper Detection Across Different Fields (AC-4)
  console.log("\n[2] Tamper detection across package mutations");
  {
    const baseDigest = await computeRequestDigest(samplePkg);

    // Mutation A: modified goal
    const tamperedGoal = JSON.parse(JSON.stringify(samplePkg));
    tamperedGoal.goal = "Verify employee information (tampered)";
    const digestA = await computeRequestDigest(tamperedGoal);
    assert.notStrictEqual(digestA, baseDigest, "Goal modification must alter digest");

    // Mutation B: modified element token
    const tamperedElement = JSON.parse(JSON.stringify(samplePkg));
    tamperedElement.sanitizedContext.elements[0].text = "NAME_2";
    const digestB = await computeRequestDigest(tamperedElement);
    assert.notStrictEqual(digestB, baseDigest, "Element change must alter digest");

    // Mutation C: modified screenshot data URL
    const tamperedScreenshot = JSON.parse(JSON.stringify(samplePkg));
    tamperedScreenshot.sanitizedScreenshot = "data:image/png;base64,TAMPERED_DATA";
    const digestC = await computeRequestDigest(tamperedScreenshot);
    assert.notStrictEqual(digestC, baseDigest, "Screenshot data change must alter digest");

    // Mutation D: modified URL
    const tamperedUrl = JSON.parse(JSON.stringify(samplePkg));
    tamperedUrl.sanitizedContext.browserState.url = "https://evil.example/";
    const digestD = await computeRequestDigest(tamperedUrl);
    assert.notStrictEqual(digestD, baseDigest, "BrowserState URL change must alter digest");

    console.log("  ✔ Tampering detected across goal, elements, screenshot, and URL modifications");
  }

  console.log("\n============================================================");
  console.log("✅ ALL CBA-11 SHA-256 TAMPER DIGEST CHECKS PASSED (100%)");
  console.log("============================================================\n");
}

runDigestTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
