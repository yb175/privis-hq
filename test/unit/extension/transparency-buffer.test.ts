// tests/test-transparency-buffer.ts
// CBA-11 Unit Test: Session Grouping, Ring-Buffer Bounding, and Storage Pruning.
// Verifies Goals G2, G6, and Acceptance Rules AC-1, AC-5.

import assert from "node:assert";
import {
  logTransparencyEntry,
  getTransparencyLog,
  clearTransparencyLog,
  MAX_TRANSPARENCY_SESSIONS,
  MAX_TRANSPARENCY_BYTES,
  TRANSPARENCY_STORAGE_KEY,
} from "../../../orchestrator/transparency-log.js";
import type { SanitizedPackage, TransparencyEntry } from "../../../types/index.js";

// Mock chrome.storage.local
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

function createEntry(
  sessionId: string,
  step: number,
  screenshot = "data:image/png;base64,AAAA"
): TransparencyEntry {
  const pkg: SanitizedPackage = {
    goal: `Goal for ${sessionId}`,
    sanitizedScreenshot: screenshot,
    sanitizedContext: {
      elements: [
        {
          element_id: "btn",
          tag: "button",
          type: null,
          role: "button",
          label: null,
          text: "Submit",
          bbox: [0, 0, 10, 10],
        },
      ],
      browserState: {
        url: "https://example.com",
        title: "Test",
        viewport: { w: 640, h: 480 },
      },
    },
    redacted: true,
    redactionManifest: {
      counts: {},
      redactedFraction: 0,
      overRedactedFraction: 0,
      policyVersion: "2.0.0",
      receipt: {
        algo: "SHA-256",
        hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        manifestHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        sealedAt: Date.now(),
      },
    },
  };

  return {
    sessionId,
    goal: pkg.goal,
    step,
    timestamp: Date.now() + step * 1000,
    model: "chatgpt",
    request: pkg,
    requestDigest: `mock_digest_${sessionId}_${step}`,
    response: { type: "click", target: { name: "Submit" } },
    gate: { decision: "allow", reason: "ok" },
  };
}

async function runBufferTests() {
  console.log("=== CBA-11 Grouping, Ring Buffer & Storage Pruning Suite ===");

  await clearTransparencyLog();

  // 1. Session Grouping & Step Ordering (G2, AC-1)
  console.log("\n[1] Multi-step session grouping and step ordering");
  {
    const sessId = "session_alpha";
    // Append 4 steps
    for (let step = 1; step <= 4; step++) {
      await logTransparencyEntry(createEntry(sessId, step));
    }

    const store = await getTransparencyLog();
    assert.strictEqual(store.entries.length, 4);
    assert.strictEqual(store.prunedCount, 0);

    // Assert all belong to session_alpha and steps are 1, 2, 3, 4
    const steps = store.entries.map((e) => e.step);
    assert.deepStrictEqual(steps, [1, 2, 3, 4], "Steps must be ordered strictly ascending");
    assert.ok(store.entries.every((e) => e.sessionId === sessId));
    console.log("  ✔ Grouping and step ordering verified across 4 steps");
  }

  // 2. Session Count Cap (Max 5 sessions, oldest-first pruning) (G6, AC-5)
  console.log("\n[2] Max 5 sessions cap and oldest-first eviction");
  {
    await clearTransparencyLog();

    // Write 6 distinct sessions (sess_1 to sess_6)
    for (let i = 1; i <= 6; i++) {
      await logTransparencyEntry(createEntry(`sess_${i}`, 1));
      await logTransparencyEntry(createEntry(`sess_${i}`, 2));
    }

    const store = await getTransparencyLog();
    const uniqueSessionIds = Array.from(new Set(store.entries.map((e) => e.sessionId)));

    // Must retain exactly 5 newest sessions (sess_2 to sess_6)
    assert.strictEqual(
      uniqueSessionIds.length,
      MAX_TRANSPARENCY_SESSIONS,
      `Retained sessions must equal MAX_TRANSPARENCY_SESSIONS (${MAX_TRANSPARENCY_SESSIONS})`
    );
    assert.deepStrictEqual(
      uniqueSessionIds,
      ["sess_2", "sess_3", "sess_4", "sess_5", "sess_6"],
      "Oldest session sess_1 must be evicted first"
    );
    assert.strictEqual(store.prunedCount, 1, "prunedCount must record 1 pruned session");
    console.log("  ✔ Session cap of 5 enforced, sess_1 evicted, prunedCount = 1");
  }

  // 3. Byte Cap (~4MB) and Newest Session Intact (G6, AC-5)
  console.log("\n[3] Byte capacity cap (~4MB) with newest session always intact");
  {
    await clearTransparencyLog();

    // Create a 1.5MB screenshot string
    const largeScreenshot = "data:image/png;base64," + "A".repeat(1.5 * 1024 * 1024);

    // Write 4 sessions with large screenshots (4 * 1.5MB = ~6MB > 4MB cap)
    for (let i = 1; i <= 4; i++) {
      await logTransparencyEntry(createEntry(`large_sess_${i}`, 1, largeScreenshot));
    }

    const store = await getTransparencyLog();
    const totalBytes = new TextEncoder().encode(JSON.stringify(store)).length;

    // Must be bounded within ~4MB
    assert.ok(
      totalBytes <= MAX_TRANSPARENCY_BYTES,
      `Total storage size ${totalBytes} must be <= 4MB cap (${MAX_TRANSPARENCY_BYTES})`
    );

    const remainingSessions = Array.from(new Set(store.entries.map((e) => e.sessionId)));
    // Newest session MUST be intact (AC-5)
    assert.ok(
      remainingSessions.includes("large_sess_4"),
      "Newest session (large_sess_4) must remain intact"
    );

    // At least 2 sessions had to be pruned to fit under 4MB
    assert.ok(store.prunedCount >= 2, "Pruned count must reflect evicted large sessions");
    console.log(`  ✔ Byte cap enforced: store size is ${(totalBytes / 1024 / 1024).toFixed(2)}MB <= 4MB, pruned ${store.prunedCount} sessions`);
  }

  console.log("\n============================================================");
  console.log("✅ ALL CBA-11 GROUPING & RING BUFFER CHECKS PASSED (100%)");
  console.log("============================================================\n");
}

runBufferTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
