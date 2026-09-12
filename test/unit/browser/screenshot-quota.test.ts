// tests/test-screenshot-quota.ts
// Regression for #64: captureVisibleTab is Chrome-throttled to ~2 calls/sec.
// The mock below ENFORCES that quota; if utils/screenshot.ts spacing ever
// breaks, these calls reject with the real Chrome error and the test fails.

import assert from "node:assert/strict";
import { takeScreenshot } from "../../../utils/screenshot.js";

const CALLS_PER_SECOND_LIMIT = 2;
const timestamps: number[] = [];

function mockChrome() {
  (globalThis as Record<string, unknown>).chrome = {
    tabs: {
      get: async (tabId: number) => ({ id: tabId, active: true, windowId: 1 }),
      update: async () => {},
      captureVisibleTab: async (_windowId: number, _opts: unknown) => {
        const now = Date.now();
        timestamps.push(now);
        // Rolling 1s window: >2 calls/sec is a quota violation.
        const recent = timestamps.filter((t) => now - t < 1000).length;
        if (recent > CALLS_PER_SECOND_LIMIT) {
          throw new Error(
            "This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota."
          );
        }
        return "data:image/png;base64,iVBORw0KGgo=";
      },
    },
  };
}

async function main() {
  mockChrome();

  // 1) Concurrent burst (what per-tab session loops / HUD can produce).
  const results = await Promise.all([
    takeScreenshot(1),
    takeScreenshot(1),
    takeScreenshot(1),
  ]);
  assert.equal(results.length, 3);
  assert.ok(results.every((r) => r.dataUrl.startsWith("data:image/png")));
  console.log("  \u2714 3 concurrent captures stay under the quota (serialized + spaced)");

  // 2) The capturePackage-style retry pattern: back-to-back, no caller sleep.
  for (let i = 0; i < 3; i++) {
    await takeScreenshot(1);
  }
  console.log("  \u2714 3 sequential retries stay under the quota");

  const elapsed = timestamps[timestamps.length - 1] - timestamps[0];
  assert.ok(elapsed >= 1200, `expected spacing to stretch 6 calls past ${elapsed}ms`);
  console.log(`  \u2714 6 captures spaced over ${elapsed}ms (\u22651200ms required)`);

  console.log("\n\u2705 SCREENSHOT QUOTA TESTS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
