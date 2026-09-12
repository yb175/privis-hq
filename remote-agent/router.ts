// remote-agent/router.ts
// CBA-2 Model Router: Routes sanitized agent requests between chatgpt and Gemini

import type { SanitizedPackage } from "../types/index.js";
import { type AgentAction, PII_PATTERNS } from "./types.js";
import {
  type ModelSettings,
  loadModelSettings,
  normalizeModelSettings,
} from "../shared/settings.js";
import { queryOpenAI, type OpenAIOptions } from "./client-openai.js";
import { queryGemini, type GeminiOptions } from "./client-gemini.js";
import { guardAction } from "./guard.js";
import { assertSanitizedPackage } from "./assert.js";

// Re-exported for compatibility: the outbound boundary lives in assert.ts (a
// leaf module) so the provider clients can enforce it too, without an import
// cycle (router -> clients -> assert).
export { assertSanitizedPackage };

export interface RouterOptions {
  settings?: Partial<ModelSettings>;
  fetchFn?: typeof fetch;
}

/**
 * Verifies that a 'type' action's placeholder actually exists in the sanitized
 * context. Catches model-hallucinated tokens (e.g. "PAN_2" when only "PAN_1"
 * was sanitized) that pass the token-format regex but reference nothing real.
 */
function assertPlaceholderInContext(pkg: SanitizedPackage, action: AgentAction): void {
  if (action.type !== "type") return;
  const knownPlaceholders = new Set(
    pkg.sanitizedContext.elements.map((el) => el.text).filter(Boolean)
  );
  if (!knownPlaceholders.has(action.placeholder)) {
    throw new Error(
      `Refusing action: placeholder "${action.placeholder}" does not exist in sanitized context — model hallucination`
    );
  }
}

/**
 * Routes the sanitized package to the configured model brain ("chatgpt" OpenAI-compatible or "gemini").
 * Returns a validated AgentAction adhering to the CBA-1 schema.
 */
export async function routeAgentRequest(
  pkg: SanitizedPackage,
  options?: RouterOptions
): Promise<AgentAction> {
  // 1. Strict Privacy & Sanitization Boundary Check
  assertSanitizedPackage(pkg);

  // 2. Resolve settings
  let settings: ModelSettings;
  if (options?.settings) {
    settings = normalizeModelSettings(options.settings);
  } else {
    settings = await loadModelSettings();
  }

  const fetchFn = options?.fetchFn;

  // 3. Dispatch to selected model client and guard output
  try {
    let action: AgentAction;
    if (settings.model === "gemini") {
      const geminiOpts: GeminiOptions = {
        apiKey: settings.geminiApiKey,
        baseUrl: settings.geminiBaseUrl,
        model: settings.geminiModel,
        fetchFn,
      };
      action = await queryGemini(pkg, geminiOpts);
    } else {
      // Default: "chatgpt" (OpenAI-compatible)
      const openAiOpts: OpenAIOptions = {
        apiKey: settings.openaiApiKey,
        baseUrl: settings.openaiBaseUrl,
        model: settings.openaiModel,
        fetchFn,
      };
      action = await queryOpenAI(pkg, openAiOpts);
    }

    const guardRes = guardAction(action, { sanitizedPackage: pkg });
    if (!guardRes.ok) {
      return guardRes.fallbackAction;
    }
    return guardRes.action;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    // If an unhandled remote error occurs, return ask_human action so the agent loop doesn't crash
    return {
      type: "ask_human",
      reason: `Remote model error (${settings.model}): ${errorMsg}`,
    };
  }
}
