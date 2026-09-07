// tests/test-settings.ts
// CBA-8 QA: Settings (server URL + model toggle + auth token).
// Guarantees under test:
//   1. Provider API keys are never persisted by, read from, or sent by the extension.
//   2. No server URL -> clear "configure the server" error (chat surfaces it).
//   3. Auth token is sent as Authorization: Bearer <token>.
//   4. serverOptionsFromSettings maps client fields and drops provider keys.

import assert from "node:assert";
import type { SanitizedPackage, ElementMeta, BrowserState } from "../types/index.js";
import {
  DEFAULT_MODEL_SETTINGS,
  normalizeModelSettings,
  loadModelSettings,
  saveModelSettings,
  toClientSettings,
  STORAGE_KEY_MODEL_SETTINGS,
} from "../extension/src/settings/models.js";
import { queryServer, serverOptionsFromSettings } from "../remote-agent/client-server.js";

console.log("=== Running CBA-8 Settings QA ===");

// Environment isolation: delete every provider key so the server path (env) and
// the extension path (storage) are tested independently.
const ENV_BACKUP = { ...process.env };
for (const envKey of [
  "PRIVIS_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
  "GEMINI_API_KEY",
  "GEMINI_BASE_URL",
  "GEMINI_MODEL",
]) {
  delete process.env[envKey];
}

function createValidSanitizedPackage(): SanitizedPackage {
  const elements: ElementMeta[] = [
    { element_id: "el-input-1", tag: "input", type: "text", role: "textbox", label: null, text: "PAN_1", bbox: [100, 150, 200, 32] },
    { element_id: "submit-btn", tag: "button", type: "submit", role: "button", label: null, text: "Submit Form", bbox: [100, 200, 120, 40] },
  ];
  const browserState: BrowserState = {
    url: "https://portal.internal.example/form",
    title: "Employee Verification Portal",
    viewport: { w: 1280, h: 720 },
  };
  return {
    goal: "Fill PAN and submit the verification form",
    sanitizedScreenshot: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    sanitizedContext: { elements, browserState },
    redacted: true,
  };
}

// --------------------------------------------------------------------------
// 1. toClientSettings strips provider keys
// --------------------------------------------------------------------------
console.log("\n[1] Client/Server settings split");

const full = normalizeModelSettings({
  model: "gemini",
  serverUrl: "http://my-agent:9000/",
  agentAuthToken: "tok",
  openaiApiKey: "sk-openai",
  geminiApiKey: "gk-gemini",
});
const client = toClientSettings(full);
assert.deepStrictEqual(client, {
  model: "gemini",
  serverUrl: "http://my-agent:9000/",
  agentAuthToken: "tok",
});
assert.ok(!("openaiApiKey" in client));
assert.ok(!("geminiApiKey" in client));
assert.ok(!("openaiBaseUrl" in client));
console.log("  ✔ toClientSettings keeps only model/serverUrl/agentAuthToken");

// --------------------------------------------------------------------------
// 2. saveModelSettings persists client fields only
// --------------------------------------------------------------------------
console.log("\n[2] Persistence never writes provider keys");

const mockStorage: Record<string, unknown> = {};
(globalThis as any).chrome = {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: mockStorage[key] }),
      set: async (items: Record<string, unknown>) => {
        Object.assign(mockStorage, items);
      },
    },
  },
};

await saveModelSettings({
  model: "gemini",
  agentAuthToken: "secret-auth",
  openaiApiKey: "sk-should-not-persist",
  geminiApiKey: "gk-should-not-persist",
});
const persisted = mockStorage[STORAGE_KEY_MODEL_SETTINGS] as Record<string, unknown>;
assert.strictEqual(persisted.model, "gemini");
assert.strictEqual(persisted.agentAuthToken, "secret-auth");
assert.strictEqual(persisted.serverUrl, DEFAULT_MODEL_SETTINGS.serverUrl);
assert.ok(!("openaiApiKey" in persisted), "openaiApiKey must never be persisted");
assert.ok(!("geminiApiKey" in persisted), "geminiApiKey must never be persisted");
assert.ok(!("openaiBaseUrl" in persisted), "provider base URLs must never be persisted");
assert.ok(!("geminiModel" in persisted), "provider model names must never be persisted");
console.log("  ✔ saveModelSettings writes only { model, serverUrl, agentAuthToken }");

// --------------------------------------------------------------------------
// 3. loadModelSettings drops provider keys from a stale storage blob
// --------------------------------------------------------------------------
console.log("\n[3] Stale storage blob cannot reintroduce keys");

mockStorage[STORAGE_KEY_MODEL_SETTINGS] = {
  model: "chatgpt",
  serverUrl: "http://stale:3201",
  openaiApiKey: "sk-leaked-in-old-blob",
  geminiApiKey: "gk-leaked-in-old-blob",
};
const loadedFromStorage = await loadModelSettings();
assert.strictEqual(loadedFromStorage.serverUrl, "http://stale:3201");
assert.strictEqual(loadedFromStorage.openaiApiKey, undefined);
assert.strictEqual(loadedFromStorage.geminiApiKey, undefined);
console.log("  ✔ keys in a stale chrome.storage blob are ignored on load");

// --------------------------------------------------------------------------
// 4. Server (env) path still reads provider keys
// --------------------------------------------------------------------------
console.log("\n[4] Server-side env path still holds keys");

delete (globalThis as any).chrome;
process.env.GEMINI_API_KEY = "server-held-gemini-key";
const serverLoaded = await loadModelSettings();
assert.strictEqual(serverLoaded.geminiApiKey, "server-held-gemini-key");
assert.strictEqual(serverLoaded.openaiApiKey, undefined, "OPENAI_API_KEY was deleted from env");
console.log("  ✔ loadModelSettings reads provider keys from env (server), not storage");

// --------------------------------------------------------------------------
// 5. queryServer: no server URL -> clear "configure" error (no fetch)
// --------------------------------------------------------------------------
console.log("\n[5] No server URL fail-fast");

const pkg = createValidSanitizedPackage();
let fetchCalls = 0;
const spyFetch: typeof fetch = async () => {
  fetchCalls++;
  return { ok: true, json: async () => ({ ok: true, action: { type: "done", reason: "x" } }) } as Response;
};

await assert.rejects(
  async () => queryServer(pkg, { serverUrl: "   ", fetchFn: spyFetch }),
  { message: /No agent server configured.*Settings/i },
  "empty Server URL must fail with a configure hint"
);
assert.strictEqual(fetchCalls, 0, "no network call for an empty server URL");
console.log("  ✔ empty Server URL throws a fix-it error without touching the network");

// --------------------------------------------------------------------------
// 6. queryServer: auth token header + no keys on the wire
// --------------------------------------------------------------------------
console.log("\n[6] Wire guarantees: auth header, no provider keys");

let recorded: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | null = null;
const mockFetch: typeof fetch = async (input, init) => {
  recorded = {
    url: input.toString(),
    headers: (init?.headers || {}) as Record<string, string>,
    body: JSON.parse(init?.body as string),
  };
  return { ok: true, status: 200, json: async () => ({ ok: true, action: { type: "done", reason: "ok" } }) } as Response;
};

await queryServer(pkg, {
  serverUrl: "http://srv:3201",
  authToken: "secret-token",
  model: "gemini",
  fetchFn: mockFetch,
});
const rec = recorded as unknown as { url: string; headers: Record<string, string>; body: Record<string, unknown> };
assert.ok(rec, "fetch should have been called");
assert.strictEqual(rec.url, "http://srv:3201/plan");
assert.strictEqual(rec.headers.Authorization, "Bearer secret-token");
assert.strictEqual(rec.body.model, "gemini");
assert.ok(!("openaiApiKey" in rec.body));
assert.ok(!("geminiApiKey" in rec.body));
assert.ok(!("apiKey" in rec.body));
console.log("  ✔ queryServer sends Bearer auth + model preference, zero provider keys");

// --------------------------------------------------------------------------
// 7. serverOptionsFromSettings maps client fields, drops keys
// --------------------------------------------------------------------------
console.log("\n[7] serverOptionsFromSettings mapping");

const opts = serverOptionsFromSettings(
  normalizeModelSettings({
    serverUrl: "http://prod:8080",
    model: "gemini",
    agentAuthToken: "t",
    openaiApiKey: "sk-z",
  })
);
assert.strictEqual(opts.serverUrl, "http://prod:8080");
assert.strictEqual(opts.authToken, "t");
assert.strictEqual(opts.model, "gemini");
assert.ok(!("apiKey" in opts));
console.log("  ✔ serverOptionsFromSettings maps { serverUrl, authToken, model } only");

// Restore developer environment
process.env = ENV_BACKUP;

console.log("\n============================================================");
console.log("✅ ALL CBA-8 SETTINGS QA PASSED (100%)");
console.log("============================================================\n");
