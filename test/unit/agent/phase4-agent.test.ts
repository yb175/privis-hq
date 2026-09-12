// tests/test-phase4-agent.ts
// Phase 04: Agent Execution, Tiered Planning, Verification, and Safety Test Suite.

import assert from "node:assert";
import process from "node:process";
import type { Action, ElementMeta, SanitizedPackage } from "../../../types/index.js";
import { parseGoal, tryLocalIntent, resolveTarget } from "../../../orchestrator/local-intent.js";
import { tokeniseGoal } from "../../../orchestrator/goal-tokenize.js";
import { selectExecutionTier, isFailureRecoverable } from "../../../orchestrator/local-model.js";
import { formatValue } from "../../../executor/format-value.js";
import { verifyPlan } from "../../../executor/verify-plan.js";
import { verifyActionCompletion } from "../../../executor/complete.js";
import { isInteractiveElement, checkInteractivity } from "../../../content/interactivity.js";
import { checkOcclusion } from "../../../content/occlusion.js";
import { waitForPageSettle } from "../../../content/settle-watch.js";
import { installCanvasShims } from "../../../test/unit/ml/vision/canvas-shim.js";
import { verifyReceipt } from "../../../remote-agent/receipt.js";
import { securePostJson } from "../../../remote-agent/transport.js";
import { sealAndRedact } from "../../../privacy/sanitizer/redaction-gate.js";

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

console.log("=== Phase 04 Agent Intelligence & Execution Test Suite ===");

// ── [1] P04-02: Deterministic Intent Grammar ─────────────────────────────────
console.log("\n[1] P04-02: Deterministic Intent Grammar");
{
  const g1 = parseGoal("click the submit button");
  check("click grammar parsed", g1?.verb === "click" && g1?.target === "submit");

  const g2 = parseGoal("type leo in first name");
  check("type grammar parsed (value-first)", g2?.verb === "type" && g2?.target === "first name" && g2?.value === "leo");

  const g3 = parseGoal("fill email with test@example.com");
  check("fill grammar parsed (target-first)", g3?.verb === "type" && g3?.target === "email" && g3?.value === "test@example.com");

  const gMulti = parseGoal("fill first name with leo then click submit");
  check("multi-clause goal refused by tier 0 grammar", gMulti === undefined);
}

// ── [2] P04-03: Deterministic Element Resolver ──────────────────────────────
console.log("\n[2] P04-03: Deterministic Element Resolver");
{
  const elements = [
    el("btn-1", "button", "Submit Application", { role: "button" }),
    el("inp-email", "input", "", { label: "Email Address", type: "email" }),
    el("inp-first", "input", "", { label: "First Name" }),
    el("inp-dup1", "input", "", { label: "Address Line" }),
    el("inp-dup2", "input", "", { label: "Address Line" }),
  ];

  const rSubmit = resolveTarget("submit application", elements);
  check("resolves exact text on button", "resolved" in rSubmit && rSubmit.resolved.el.element_id === "btn-1");

  const rEmail = resolveTarget("email address", elements);
  check("resolves label on input", "resolved" in rEmail && rEmail.resolved.el.element_id === "inp-email");

  const rAmbiguous = resolveTarget("address line", elements);
  check("detects ambiguous target and refuses", "ambiguous" in rAmbiguous);

  const rNone = resolveTarget("non-existent field", elements);
  check("returns none when target does not exist", "none" in rNone);
}

// ── [3] P04-04 & P04-05: Tier Selection & Failure Taxonomy ───────────────────
console.log("\n[3] P04-04 & P04-05: Tier Selection & Failure Taxonomy");
{
  const elements = [el("b1", "button", "Login", { role: "button" })];
  
  const t0 = selectExecutionTier("click login", elements);
  check("Tier 0 selected for simple deterministic click", t0.tier === 0 && t0.localIntent?.handled === true);

  const t2 = selectExecutionTier("compare the prices of all 5 items and select the cheapest", elements);
  check("Tier 2 selected for complex multi-step reasoning", t2.tier === 2);

  check("PAGE_NOT_SETTLED is recoverable", isFailureRecoverable("PAGE_NOT_SETTLED"));
  check("PLANNER_TIMEOUT is recoverable", isFailureRecoverable("PLANNER_TIMEOUT"));
  check("PRIVACY_GATE_FAILURE is NOT recoverable (fails closed)", !isFailureRecoverable("PRIVACY_GATE_FAILURE"));
  check("PLANNER_INVALID is NOT recoverable", !isFailureRecoverable("PLANNER_INVALID"));
}

// ── [4] P04-06: Goal Privacy & Tokenisation ─────────────────────────────────
console.log("\n[4] P04-06: Goal Privacy & Tokenisation");
{
  const rawGoal = "Transfer money for PAN ABCPE1234F to account";
  const tokenised = tokeniseGoal(rawGoal);
  check("PAN tokenised in goal string", tokenised.changed && tokenised.goal.includes("PAN_1"));
  check("Raw PAN not present in tokenised goal", !tokenised.goal.includes("ABCPE1234F"));
  check("Classes record reflects PAN tokenisation", tokenised.classes.PAN === 1);
}

// ── [5] P04-08 & P04-09: Plan Schema & Semantic Security Verification ────────
console.log("\n[5] P04-08 & P04-09: Plan Schema & Semantic Security Verification");
{
  const elements = [
    el("el-email", "input", "EMAIL_1", { label: "Email Address" }),
    el("el-btn", "button", "Submit", { role: "button" }),
  ];

  // Valid plan
  const pValid = verifyPlan([
    { type: "type", target: "el-email", value: "EMAIL_1" },
    { type: "click", target: "el-btn" },
  ], { elements });
  check("Valid plan accepted", pValid.ok && pValid.actions.length === 2);

  // Label echo
  const pEcho = verifyPlan([
    { type: "type", target: "el-email", value: "Email Address" },
  ], { elements });
  check("Plan echoing field label into value is rejected", !pEcho.ok && pEcho.violations.some((v) => v.code === "LABEL_ECHO"));

  // Raw PII leak
  const pPii = verifyPlan([
    { type: "type", target: "el-email", value: "ABCPE1234F" },
  ], { elements });
  check("Plan containing raw PAN in type value is rejected", !pPii.ok && pPii.violations.some((v) => v.code === "RAW_PII_LEAK"));

  // Hallucinated placeholder
  const pHallucinated = verifyPlan([
    { type: "type", target: "el-email", value: "PAN_99" },
  ], { elements });
  check("Plan containing hallucinated placeholder is rejected", !pHallucinated.ok && pHallucinated.violations.some((v) => v.code === "HALLUCINATED_PLACEHOLDER"));

  // Smeared placeholder
  const pSmeared = verifyPlan([
    { type: "type", target: "el-email", value: "EMAIL_NaN" },
  ], { elements });
  check("Plan containing smeared placeholder is rejected", !pSmeared.ok && pSmeared.violations.some((v) => v.code === "SMEARED_VALUE"));
}

// ── [6] P04-11: Interactivity & Occlusion ────────────────────────────────────
console.log("\n[6] P04-11: Interactivity & Occlusion");
{
  const mockBtn: any = {
    tagName: "BUTTON",
    hasAttribute: (attr: string) => attr === "disabled" || attr === "role",
    getAttribute: (attr: string) => attr === "role" ? "button" : null,
    disabled: true,
  };
  const interBtn = checkInteractivity(mockBtn);
  check("Disabled button recognized as non-actionable", interBtn.interactive && !interBtn.actionable && interBtn.reason === "disabled");

  const mockDiv: any = {
    tagName: "DIV",
    hasAttribute: () => false,
    getAttribute: () => null,
  };
  check("Plain div recognized as non-interactive", !isInteractiveElement(mockDiv));

  const occ = checkOcclusion(mockBtn);
  check("Occlusion checker provides boolean verdict", typeof occ.occluded === "boolean");
}

// ── [7] P04-12 & P04-13: Settle Watch & Completion Verification ─────────────
console.log("\n[7] P04-12 & P04-13: Settle Watch & Completion Verification");
{
  const preElements = [el("f1", "input", "")];
  const postFilled = [el("f1", "input", "leo")];
  const postEmpty = [el("f1", "input", "")];

  const vFilled = verifyActionCompletion(
    { type: "type", target: "f1", value: "leo" },
    preElements,
    postFilled
  );
  check("Successful fill verified as VERIFIED_FILLED", vFilled.ok && vFilled.verdict === "VERIFIED_FILLED");

  const vCleared = verifyActionCompletion(
    { type: "type", target: "f1", value: "leo" },
    preElements,
    postEmpty
  );
  check("Cleared/dropped fill caught as TARGET_CLEARED", !vCleared.ok && vCleared.verdict === "TARGET_CLEARED");

  const vMismatch = verifyActionCompletion(
    { type: "type", target: "f1", value: "leo" },
    preElements,
    [el("f1", "input", "different_value")]
  );
  check("Value mismatch caught as VALUE_MISMATCH", !vMismatch.ok && vMismatch.verdict === "VALUE_MISMATCH");
}

// ── [8] P04-14: Deterministic Field Formatting ──────────────────────────────
console.log("\n[8] P04-14: Deterministic Field Formatting");
{
  const d1 = formatValue("24th jan 2000", { placeholder: "DD-MM-YYYY" });
  check("Date formatted to DD-MM-YYYY", d1.text === "24-01-2000");

  const d2 = formatValue("24/01/2000", { inputType: "date" });
  check("Date formatted for HTML5 date input (ISO YYYY-MM-DD)", d2.text === "2000-01-24");

  const tClean = formatValue("  john doe  ", {});
  check("Default text trimmed without guessing shape", tClean.text === "john doe");
}

// ── [9] P04-17: Receipt & Transport Verification ────────────────────────────
console.log("\n[9] P04-17: Receipt & Transport Verification");
async function testTransport() {
  const restore = installCanvasShims();
  try {
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const sealed = await sealAndRedact(dataUrl, [], { w: 100, h: 100 });
    
    const checkPass = await verifyReceipt(sealed.sanitizedScreenshot, sealed.manifest);
    check("Cryptographic receipt verifies for intact package", checkPass.ok);

    const checkFail = await verifyReceipt(dataUrl, sealed.manifest);
    check("Tampered screenshot fails receipt check", !checkFail.ok && checkFail.reason === "image-digest-mismatch");
  } finally {
    restore();
  }
}

await testTransport();

console.log("\n============================================================");
if (failures.length === 0) {
  console.log("✅ ALL PHASE 04 AGENT EXECUTION TESTS PASSED (100%)");
} else {
  console.error(`❌ FAILED: ${failures.length} check(s)`);
  process.exit(1);
}
