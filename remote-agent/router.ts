// remote-agent/router.ts
// CBA-2 Model Router: Routes sanitized agent requests between cheap GPT and Gemini

import type { SanitizedPackage } from "../types/index.js";
import { type AgentAction, PII_PATTERNS } from "./types.js";
import {
  type ModelSettings,
  loadModelSettings,
  normalizeModelSettings,
} from "../extension/src/settings/models.js";
import { queryOpenAI, type OpenAIOptions } from "./client-openai.js";
import { queryGemini, type GeminiOptions } from "./client-gemini.js";

export interface RouterOptions {
  settings?: Partial<ModelSettings>;
  fetchFn?: typeof fetch;
}

/**
 * Validates that the package is properly sanitized before transmitting over the network.
 * Throws if raw data, missing fields, or unredacted PII patterns are found.
 */
export function assertSanitizedPackage(pkg: SanitizedPackage): void {
  if (!pkg || typeof pkg !== "object") {
    throw new Error("Invalid package: expected a non-null object");
  }

  const raw = pkg as unknown as Record<string, unknown>;
  for (const rawKey of ["tabId", "dataUrl", "detections"]) {
    if (rawKey in raw) {
      throw new Error(
        `Refusing to route: package contains raw field "${rawKey}" — run the Sanitizer first`
      );
    }
  }

  if (typeof pkg.goal !== "string" || pkg.goal.trim().length === 0) {
    throw new Error("Refusing to route: missing or empty goal");
  }

  if (typeof pkg.sanitizedScreenshot !== "string" || pkg.sanitizedScreenshot.trim().length === 0) {
    throw new Error("Refusing to route: missing or empty sanitizedScreenshot");
  }

  if (!pkg.sanitizedContext || !Array.isArray(pkg.sanitizedContext.elements)) {
    throw new Error("Refusing to route: missing sanitizedContext elements array");
  }

  if (!pkg.sanitizedContext.browserState) {
    throw new Error("Refusing to route: missing browserState in sanitizedContext");
  }

  // Scan full serialized payload to ensure no raw PII leaks across the wire
  const serialized = JSON.stringify({
    goal: pkg.goal,
    ...pkg.sanitizedContext,
  });

  for (const { name, re } of PII_PATTERNS) {
    if (re.test(serialized)) {
      throw new Error(
        `Refusing to route: ${name} pattern detected in sanitized package — Sanitizer leaked`
      );
    }
  }
}

/**
 * Routes the sanitized package to the configured model brain ("cheap" OpenAI-compatible or "gemini").
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

  // 3. Dispatch to selected model client
  try {
    if (settings.model === "gemini") {
      const geminiOpts: GeminiOptions = {
        apiKey: settings.geminiApiKey,
        baseUrl: settings.geminiBaseUrl,
        model: settings.geminiModel,
        fetchFn,
      };
      return await queryGemini(pkg, geminiOpts);
    } else {
      // Default: "cheap" (OpenAI-compatible)
      const openAiOpts: OpenAIOptions = {
        apiKey: settings.openaiApiKey,
        baseUrl: settings.openaiBaseUrl,
        model: settings.openaiModel,
        fetchFn,
      };
      return await queryOpenAI(pkg, openAiOpts);
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    // If an unhandled remote error occurs, return ask_human action so the agent loop doesn't crash
    return {
      type: "ask_human",
      reason: `Remote model error (${settings.model}): ${errorMsg}`,
    };
  }
}
