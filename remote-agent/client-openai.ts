// remote-agent/client-openai.ts
// OpenAI-compatible client for Cloud Browser Agent (cheap tier)

import type { SanitizedPackage } from "../types/index.js";
import { type AgentAction, parseAgentAction } from "./types.js";

export interface OpenAIOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetchFn?: typeof fetch;
}

export const SYSTEM_PROMPT = `You are PRIVIS Remote Browser Agent — a lightweight, privacy-preserving web agent.
Your objective is to help the user achieve their goal by choosing the next browser action based on the sanitized page context and screenshot.

STRICT RULES:
1. You must respond with ONLY a single valid JSON object matching the AgentAction schema. No markdown formatting, no conversational text, no explanations outside JSON.
2. Available action formats:
   - {"type": "navigate", "url": "https://..."}
   - {"type": "click", "target": {"css": "#id", "role": "button", "name": "Submit", "bbox": [x, y, w, h]}}
   - {"type": "type", "target": {"css": "#input"}, "placeholder": "PAN_1"}
   - {"type": "scroll", "dy": 250}
   - {"type": "done", "reason": "Goal achieved successfully"}
   - {"type": "ask_human", "reason": "Two-factor code required / clarification needed"}
3. CRITICAL PRIVACY RULE: For "type" actions, you must ONLY supply the privacy placeholder token (e.g. "PAN_1", "EMAIL_1", "AMOUNT_1", "AADHAAR_1") present in the sanitized elements. Never attempt to guess, invent, or output raw sensitive data.
4. Target objects must contain at least one valid selector field ("css", "role", "name", or "bbox").`;

/**
 * Builds the user prompt summarizing the goal, browser state, and sanitized DOM elements.
 */
export function buildPrompt(pkg: SanitizedPackage): string {
  const elementsSummary = pkg.sanitizedContext.elements
    .map((el, idx) => {
      const parts = [`[${idx}] <${el.tag}`];
      if (el.element_id) parts.push(`id="${el.element_id}"`);
      if (el.type) parts.push(`type="${el.type}"`);
      if (el.role) parts.push(`role="${el.role}"`);
      if (el.label) parts.push(`label="${el.label}"`);
      parts.push(`>`);
      if (el.text) parts.push(`text="${el.text}"`);
      if (el.bbox) parts.push(`bbox=[${el.bbox.join(",")}]`);
      return parts.join(" ");
    })
    .join("\n");

  return [
    `USER GOAL: ${pkg.goal}`,
    `PAGE URL: ${pkg.sanitizedContext.browserState.url}`,
    `PAGE TITLE: ${pkg.sanitizedContext.browserState.title}`,
    `VIEWPORT: ${pkg.sanitizedContext.browserState.viewport.w}x${pkg.sanitizedContext.browserState.viewport.h}`,
    `\nSANITIZED PAGE ELEMENTS:`,
    elementsSummary || "(no interactive elements detected)",
    `\nDetermine the single next AgentAction to take towards the goal. Output raw JSON only.`,
  ].join("\n");
}

/**
 * Executes a call to an OpenAI-compatible endpoint with the sanitized package.
 */
export async function queryOpenAI(
  pkg: SanitizedPackage,
  options?: OpenAIOptions
): Promise<AgentAction> {
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
