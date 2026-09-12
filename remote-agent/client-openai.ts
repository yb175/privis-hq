// remote-agent/client-openai.ts
// OpenAI-compatible client for Cloud Browser Agent (chatgpt tier)

import type { SanitizedPackage } from "../types/index.js";
import { type AgentAction, parseAgentAction } from "./types.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "./packager.js";
import { guardModelOutput } from "./guard.js";
import { assertSanitizedPackage } from "./assert.js";

export { SYSTEM_PROMPT };

export interface OpenAIOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetchFn?: typeof fetch;
}

/**
 * Builds the user prompt summarizing the goal, browser state, and sanitized DOM elements.
 */
export function buildPrompt(pkg: SanitizedPackage): string {
  return buildUserPrompt(pkg);
}

/**
 * Executes a call to an OpenAI-compatible endpoint with the sanitized package.
 */
export async function queryOpenAI(
  pkg: SanitizedPackage,
  options?: OpenAIOptions
): Promise<AgentAction> {
  // Outbound boundary: no provider client may dispatch an unproven package,
  // even when called directly instead of through the router.
  assertSanitizedPackage(pkg);

  const apiKey = options?.apiKey?.trim();
  if (!apiKey) {
    return {
      type: "ask_human",
      reason: "no_api_key: OpenAI API key is missing. Please configure it in extension settings.",
    };
  }

  const baseUrl = (options?.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = options?.model || "gpt-4o-mini";
  const fetchClient = options?.fetchFn || (typeof fetch !== "undefined" ? fetch : null);

  if (!fetchClient) {
    throw new Error("No fetch implementation available for OpenAI client");
  }

  const userText = buildPrompt(pkg);
  const contentItems: Array<Record<string, unknown>> = [{ type: "text", text: userText }];

  // Include sanitized screenshot if present
  if (
    typeof pkg.sanitizedScreenshot === "string" &&
    pkg.sanitizedScreenshot.startsWith("data:image/")
  ) {
    contentItems.push({
      type: "image_url",
      image_url: {
        url: pkg.sanitizedScreenshot,
      },
    });
  }

  const payload = {
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: contentItems },
    ],
  };

  const response = await fetchClient(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`OpenAI API error (${response.status}): ${errBody || response.statusText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const rawContent = data.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error("Empty response content from OpenAI model");
  }

  // Parse and validate strictly against AgentAction schema and PII guard
  return parseAgentAction(rawContent);
}
