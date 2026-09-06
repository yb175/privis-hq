// tests/test-agent-action.ts
// Unit and production QA tests for CBA-1 AgentAction contract and session types

import assert from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type AgentAction,
  type AgentSession,
  type SessionStep,
  type Target,
  isAgentAction,
  isTarget,
  parseAgentAction,
  validateAgentAction,
} from "../remote-agent/types.js";

console.log("=== Running CBA-1 AgentAction & Session Types Test Suite ===");

// --------------------------------------------------------------------------
// 1. Target Validation
// --------------------------------------------------------------------------
console.log("\n[1] Target validation checks");

// Valid targets
assert.strictEqual(isTarget({ css: "#btn" }), true, "Target with css only should be valid");
assert.strictEqual(
  isTarget({ name: "Submit" }),
  true,
  "Target with name only should be valid (fixture requirement)"
);
assert.strictEqual(isTarget({ role: "button" }), true, "Target with role only should be valid");
assert.strictEqual(
  isTarget({ bbox: [10, 20, 100, 40] }),
  true,
  "Target with bbox only should be valid"
);
assert.strictEqual(
  isTarget({ css: "button.primary", role: "button", name: "Submit", bbox: [0, 0, 50, 20] }),
  true,
  "Target with all fields should be valid"
);

// Invalid targets
assert.strictEqual(isTarget(null), false, "null target is invalid");
assert.strictEqual(isTarget(undefined), false, "undefined target is invalid");
assert.strictEqual(isTarget({}), false, "empty target object is invalid");
assert.strictEqual(isTarget({ css: "" }), false, "target with empty css is invalid");
assert.strictEqual(
  isTarget({ bbox: [1, 2, 3] }),
  false,
  "target with bbox of wrong length is invalid"
);
assert.strictEqual(
  isTarget({ bbox: [1, 2, "3", 4] as any }),
  false,
  "target with non-number in bbox is invalid"
);
console.log("  ✔ All Target validation checks passed");

// --------------------------------------------------------------------------
// 2. Valid AgentAction Parsing & Types
// --------------------------------------------------------------------------
console.log("\n[2] Valid AgentAction parsing (JSON & Objects)");

// Navigate
const navAction = parseAgentAction(JSON.stringify({ type: "navigate", url: "https://example.com" }));
assert.strictEqual(navAction.type, "navigate");
if (navAction.type === "navigate") {
  assert.strictEqual(navAction.url, "https://example.com");
}
console.log("  ✔ Navigate action parsed successfully");

// Click with CSS
const clickCssAction = parseAgentAction({
  type: "click",
  target: { css: "#submit-button" },
});
assert.strictEqual(clickCssAction.type, "click");
if (clickCssAction.type === "click") {
  assert.strictEqual(clickCssAction.target.css, "#submit-button");
}
console.log("  ✔ Click action with CSS selector parsed successfully");

// Click with Name only (Fixture requirement)
const clickNameAction = parseAgentAction({
  type: "click",
  target: { name: "Submit" },
});
assert.strictEqual(clickNameAction.type, "click");
if (clickNameAction.type === "click") {
  assert.strictEqual(clickNameAction.target.name, "Submit");
  assert.strictEqual(clickNameAction.target.css, undefined);
}
console.log("  ✔ Click action with name: 'Submit' (without css) parsed successfully");

// Type with Placeholder (e.g. PAN_1, EMAIL_1, AADHAAR_1, etc.)
const typePanAction = parseAgentAction({
  type: "type",
  target: { css: "#pan-field" },
  placeholder: "PAN_1",
});
assert.strictEqual(typePanAction.type, "type");
if (typePanAction.type === "type") {
  assert.strictEqual(typePanAction.placeholder, "PAN_1");
  assert.strictEqual(typePanAction.target.css, "#pan-field");
}

for (const ph of ["EMAIL_1", "AADHAAR_1", "AMOUNT_1", "PHONE_1", "NAME_1"]) {
  const parsed = parseAgentAction({
    type: "type",
    target: { role: "textbox" },
    placeholder: ph,
  });
  assert.strictEqual(parsed.type, "type");
  if (parsed.type === "type") {
    assert.strictEqual(parsed.placeholder, ph);
  }
}
console.log("  ✔ Type actions with valid placeholders (PAN_1, EMAIL_1, etc.) parsed successfully");

// Scroll
const scrollAction = parseAgentAction(JSON.stringify({ type: "scroll", dy: 250 }));
assert.strictEqual(scrollAction.type, "scroll");
if (scrollAction.type === "scroll") {
  assert.strictEqual(scrollAction.dy, 250);
}
const scrollUpAction = parseAgentAction({ type: "scroll", dy: -100 });
assert.strictEqual(scrollUpAction.type, "scroll");
if (scrollUpAction.type === "scroll") {
  assert.strictEqual(scrollUpAction.dy, -100);
}
console.log("  ✔ Scroll actions (positive and negative dy) parsed successfully");

// Done
const doneAction = parseAgentAction({
  type: "done",
  reason: "Form submitted and confirmation displayed",
});
assert.strictEqual(doneAction.type, "done");
if (doneAction.type === "done") {
  assert.strictEqual(doneAction.reason, "Form submitted and confirmation displayed");
}
console.log("  ✔ Done action parsed successfully");

// Ask Human
const askAction = parseAgentAction({
  type: "ask_human",
  reason: "Two-factor authentication code required from user",
});
assert.strictEqual(askAction.type, "ask_human");
if (askAction.type === "ask_human") {
  assert.strictEqual(askAction.reason, "Two-factor authentication code required from user");
}
console.log("  ✔ Ask human action parsed successfully");

// --------------------------------------------------------------------------
// 3. Security & Safety: Rejections of Raw PII and Invalid Actions
// --------------------------------------------------------------------------
console.log("\n[3] Security & Guard rejection checks");

// Test: reject { type: "type", value: "ABCDE1234F" } (missing placeholder / contains value)
assert.throws(
  () => {
    parseAgentAction({ type: "type", value: "ABCDE1234F" });
  },
  {
    message: /must not contain 'value'|placeholder/i,
  },
  "Should reject 'type' action with 'value' property"
);

// Test: reject raw PAN string in placeholder
assert.throws(
  () => {
    parseAgentAction({
      type: "type",
      target: { css: "#pan" },
      placeholder: "ABCDE1234F",
    });
  },
  {
    message: /Raw PAN detected in placeholder/i,
  },
  "Should reject raw PAN in placeholder"
);

// Test: reject raw Email string in placeholder
assert.throws(
  () => {
    parseAgentAction({
      type: "type",
      target: { css: "#email" },
      placeholder: "john.doe@company.com",
    });
  },
  {
    message: /Raw EMAIL detected in placeholder/i,
  },
  "Should reject raw EMAIL in placeholder"
);

// Test: reject raw Aadhaar in placeholder
assert.throws(
  () => {
    parseAgentAction({
      type: "type",
      target: { css: "#aadhaar" },
      placeholder: "1234 5678 9012",
    });
  },
  {
    message: /Raw AADHAAR detected in placeholder/i,
  },
  "Should reject raw AADHAAR in placeholder"
);

// Test: reject raw Phone in placeholder
assert.throws(
  () => {
    parseAgentAction({
      type: "type",
      target: { css: "#phone" },
      placeholder: "9876543210",
    });
  },
  {
    message: /Raw PHONE detected in placeholder/i,
  },
  "Should reject raw PHONE in placeholder"
);

// Test: reject unknown action type
assert.throws(
  () => {
    parseAgentAction({
      type: "clickButton",
      target: "#submit",
    });
  },
  {
    message: /Unknown action type/i,
  },
  "Should reject non-contract action types like 'clickButton'"
);

// Test: reject malformed JSON
assert.throws(
  () => {
    parseAgentAction("{ malformed json }");
  },
  {
    message: /Invalid JSON/i,
  },
  "Should reject malformed JSON string"
);

// Test: validateAgentAction returns ok: false without throwing
const resInvalid = validateAgentAction({ type: "navigate" });
assert.strictEqual(resInvalid.ok, false);
assert.ok(typeof (resInvalid as { ok: false; error: string }).error === "string");

console.log("  ✔ All security and error rejection checks passed");

// --------------------------------------------------------------------------
// 4. Fixture Acceptance Tests
// --------------------------------------------------------------------------
console.log("\n[4] Fixture validation checks");

const clickSubmitFixture = JSON.parse(
  readFileSync(resolve(process.cwd(), "fixtures/agent-action-click-submit.json"), "utf-8")
);
const parsedClickFixture = parseAgentAction(clickSubmitFixture);
assert.strictEqual(parsedClickFixture.type, "click");
if (parsedClickFixture.type === "click") {
  assert.strictEqual(parsedClickFixture.target.name, "Submit");
}

const typePanFixture = JSON.parse(
  readFileSync(resolve(process.cwd(), "fixtures/agent-action-type-pan.json"), "utf-8")
);
const parsedTypeFixture = parseAgentAction(typePanFixture);
assert.strictEqual(parsedTypeFixture.type, "type");
if (parsedTypeFixture.type === "type") {
  assert.strictEqual(parsedTypeFixture.placeholder, "PAN_1");
  assert.strictEqual(parsedTypeFixture.target.css, "#pan-input");
}
console.log("  ✔ Fixtures loaded and verified against contract");

// --------------------------------------------------------------------------
// 5. Session Types & Multi-Step Lifecycle Verification
// --------------------------------------------------------------------------
console.log("\n[5] Session types and state lifecycle checks");

const sessionSteps: SessionStep[] = [
  {
    step: 1,
    url: "https://example.com/login",
    action: { type: "type", target: { css: "#pan-input" }, placeholder: "PAN_1" },
    result: { ok: true },
    timestamp: Date.now() - 2000,
  },
  {
    step: 2,
    url: "https://example.com/login",
    action: { type: "click", target: { name: "Submit" } },
    result: { ok: true },
    timestamp: Date.now() - 1000,
  },
  {
    step: 3,
    url: "https://example.com/dashboard",
    action: { type: "done", reason: "Navigation to dashboard complete" },
    result: { ok: true },
    timestamp: Date.now(),
  },
];

const session: AgentSession = {
  sessionId: "sess_test_12345",
  tabId: 42,
  goal: "Fill PAN and log in",
  step: 3,
  maxSteps: 8,
  status: "done",
  history: sessionSteps,
  lastAction: sessionSteps[2].action,
};

assert.strictEqual(session.sessionId, "sess_test_12345");
assert.strictEqual(session.tabId, 42);
assert.strictEqual(session.step, 3);
assert.strictEqual(session.maxSteps, 8);
assert.strictEqual(session.status, "done");
assert.strictEqual(session.history.length, 3);
assert.strictEqual(session.lastAction?.type, "done");

// Verify type guard
assert.strictEqual(isAgentAction(session.lastAction), true);

console.log("  ✔ Session state and lifecycle structures verified");

console.log("\n============================================================");
console.log("✅ ALL CBA-1 AGENTACTION & SESSION TESTS PASSED (100%)");
console.log("============================================================\n");
