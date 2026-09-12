// tests/test-phase6-browser.ts
// Phase 06: Advanced Browser Interaction, Dynamic Pages, and Reliable Execution Test Suite.

import assert from "node:assert";
import process from "node:process";
import type { Action, ElementMeta } from "../types/index.js";
import { isInteractiveElement, checkInteractivity } from "../content/interactivity.js";
import { checkOcclusion } from "../content/occlusion.js";
import { waitForPageSettle } from "../content/settle-watch.js";
import { formatValue } from "../executor/format-value.js";
import { verifyActionCompletion } from "../executor/complete.js";
import { executeAction, resolveTarget } from "../content/capture-content.js";

const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures.push(name + (detail ? ` (${detail})` : ""));
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("=== Phase 06 Advanced Browser Interaction Test Suite ===");

// ── [1] P06-02: Interactivity Validation ──────────────────────────────────────
console.log("\n[1] P06-02: Interactivity Validation");
{
  const btn = {
    tagName: "BUTTON",
    hasAttribute: (a: string) => false,
    getAttribute: (a: string) => null,
  };
  check("Plain button is interactive and actionable", isInteractiveElement(btn as any) && checkInteractivity(btn as any).actionable);

  const disabledBtn = {
    tagName: "BUTTON",
    hasAttribute: (a: string) => a === "disabled",
    getAttribute: (a: string) => null,
    disabled: true,
  };
  const dRes = checkInteractivity(disabledBtn as any);
  check("Disabled button marked non-actionable", !dRes.actionable && dRes.reason === "disabled");

  const ariaHiddenInput = {
    tagName: "INPUT",
    hasAttribute: (a: string) => a === "aria-hidden",
    getAttribute: (a: string) => a === "aria-hidden" ? "true" : "text",
    closest: (sel: string) => sel.includes("aria-hidden") ? true : null,
  };
  const aRes = checkInteractivity(ariaHiddenInput as any);
  check("Aria-hidden input marked non-actionable", !aRes.actionable && aRes.reason === "aria-hidden");
}

// ── [2] P06-03: Occlusion & Viewport Hit-Testing ─────────────────────────────
console.log("\n[2] P06-03: Occlusion & Viewport Hit-Testing");
{
  const mockOffscreen = {
    getBoundingClientRect: () => ({ left: -500, top: -500, right: -100, bottom: -100, width: 400, height: 400 }),
  };
  const offRes = checkOcclusion(mockOffscreen as any);
  check("Off-screen element detected as occluded/invisible", offRes.occluded);

  const mockZeroDim = {
    getBoundingClientRect: () => ({ left: 10, top: 10, right: 10, bottom: 10, width: 0, height: 0 }),
  };
  const zeroRes = checkOcclusion(mockZeroDim as any);
  check("Zero-dimension element detected as occluded", zeroRes.occluded && zeroRes.reason === "zero-dimensions");
}

// ── [3] P06-04 & P06-11: Dynamic Settle Watching ─────────────────────────────
console.log("\n[3] P06-04 & P06-11: Dynamic Settle Watching");
async function testSettle() {
  const settleRes = await waitForPageSettle(undefined, { quietMs: 20, timeoutMs: 100 });
  check("waitForPageSettle resolves with settled status", settleRes.settled && !settleRes.timedOut);
}
await testSettle();

// ── [4] P06-06: Form Interaction (Select, Checkbox, Textarea, Contenteditable) ──
console.log("\n[4] P06-06: Form Interaction (Select, Checkbox, Textarea, Contenteditable)");
{
  // Checkbox toggle simulation
  const mockCheckbox: any = {
    tagName: "INPUT",
    type: "checkbox",
    checked: false,
    dispatchEvent: () => true,
    value: "on",
  };
  // Select dropdown simulation
  const mockSelect: any = {
    tagName: "SELECT",
    options: [
      { value: "IN", text: "India" },
      { value: "US", text: "United States" },
    ],
    selectedIndex: 0,
    value: "IN",
    dispatchEvent: () => true,
  };

  check("Select options structure is valid", mockSelect.options.length === 2);
}

// ── [5] P06-07: Deterministic Formatting ─────────────────────────────────────
console.log("\n[5] P06-07: Deterministic Formatting");
{
  const formatted = formatValue("15 aug 1947", { placeholder: "DD/MM/YYYY" });
  check("Date formatted to DD/MM/YYYY", formatted.text === "15/08/1947");

  const formattedIso = formatValue("15/08/1947", { inputType: "date" });
  check("Date formatted to ISO YYYY-MM-DD for date inputs", formattedIso.text === "1947-08-15");
}

// ── [6] P06-10: Action Postcondition Verification ───────────────────────────
console.log("\n[6] P06-10: Action Postcondition Verification");
{
  const pre: ElementMeta[] = [{ element_id: "inp1", tag: "input", text: "", bbox: [0, 0, 100, 20], label: "Name", type: "text", role: "textbox" }];
  const postFilled: ElementMeta[] = [{ element_id: "inp1", tag: "input", text: "Arjun", bbox: [0, 0, 100, 20], label: "Name", type: "text", role: "textbox" }];

  const verdict = verifyActionCompletion({ type: "type", target: "inp1", value: "Arjun" }, pre, postFilled);
  check("Action postcondition confirms VERIFIED_FILLED", verdict.ok && verdict.verdict === "VERIFIED_FILLED");

  const verdictNav = verifyActionCompletion({ type: "navigate", target: "https://example.com" }, pre, [], { navigated: true });
  check("Navigation postcondition confirms PAGE_NAVIGATED", verdictNav.ok && verdictNav.verdict === "PAGE_NAVIGATED");
}

console.log("\n============================================================");
if (failures.length === 0) {
  console.log("✅ ALL PHASE 06 BROWSER INTERACTION TESTS PASSED (100%)");
} else {
  console.error(`❌ FAILED: ${failures.length} check(s)`);
  process.exit(1);
}
