import assert from "node:assert";
import { guardModelOutput } from "../remote-agent/guard.js";
import { validateVerificationSpec } from "../remote-agent/types.js";
import { verifyPostcondition } from "../orchestrator/verification.js";
import { persistSessions, hydrateSessions, sessionsByTab, startSession } from "../orchestrator/session.js";

const element = (text: string, id = "status"): any => ({
  element_id: id, tag: "div", type: null, role: "status", label: null, text,
  bbox: [0, 0, 10, 10], documentId: "doc-1", frameId: 0,
});
let current = { text: "Saving", url: "https://example.test/form" };
(globalThis as any).chrome = {
  tabs: { sendMessage: async () => ({ type: "capture.response", payload: {
    elements: [element(current.text)], frameId: 0,
    browserState: { url: current.url, title: "Test", viewport: { w: 100, h: 100 } },
  } }) },
  storage: { session: {
    data: {} as Record<string, unknown>,
    async get(key: string) { return { [key]: this.data[key] }; },
    async set(value: Record<string, unknown>) { Object.assign(this.data, value); },
  } },
};

const before = { browserState: { url: current.url, title: "Test", viewport: { w: 100, h: 100 } }, elements: [element("Saving")] };
current = { text: "Saved", url: current.url };
const verified = await verifyPostcondition(1, before, { checks: [{ type: "text_appeared", needle: "Saved" }], timeoutMs: 100 });
assert.strictEqual(verified.ok, true, "text postcondition should pass");

const bad = await verifyPostcondition(1, before, { checks: [{ type: "text_appeared", needle: "Never appears" }], timeoutMs: 100 });
assert.strictEqual(bad.ok, false, "missing postcondition must fail closed");
assert.strictEqual(bad.code, "TIMEOUT");

const plan = guardModelOutput({
  action: { type: "click", target: { ref: { snapshotVersion: 1, documentId: "doc-1", elementId: "save" } } },
  verification: { mode: "all", checks: [{ type: "text_appeared", needle: "Saved" }], timeoutMs: 1000 },
});
assert.strictEqual(plan.ok, true);
assert.strictEqual(plan.ok && plan.action.verification?.checks.length, 1);
assert.strictEqual(validateVerificationSpec({ checks: [{ type: "count_changed", role: "button", delta: 1 }] }).ok, true);
assert.strictEqual(validateVerificationSpec({ checks: [{ type: "execute", code: "alert(1)" }] }).ok, false);

const tab = 991;
const session = startSession(tab, "fill email@example.com");
await persistSessions();
sessionsByTab.delete(tab);
await hydrateSessions();
const restored = sessionsByTab.get(tab);
assert.ok(restored, "paused control state should restore");
assert.ok(!JSON.stringify((globalThis as any).chrome.storage.session.data).includes("email@example.com"), "PII must not persist");
assert.ok(!JSON.stringify((globalThis as any).chrome.storage.session.data).includes("outboundPayload"), "screenshots must not persist");
console.log("verification, fail-closed timeout, planner contract, and session persistence tests passed");
