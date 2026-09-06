// tests/test-packager-guard.ts
// Comprehensive unit & production QA test suite for CBA-3 Packager & Guard

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import type { SanitizedPackage, SanitizedContext, ElementMeta, BrowserState } from "../types/index.js";
import { type AgentAction } from "../remote-agent/types.js";
import {
  buildUserPrompt,
  buildSystemPrompt,
  extractPlaceholderAllowlist,
  packagePrompt,
  SYSTEM_PROMPT,
} from "../remote-agent/packager.js";
import {
  guardModelOutput,
  guardAction,
  getPlaceholderAllowlistFromContext,
  findPiiInValue,
} from "../remote-agent/guard.js";

console.log("=== Running CBA-3 Packager & Guard Test Suite ===");

// --------------------------------------------------------------------------
// Fixture setup
// --------------------------------------------------------------------------
const fixtureContextPath = path.resolve(process.cwd(), "fixtures/sanitized-context.json");
const realSanitizedContext = JSON.parse(
  fs.readFileSync(fixtureContextPath, "utf-8")
) as SanitizedContext;

function createValidPackage(overrides?: Partial<SanitizedPackage>): SanitizedPackage {
  return {
    goal: "Verify employee PAN and reimbursement details",
    sanitizedScreenshot: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    sanitizedContext: JSON.parse(JSON.stringify(realSanitizedContext)),
    redacted: true,
    ...overrides,
  };
}

// --------------------------------------------------------------------------
// 1. Packager Tests
// --------------------------------------------------------------------------
console.log("\n[1] Packager prompt building & placeholder isolation");

const pkg = createValidPackage();

// 1.1 System Prompt
const sysPrompt = buildSystemPrompt();
assert.strictEqual(sysPrompt, SYSTEM_PROMPT);
assert.ok(sysPrompt.includes("PRIVIS Remote Browser Agent"));
assert.ok(sysPrompt.includes("CRITICAL PRIVACY RULE"));
console.log("  ✔ Packager system prompt matches specification");

// 1.2 Placeholder Allowlist Extraction
const allowlist = extractPlaceholderAllowlist(pkg.sanitizedContext);
assert.ok(allowlist instanceof Set);
assert.ok(allowlist.has("EMAIL_1"));
assert.ok(allowlist.has("PAN_1"));
assert.ok(allowlist.has("AADHAAR_1"));
assert.ok(allowlist.has("AMOUNT_1"));
assert.ok(allowlist.has("PHONE_1"));
assert.ok(allowlist.has("NAME_1"));
assert.strictEqual(allowlist.has("Submit"), false, "Non-placeholder text must not be in allowlist");
assert.strictEqual(allowlist.has("PAN_2"), false);
console.log("  ✔ Allowlist extracted all expected placeholders from sanitized context");

// 1.3 User Prompt Building
const userPrompt = buildUserPrompt(pkg);
assert.ok(userPrompt.includes("USER GOAL: Verify employee PAN and reimbursement details"));
assert.ok(userPrompt.includes("PAGE URL: https://hr.internal.example/employee-portal"));
assert.ok(userPrompt.includes("PAGE TITLE: Employee Portal — Reimbursement"));
assert.ok(userPrompt.includes("VIEWPORT: 1280x800"));
assert.ok(userPrompt.includes("AVAILABLE PLACEHOLDERS: [EMAIL_1, PAN_1, AADHAAR_1, AMOUNT_1, PHONE_1, NAME_1]"));
assert.ok(userPrompt.includes('id="pan"'));
assert.ok(userPrompt.includes('text="PAN_1"'));
assert.ok(!userPrompt.includes("ABCDE1234F"), "Prompt must NEVER contain raw PAN");
console.log("  ✔ User prompt accurately formats goal, state, placeholders, and elements");

// 1.4 User Prompt with Last Step Result
const promptWithLastStep = buildUserPrompt(pkg, {
  action: { type: "type", target: { css: "#email" }, placeholder: "EMAIL_1" },
  result: { ok: true },
});
assert.ok(promptWithLastStep.includes("LAST STEP RESULT:"));
assert.ok(promptWithLastStep.includes('Action: {"type":"type","target":{"css":"#email"},"placeholder":"EMAIL_1"} -> Result: OK'));

const promptWithFailedStep = buildUserPrompt(pkg, {
  action: { type: "click", target: { css: "#unknown-btn" } },
  result: { ok: false, error: "Element not found in DOM" },
});
assert.ok(promptWithFailedStep.includes("Result: FAILED (Element not found in DOM)"));
console.log("  ✔ Packager includes last step action & result when provided");

// 1.5 Complete packagePrompt API
const packaged = packagePrompt(pkg, {
  lastStepResult: {
    action: { type: "navigate", url: "https://hr.internal.example/employee-portal" },
    result: { ok: true },
  },
});
assert.ok(packaged.systemPrompt.length > 0);
assert.ok(packaged.userPrompt.length > 0);
assert.ok(packaged.allowlist.has("PAN_1"));
assert.strictEqual(packaged.screenshot, pkg.sanitizedScreenshot);
console.log("  ✔ packagePrompt produces validated PackagedPrompt with allowlist and screenshot");

// 1.6 Boundary Enforcement
assert.throws(
  () => {
    packagePrompt({ ...pkg, tabId: 10 } as any);
  },
  { message: /Refusing to route: package contains raw field "tabId"/i }
);

assert.throws(
  () => {
    packagePrompt({ ...pkg, dataUrl: "data:image/png;base64,raw" } as any);
  },
  { message: /Refusing to route: package contains raw field "dataUrl"/i }
);

assert.throws(
  () => {
    packagePrompt({ ...pkg, detections: [] } as any);
  },
  { message: /Refusing to route: package contains raw field "detections"/i }
);

assert.throws(
  () => {
    packagePrompt({ ...pkg, redacted: undefined as unknown as true });
  },
  { message: /package not marked as sanitized/i }
);

assert.throws(
  () => {
    const leaked = createValidPackage();
    leaked.sanitizedContext.elements.push({
      element_id: "leaked",
      tag: "input",
      type: "text",
      role: null,
      label: null,
      text: "ABCDE1234F", // Leaked raw PAN!
      bbox: [0, 0, 10, 10],
    });
    packagePrompt(leaked);
  },
  { message: /Refusing to route: PAN pattern detected/i }
);
console.log("  ✔ Packager boundary strictly refuses unredacted packages and leaked PII");

// --------------------------------------------------------------------------
// 2. Guard Validation & Action Rules
// --------------------------------------------------------------------------
console.log("\n[2] Guard validation & schema enforcement");

// 2.1 Valid Actions
const validNavigate = guardModelOutput('{"type": "navigate", "url": "https://example.com/page"}', {
  sanitizedPackage: pkg,
});
assert.strictEqual(validNavigate.ok, true);
if (validNavigate.ok) {
  assert.strictEqual(validNavigate.action.type, "navigate");
  assert.strictEqual((validNavigate.action as any).url, "https://example.com/page");
}

const validClick = guardModelOutput(
  '{"type": "click", "target": {"css": "#submit", "role": "button"}}',
  { sanitizedPackage: pkg }
);
assert.strictEqual(validClick.ok, true);
if (validClick.ok) {
  assert.strictEqual(validClick.action.type, "click");
}

const validType = guardModelOutput(
  '{"type": "type", "target": {"css": "#pan"}, "placeholder": "PAN_1"}',
  { sanitizedPackage: pkg }
);
assert.strictEqual(validType.ok, true);
if (validType.ok) {
  assert.strictEqual(validType.action.type, "type");
  assert.strictEqual((validType.action as any).placeholder, "PAN_1");
}

const validScroll = guardModelOutput('{"type": "scroll", "dy": 300}', { sanitizedPackage: pkg });
assert.strictEqual(validScroll.ok, true);
if (validScroll.ok) {
  assert.strictEqual(validScroll.action.type, "scroll");
  assert.strictEqual((validScroll.action as any).dy, 300);
}

const validDone = guardModelOutput('{"type": "done", "reason": "Completed successfully"}', {
  sanitizedPackage: pkg,
});
assert.strictEqual(validDone.ok, true);

const validAskHuman = guardModelOutput('{"type": "ask_human", "reason": "Need OTP code"}', {
  sanitizedPackage: pkg,
});
assert.strictEqual(validAskHuman.ok, true);
console.log("  ✔ Guard validates all standard CBA action types successfully");

// 2.2 Markdown code fence & wrapper unwrapping
const mdOutput = '```json\n{\n  "type": "click",\n  "target": {"css": "#btn"}\n}\n```';
const unwrapped = guardModelOutput(mdOutput, { sanitizedPackage: pkg });
assert.strictEqual(unwrapped.ok, true);
if (unwrapped.ok) {
  assert.strictEqual(unwrapped.action.type, "click");
}

const wrappedAction = '{"action": {"type": "scroll", "dy": -200}}';
const unwrappedObj = guardModelOutput(wrappedAction, { sanitizedPackage: pkg });
assert.strictEqual(unwrappedObj.ok, true);
if (unwrappedObj.ok) {
  assert.strictEqual(unwrappedObj.action.type, "scroll");
}
console.log("  ✔ Guard handles markdown fences and wrapper objects seamlessly");

// 2.3 Single Action Enforcement (Reject Multi-Actions)
const arrayOutput = '[{"type": "click", "target": {"css": "#a"}}, {"type": "click", "target": {"css": "#b"}}]';
const arrayGuard = guardModelOutput(arrayOutput, { sanitizedPackage: pkg });
assert.strictEqual(arrayGuard.ok, false);
assert.strictEqual(arrayGuard.fallbackAction.type, "ask_human");
assert.ok(arrayGuard.error.includes("Multiple actions detected"));

const actionsObjOutput = '{"actions": [{"type": "click", "target": {"css": "#a"}}]}';
const actionsGuard = guardModelOutput(actionsObjOutput, { sanitizedPackage: pkg });
assert.strictEqual(actionsGuard.ok, false);
assert.ok(actionsGuard.error.includes("Multiple actions detected"));
console.log("  ✔ Guard strictly rejects multiple actions (one action per step enforced)");

// --------------------------------------------------------------------------
// 3. Navigate Guard & URL Schemes
// --------------------------------------------------------------------------
console.log("\n[3] Navigate action protocol & safety guards");

// Allowed protocols
const httpRes = guardModelOutput('{"type": "navigate", "url": "http://insecure.internal.example"}');
assert.strictEqual(httpRes.ok, true);
const httpsRes = guardModelOutput('{"type": "navigate", "url": "https://secure.example.com"}');
assert.strictEqual(httpsRes.ok, true);

// Disallowed protocols
const dangerousUrls = [
  "javascript:alert(1)",
  "JAVASCRIPT:document.location='http://attacker.com'",
  "data:text/html,<h1>Hacked</h1>",
  "file:///etc/passwd",
  "vbscript:msgbox(1)",
  "chrome://settings",
  "chrome-extension://abcdef/options.html",
  "about:blank",
  "ftp://ftp.example.com/file",
  "ws://localhost:8080",
];

for (const badUrl of dangerousUrls) {
  const badRes = guardModelOutput(JSON.stringify({ type: "navigate", url: badUrl }));
  assert.strictEqual(badRes.ok, false, `Guard must reject dangerous URL: ${badUrl}`);
  assert.strictEqual(badRes.fallbackAction.type, "ask_human");
  assert.ok(
    badRes.error.includes("Disallowed URL protocol") || badRes.error.includes("Invalid URL"),
    `Error must mention protocol/URL issue for: ${badUrl}`
  );
}
console.log("  ✔ Guard allows http/https only and rejects all dangerous protocols");

// --------------------------------------------------------------------------
// 4. Type Action & Placeholder Allowlist Enforcement
// --------------------------------------------------------------------------
console.log("\n[4] Placeholder allowlist & PII rejection guards");

// 4.1 Token format validation
const badFormatRes = guardModelOutput(
  '{"type": "type", "target": {"css": "#input"}, "placeholder": "pan_1"}', // lowercase
  { sanitizedPackage: pkg }
);
assert.strictEqual(badFormatRes.ok, false);
assert.ok(badFormatRes.error.includes("Invalid placeholder format"));

const freeformRes = guardModelOutput(
  '{"type": "type", "target": {"css": "#input"}, "placeholder": "my_secret_pan"}',
  { sanitizedPackage: pkg }
);
assert.strictEqual(freeformRes.ok, false);
assert.ok(freeformRes.error.includes("Invalid placeholder format"));

// 4.2 Allowlist enforcement (reject hallucinated tokens)
const hallucinatedToken = guardModelOutput(
  '{"type": "type", "target": {"css": "#pan"}, "placeholder": "PAN_2"}', // context only has PAN_1
  { sanitizedPackage: pkg }
);
assert.strictEqual(hallucinatedToken.ok, false);
assert.ok(hallucinatedToken.error.includes("does not exist in sanitized context"));
assert.strictEqual(hallucinatedToken.fallbackAction.type, "ask_human");
console.log("  ✔ Guard rejects hallucinated placeholder tokens not present in allowlist");

// 4.3 Rejection of raw field keys (value, text, val, input, content)
const rawValuePayloads = [
  '{"type": "type", "target": {"css": "#input"}, "placeholder": "PAN_1", "value": "ABCDE1234F"}',
  '{"type": "type", "target": {"css": "#input"}, "placeholder": "PAN_1", "text": "user@example.com"}',
  '{"type": "type", "target": {"css": "#input"}, "placeholder": "PAN_1", "input": "secret123"}',
  '{"type": "type", "target": {"css": "#input"}, "placeholder": "PAN_1", "val": "12345"}',
  '{"type": "type", "target": {"css": "#input"}, "placeholder": "PAN_1", "content": "hello"}',
  '{"type": "type", "target": {"css": "#input"}, "placeholder": "PAN_1", "password": "pass"}',
];

for (const rawPayload of rawValuePayloads) {
  const rawRes = guardModelOutput(rawPayload, { sanitizedPackage: pkg });
  assert.strictEqual(rawRes.ok, false, `Guard must reject raw field in: ${rawPayload}`);
  assert.ok(rawRes.error.includes("Forbidden raw field"));
}
console.log("  ✔ Guard rejects presence of raw field keys in action payloads");

// 4.4 Comprehensive Raw PII detection
const rawPiiCases = [
  { name: "PAN", raw: "ABCDE1234F" },
  { name: "AADHAAR", raw: "9876 5432 1098" },
  { name: "EMAIL", raw: "john.doe@company.org" },
  { name: "PHONE", raw: "+91-9876543210" },
  { name: "CREDIT_CARD", raw: "4111 2222 3333 4444" },
  { name: "US_SSN", raw: "123-45-6789" },
  { name: "UK_NINO", raw: "JH 12 34 56 A" },
  { name: "IBAN", raw: "GB29XABC10203012345678" },
  { name: "IFSC", raw: "HDFC0001234" },
  { name: "UPI_VPA", raw: "user@okhdfcbank" },
  { name: "API_KEY", raw: "sk-1234567890abcdef1234567890abcdef" },
];

for (const { name, raw } of rawPiiCases) {
  // In placeholder
  const piiInPlaceholder = guardModelOutput(
    JSON.stringify({ type: "type", target: { css: "#input" }, placeholder: raw }),
    { sanitizedPackage: pkg }
  );
  assert.strictEqual(piiInPlaceholder.ok, false, `Guard must catch raw ${name} in placeholder`);
  assert.ok(
    piiInPlaceholder.error.includes("Raw ") || piiInPlaceholder.error.includes("Invalid placeholder"),
    `Error should identify raw PII or invalid format for: ${raw}`
  );

  // In target CSS/name
  const piiInTarget = guardModelOutput(
    JSON.stringify({ type: "click", target: { css: `#user-${raw}` } }),
    { sanitizedPackage: pkg }
  );
  assert.strictEqual(piiInTarget.ok, false, `Guard must catch raw ${name} in target`);
  assert.ok(piiInTarget.error.includes("Raw "), `Error should catch raw PII in target for: ${raw}`);

  // In done reason
  const piiInDone = guardModelOutput(
    JSON.stringify({ type: "done", reason: `Submitted details with ${raw}` }),
    { sanitizedPackage: pkg }
  );
  assert.strictEqual(piiInDone.ok, false, `Guard must catch raw ${name} in done reason`);
  assert.ok(piiInDone.error.includes("Raw "), `Error should catch raw PII in done reason for: ${raw}`);
}
console.log("  ✔ Guard catches & rejects all PII patterns across placeholder, target, and reasons");

// --------------------------------------------------------------------------
// 5. Target Validation & Edge Cases
// --------------------------------------------------------------------------
console.log("\n[5] Target validation & edge cases in Guard");

// Empty target
const emptyTargetRes = guardModelOutput('{"type": "click", "target": {}}');
assert.strictEqual(emptyTargetRes.ok, false);
assert.ok(emptyTargetRes.error.includes("requires a valid 'target'"));

// Null target
const nullTargetRes = guardModelOutput('{"type": "click", "target": null}');
assert.strictEqual(nullTargetRes.ok, false);

// Non-number scroll dy
const badScrollRes = guardModelOutput('{"type": "scroll", "dy": "fast"}');
assert.strictEqual(badScrollRes.ok, false);
assert.ok(badScrollRes.error.includes("requires a finite number 'dy'"));

// Empty done reason
const emptyDoneRes = guardModelOutput('{"type": "done", "reason": "  "}');
assert.strictEqual(emptyDoneRes.ok, false);

// Empty ask_human reason
const emptyAskRes = guardModelOutput('{"type": "ask_human", "reason": ""}');
assert.strictEqual(emptyAskRes.ok, false);

// Malformed JSON string
const malformedJsonRes = guardModelOutput('{ bad: json }');
assert.strictEqual(malformedJsonRes.ok, false);
assert.strictEqual(malformedJsonRes.fallbackAction.type, "ask_human");
assert.ok(malformedJsonRes.fallbackAction.reason.includes("Invalid JSON"));
console.log("  ✔ Guard safely handles all malformed, empty, and invalid targets");

// --------------------------------------------------------------------------
// 6. guardAction API & End-to-End Fallback Flow
// --------------------------------------------------------------------------
console.log("\n[6] guardAction API & End-to-End Fallback flow");

// Valid action object passed to guardAction
const directValidAction: AgentAction = {
  type: "type",
  target: { css: "#pan" },
  placeholder: "PAN_1",
};
const directRes = guardAction(directValidAction, { sanitizedPackage: pkg });
assert.strictEqual(directRes.ok, true);

// Invalid action object (hallucinated placeholder) passed to guardAction
const directInvalidAction: AgentAction = {
  type: "type",
  target: { css: "#pan" },
  placeholder: "PAN_99",
};
const directInvalidRes = guardAction(directInvalidAction, { sanitizedPackage: pkg });
assert.strictEqual(directInvalidRes.ok, false);
assert.strictEqual(directInvalidRes.fallbackAction.type, "ask_human");
assert.ok(directInvalidRes.fallbackAction.reason.includes("does not exist in sanitized context"));
console.log("  ✔ guardAction directly guards AgentAction objects with fallback ask_human");

console.log("\n============================================================");
console.log("✅ ALL CBA-3 PACKAGER & GUARD TESTS PASSED (100%)");
console.log("============================================================\n");
