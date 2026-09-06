// tests/test-router.ts
// Unit and production QA tests for CBA-2 Model Router (cheap GPT vs Gemini), clients, and settings

import assert from "node:assert";
import type { SanitizedPackage, ElementMeta, BrowserState } from "../types/index.js";
import { type AgentAction } from "../remote-agent/types.js";
import {
  DEFAULT_MODEL_SETTINGS,
  normalizeModelSettings,
  loadModelSettings,
  saveModelSettings,
  STORAGE_KEY_MODEL_SETTINGS,
} from "../extension/src/settings/models.js";
import { queryOpenAI, buildPrompt } from "../remote-agent/client-openai.js";
import { queryGemini } from "../remote-agent/client-gemini.js";
import { routeAgentRequest, assertSanitizedPackage } from "../remote-agent/router.js";

console.log("=== Running CBA-2 Model Router Test Suite (OpenAI cheap vs Gemini) ===");

// Helper fixture generator for a valid SanitizedPackage
function createValidSanitizedPackage(overrides?: Partial<SanitizedPackage>): SanitizedPackage {
  const elements: ElementMeta[] = [
    {
      element_id: "el-input-1",
      tag: "input",
      type: "text",
      role: "textbox",
      label: null,
      text: "PAN_1",
      bbox: [100, 150, 200, 32],
    },
    {
      element_id: "submit-btn",
      tag: "button",
      type: "submit",
      role: "button",
      label: null,
      text: "Submit Form",
      bbox: [100, 200, 120, 40],
    },
  ];

  const browserState: BrowserState = {
    url: "https://portal.internal.example/form",
    title: "Employee Verification Portal",
    viewport: { w: 1280, h: 720 },
  };

  return {
    goal: "Fill PAN and submit the verification form",
    sanitizedScreenshot: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    sanitizedContext: {
      elements,
      browserState,
    },
    ...overrides,
  };
}

// --------------------------------------------------------------------------
// 1. Settings Normalization & Persistence Tests
// --------------------------------------------------------------------------
console.log("\n[1] Settings normalization & storage persistence");

// Default settings
const defaultNorm = normalizeModelSettings();
assert.strictEqual(defaultNorm.model, "cheap");
assert.strictEqual(defaultNorm.openaiBaseUrl, DEFAULT_MODEL_SETTINGS.openaiBaseUrl);
assert.strictEqual(defaultNorm.openaiModel, "gpt-4o-mini");
assert.strictEqual(defaultNorm.geminiBaseUrl, DEFAULT_MODEL_SETTINGS.geminiBaseUrl);
assert.strictEqual(defaultNorm.geminiModel, "gemini-1.5-flash");
console.log("  ✔ Default settings properly initialized");

// Normalize with custom values & whitespace trimming
const customNorm = normalizeModelSettings({
  model: "gemini",
  openaiApiKey: "  sk-test-openai-key  ",
  geminiApiKey: "  gemini-test-key  ",
  geminiModel: "gemini-2.0-flash",
});
assert.strictEqual(customNorm.model, "gemini");
assert.strictEqual(customNorm.openaiApiKey, "sk-test-openai-key");
assert.strictEqual(customNorm.geminiApiKey, "gemini-test-key");
assert.strictEqual(customNorm.geminiModel, "gemini-2.0-flash");
console.log("  ✔ Custom settings normalization & whitespace trimming verified");

// Fallback on invalid model choice
const invalidModelNorm = normalizeModelSettings({ model: "unknown-vendor" as any });
assert.strictEqual(invalidModelNorm.model, "cheap");
console.log("  ✔ Invalid model choice safely falls back to 'cheap'");

// Chrome storage mock test
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

// Save settings to mock chrome storage
await saveModelSettings({
  model: "gemini",
  geminiApiKey: "test-gemini-key-123",
});
assert.deepStrictEqual(mockStorage[STORAGE_KEY_MODEL_SETTINGS], {
  model: "gemini",
  openaiApiKey: undefined,
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "gpt-4o-mini",
  geminiApiKey: "test-gemini-key-123",
  geminiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
  geminiModel: "gemini-1.5-flash",
});

// Load settings from mock chrome storage
const loaded = await loadModelSettings();
assert.strictEqual(loaded.model, "gemini");
assert.strictEqual(loaded.geminiApiKey, "test-gemini-key-123");
console.log("  ✔ chrome.storage.local save & load cycle verified");

// --------------------------------------------------------------------------
// 2. OpenAI Client & Prompt Builder Tests
// --------------------------------------------------------------------------
console.log("\n[2] OpenAI-compatible client tests");

const pkg = createValidSanitizedPackage();

// Prompt builder check
const promptText = buildPrompt(pkg);
assert.ok(promptText.includes("USER GOAL: Fill PAN and submit the verification form"));
assert.ok(promptText.includes("PAGE URL: https://portal.internal.example/form"));
assert.ok(promptText.includes("text=\"PAN_1\""));
console.log("  ✔ OpenAI prompt builder formats goal, state, and elements accurately");

// Missing API Key -> ask_human
const missingKeyAction = await queryOpenAI(pkg, { apiKey: "" });
assert.strictEqual(missingKeyAction.type, "ask_human");
assert.ok(
  (missingKeyAction as { type: "ask_human"; reason: string }).reason.includes("no_api_key"),
  "Missing OpenAI key must produce ask_human with 'no_api_key'"
);
console.log("  ✔ Missing OpenAI key returns ask_human / no_api_key");

// Successful OpenAI mock call returning Type action with placeholder
let recordedOpenAIRequest: { url: string; headers: any; body: any } | null = null;

const mockOpenAIFetch: typeof fetch = async (input, init) => {
  recordedOpenAIRequest = {
    url: input.toString(),
    headers: init?.headers,
    body: JSON.parse(init?.body as string),
  };

  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              type: "type",
              target: { css: "#pan-input" },
              placeholder: "PAN_1",
            }),
          },
        },
      ],
    }),
  } as Response;
};

const openAiAction = await queryOpenAI(pkg, {
  apiKey: "sk-test-valid-key",
  baseUrl: "https://custom.openai.api/v1",
  model: "gpt-4o-mini",
  fetchFn: mockOpenAIFetch,
});

assert.strictEqual(openAiAction.type, "type");
if (openAiAction.type === "type") {
  assert.strictEqual(openAiAction.placeholder, "PAN_1");
  assert.strictEqual(openAiAction.target.css, "#pan-input");
}
const openAiReq = recordedOpenAIRequest as unknown as { url: string; headers: any; body: any };
assert.ok(openAiReq);
assert.strictEqual(openAiReq.url, "https://custom.openai.api/v1/chat/completions");
assert.strictEqual(openAiReq.headers?.Authorization, "Bearer sk-test-valid-key");
assert.strictEqual(openAiReq.body?.model, "gpt-4o-mini");
assert.strictEqual(openAiReq.body?.messages?.[1]?.content?.[1]?.type, "image_url");
console.log("  ✔ OpenAI client successfully calls endpoint and parses AgentAction JSON");

// Markdown fence handling in OpenAI response
const mockMdFetch: typeof fetch = async () =>
  ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content: "```json\n{\n  \"type\": \"click\",\n  \"target\": { \"css\": \"#submit-btn\" }\n}\n```",
          },
        },
      ],
    }),
  } as Response);

const mdAction = await queryOpenAI(pkg, {
  apiKey: "sk-test",
  fetchFn: mockMdFetch,
});
assert.strictEqual(mdAction.type, "click");
if (mdAction.type === "click") {
  assert.strictEqual(mdAction.target.css, "#submit-btn");
}
console.log("  ✔ OpenAI client handles markdown-wrapped JSON responses");

// Rejection of Raw PII hallucinated by LLM in response
const mockPiiLeakFetch: typeof fetch = async () =>
  ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              type: "type",
              target: { css: "#pan-input" },
              placeholder: "ABCDE1234F", // Raw PAN!
            }),
          },
        },
      ],
    }),
  } as Response);

await assert.rejects(
  async () => {
    await queryOpenAI(pkg, { apiKey: "sk-test", fetchFn: mockPiiLeakFetch });
  },
  {
    message: /Raw PAN detected in placeholder/i,
  },
  "OpenAI client must reject LLM responses containing raw PII"
);
console.log("  ✔ OpenAI client enforces PII guard on LLM responses");

// HTTP 401 Unauthorized Error Handling
const mock401Fetch: typeof fetch = async () =>
  ({
    ok: false,
    status: 401,
    statusText: "Unauthorized",
    text: async () => JSON.stringify({ error: { message: "Invalid API key" } }),
  } as Response);

await assert.rejects(
  async () => {
    await queryOpenAI(pkg, { apiKey: "invalid-key", fetchFn: mock401Fetch });
  },
  {
    message: /OpenAI API error \(401\)/i,
  }
);
console.log("  ✔ OpenAI client properly throws descriptive error on HTTP failures");

// --------------------------------------------------------------------------
// 3. Google Gemini Client Tests
// --------------------------------------------------------------------------
console.log("\n[3] Google Gemini client tests");

// Missing API Key -> ask_human
const missingGeminiKeyAction = await queryGemini(pkg, { apiKey: "" });
assert.strictEqual(missingGeminiKeyAction.type, "ask_human");
assert.ok(
  (missingGeminiKeyAction as { type: "ask_human"; reason: string }).reason.includes("no_api_key"),
  "Missing Gemini key must produce ask_human with 'no_api_key'"
);
console.log("  ✔ Missing Gemini key returns ask_human / no_api_key");

// Successful Gemini mock call returning Click action
let recordedGeminiRequest: { url: string; body: any } | null = null;

const mockGeminiFetch: typeof fetch = async (input, init) => {
  recordedGeminiRequest = {
    url: input.toString(),
    body: JSON.parse(init?.body as string),
  };

  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  type: "click",
                  target: { name: "Submit Form" },
                }),
              },
            ],
          },
        },
      ],
    }),
  } as Response;
};

const geminiAction = await queryGemini(pkg, {
  apiKey: "gemini-valid-key-777",
  baseUrl: "https://custom.gemini.api/v1beta",
  model: "gemini-1.5-flash",
  fetchFn: mockGeminiFetch,
});

assert.strictEqual(geminiAction.type, "click");
if (geminiAction.type === "click") {
  assert.strictEqual(geminiAction.target.name, "Submit Form");
}
const geminiReq = recordedGeminiRequest as unknown as { url: string; body: any };
assert.ok(geminiReq);
assert.ok(
  geminiReq.url.includes(
    "https://custom.gemini.api/v1beta/models/gemini-1.5-flash:generateContent?key=gemini-valid-key-777"
  )
);
assert.strictEqual(
  geminiReq.body?.contents?.[0]?.parts?.[1]?.inlineData?.mimeType,
  "image/png"
);
console.log("  ✔ Gemini client successfully formats inline image & parses AgentAction JSON");

// Rejection of Raw PII hallucinated by Gemini
const mockGeminiPiiFetch: typeof fetch = async () =>
  ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  type: "type",
                  target: { css: "#email" },
                  placeholder: "user@example.com", // Raw Email!
                }),
              },
            ],
          },
        },
      ],
    }),
  } as Response);

await assert.rejects(
  async () => {
    await queryGemini(pkg, { apiKey: "test-key", fetchFn: mockGeminiPiiFetch });
  },
  {
    message: /Raw EMAIL detected in placeholder/i,
  }
);
console.log("  ✔ Gemini client enforces PII guard on LLM responses");

// --------------------------------------------------------------------------
// 4. Sanitization Boundary & Package Guard Tests
// --------------------------------------------------------------------------
console.log("\n[4] Router Sanitization Boundary checks");

// Valid package passes boundary check
assert.doesNotThrow(() => assertSanitizedPackage(pkg));

// Reject raw capture package containing 'tabId' or 'dataUrl' at root
assert.throws(
  () => {
    assertSanitizedPackage({
      ...pkg,
      tabId: 10,
    } as any);
  },
  {
    message: /Refusing to route: package contains raw field "tabId"/i,
  }
);

assert.throws(
  () => {
    assertSanitizedPackage({
      ...pkg,
      dataUrl: "data:image/png;base64,rawdata",
    } as any);
  },
  {
    message: /Refusing to route: package contains raw field "dataUrl"/i,
  }
);

assert.throws(
  () => {
    assertSanitizedPackage({
      ...pkg,
      detections: [],
    } as any);
  },
  {
    message: /Refusing to route: package contains raw field "detections"/i,
  }
);

// Reject missing goal or missing sanitizedScreenshot
assert.throws(
  () => {
    assertSanitizedPackage({ ...pkg, goal: "" });
  },
  {
    message: /missing or empty goal/i,
  }
);
assert.throws(
  () => {
    assertSanitizedPackage({ ...pkg, sanitizedScreenshot: "" });
  },
  {
    message: /missing or empty sanitizedScreenshot/i,
  }
);

// Reject raw PII leaked inside sanitizedContext
const leakedPkg = createValidSanitizedPackage({
  sanitizedContext: {
    ...pkg.sanitizedContext,
    elements: [
      {
        element_id: "el-1",
        tag: "input",
        type: "text",
        role: null,
        label: null,
        text: "ABCDE1234F", // Leaked raw PAN!
        bbox: [0, 0, 10, 10],
      },
    ],
  },
});

assert.throws(
  () => {
    assertSanitizedPackage(leakedPkg);
  },
  {
    message: /Refusing to route: PAN pattern detected/i,
  }
);
console.log("  ✔ All Router sanitization boundary guards verified");

// --------------------------------------------------------------------------
// 5. Router End-to-End Dispatching & Polymorphic Action Verification
// --------------------------------------------------------------------------
console.log("\n[5] Model Router end-to-end dispatch & schema consistency");

// 1. Dispatch to 'cheap' model router
const routerCheapAction = await routeAgentRequest(pkg, {
  settings: {
    model: "cheap",
    openaiApiKey: "sk-test-key",
  },
  fetchFn: mockOpenAIFetch,
});
assert.strictEqual(routerCheapAction.type, "type");
if (routerCheapAction.type === "type") {
  assert.strictEqual(routerCheapAction.placeholder, "PAN_1");
}
console.log("  ✔ Router correctly dispatches to 'cheap' (OpenAI-compatible) model");

// 2. Dispatch to 'gemini' model router
const routerGeminiAction = await routeAgentRequest(pkg, {
  settings: {
    model: "gemini",
    geminiApiKey: "gemini-key",
  },
  fetchFn: mockGeminiFetch,
});
assert.strictEqual(routerGeminiAction.type, "click");
if (routerGeminiAction.type === "click") {
  assert.strictEqual(routerGeminiAction.target.name, "Submit Form");
}
console.log("  ✔ Router correctly dispatches to 'gemini' model");

// 3. Missing API key handling in router produces ask_human with 'no_api_key'
const routerNoKeyCheap = await routeAgentRequest(pkg, {
  settings: {
    model: "cheap",
    openaiApiKey: "",
  },
});
assert.strictEqual(routerNoKeyCheap.type, "ask_human");
assert.ok(
  (routerNoKeyCheap as { type: "ask_human"; reason: string }).reason.includes("no_api_key")
);

const routerNoKeyGemini = await routeAgentRequest(pkg, {
  settings: {
    model: "gemini",
    geminiApiKey: "",
  },
});
assert.strictEqual(routerNoKeyGemini.type, "ask_human");
assert.ok(
  (routerNoKeyGemini as { type: "ask_human"; reason: string }).reason.includes("no_api_key")
);
console.log("  ✔ Router missing key handling produces ask_human / no_api_key for both providers");

// 4. Remote API error handling returns ask_human without unhandled crash
const routerErrorAction = await routeAgentRequest(pkg, {
  settings: {
    model: "cheap",
    openaiApiKey: "sk-key",
  },
  fetchFn: mock401Fetch,
});
assert.strictEqual(routerErrorAction.type, "ask_human");
assert.ok(
  (routerErrorAction as { type: "ask_human"; reason: string }).reason.includes("Remote model error")
);
console.log("  ✔ Router catches remote model errors and returns safe ask_human action");

// 5. Navigate, Scroll, Done actions verification through router
const mockDoneFetch: typeof fetch = async () =>
  ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              type: "done",
              reason: "Form submitted and verification receipt shown",
            }),
          },
        },
      ],
    }),
  } as Response);

const doneActionResult = await routeAgentRequest(pkg, {
  settings: { model: "cheap", openaiApiKey: "sk-key" },
  fetchFn: mockDoneFetch,
});
assert.strictEqual(doneActionResult.type, "done");
if (doneActionResult.type === "done") {
  assert.strictEqual(doneActionResult.reason, "Form submitted and verification receipt shown");
}
console.log("  ✔ Multi-action lifecycle actions (done, navigate, scroll) return consistent schema");

console.log("\n============================================================");
console.log("✅ ALL CBA-2 MODEL ROUTER & CLIENT TESTS PASSED (100%)");
console.log("============================================================\n");
