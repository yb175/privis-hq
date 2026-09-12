// tests/test-navigate.ts
// CBA-5: navigate executor QA — URL allowlist boundary + chrome.tabs behavior.

import assert from "node:assert";
import { isAllowedNavigateUrl, navigateTab } from "../../../executor/navigate.js";

console.log("=== Running CBA-5 navigate executor test suite ===");

// --------------------------------------------------------------------------
// 1. URL allowlist boundary
// --------------------------------------------------------------------------
console.log("\n[1] isAllowedNavigateUrl boundary");

assert.strictEqual(isAllowedNavigateUrl("https://portal.local/form"), true, "https allowed");
assert.strictEqual(isAllowedNavigateUrl("http://fixture.local"), true, "http allowed");

const forbidden = [
  "javascript:alert(1)",
  "file:///etc/passwd",
  "data:text/html,<script>1</script>",
  "vbscript:msgbox(1)",
  "chrome://settings",
  "chrome-extension://abc/manifest.json",
  "about:blank",
  "not a url",
  "https://",
];
for (const url of forbidden) {
  assert.strictEqual(isAllowedNavigateUrl(url), false, `should reject: ${url}`);
}
console.log(`  ✔ Rejects ${forbidden.length} forbidden/non-http(s) URLs`);

// --------------------------------------------------------------------------
// 2. chrome.tabs behavior (mocked)
// --------------------------------------------------------------------------
console.log("\n[2] navigateTab with mocked chrome.tabs");

// 2.1 successful navigation waits for load, returns ok
let updateCalled = false;
let loadWaits = 0;
(globalThis as any).chrome = {
  tabs: {
    async update(tabId: number, props: { url: string }) {
      updateCalled = true;
      assert.strictEqual(tabId, 7);
      assert.strictEqual(props.url, "https://portal.local/form");
    },
    async get() {
      loadWaits++;
      return { status: loadWaits < 3 ? "loading" : "complete" };
    },
  },
};

const okRes = await navigateTab(7, "https://portal.local/form");
assert.strictEqual(okRes.ok, true, "navigate ok");
assert.strictEqual(updateCalled, true, "tabs.update called");
assert.ok(loadWaits >= 3, "waited for load to complete");

// 2.2 rejects a disallowed scheme at the executor boundary (defense in depth)
const badRes = await navigateTab(7, "javascript:alert(1)");
assert.strictEqual(badRes.ok, false, "navigate rejects javascript:");
assert.ok((badRes.error as string).includes("http:"), "error names the policy");

// 2.3 propagate a tabs.update throw as a failed result (no crash)
(globalThis as any).chrome.tabs.update = async () => {
  throw new Error("No tab with id: 99");
};
const throwRes = await navigateTab(99, "https://example.com");
assert.strictEqual(throwRes.ok, false, "navigate fails closed on update error");
assert.ok((throwRes.error as string).includes("No tab"), "error message surfaced");

delete (globalThis as any).chrome;
const noChromeRes = await navigateTab(7, "https://example.com");
assert.strictEqual(noChromeRes.ok, false, "navigate fails closed when chrome is absent");

console.log("  ✔ navigateTab ok-path, reject-path, error-path, and no-chrome path all behave");
console.log("\nAll CBA-5 navigate executor checks passed");
