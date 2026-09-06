// remote-agent/client-gemini.ts
// Google Gemini API client for Cloud Browser Agent

import type { SanitizedPackage } from "../types/index.js";
import { type AgentAction, parseAgentAction } from "./types.js";
import { SYSTEM_PROMPT, buildPrompt } from "./client-openai.js";
import { DEFAULT_MODEL_SETTINGS } from "../extension/src/settings/models.js";

export interface GeminiOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetchFn?: typeof fetch;
}

/**
 * Extracts mimeType and raw base64 data from a data URL.
 */
function parseDataUrl(dataUrl: string): { mimeType: string; base64Data: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return null;
  return {
    mimeType: match[1],
    base64Data: match[2],
  };
}

/**
 * Executes a call to Google Gemini generateContent API with the sanitized package.
 */
export async function queryGemini(
  pkg: SanitizedPackage,
  options?: GeminiOptions
): Promise<AgentAction> {
  const apiKey = options?.apiKey?.trim();
  if (!apiKey) {
    return {
      type: "ask_human",
      reason: "no_api_key: Gemini API key is missing. Please configure it in extension settings.",
    };
  }

  const baseUrl = (
    options?.baseUrl || "https://generativelanguage.googleapis.com/v1beta"
  ).replace(/\/+$/, "");
  const model: string = options?.model || DEFAULT_MODEL_SETTINGS.geminiModel;
  const fetchClient = options?.fetchFn || (typeof fetch !== "undefined" ? fetch : null);

  if (!fetchClient) {
    throw new Error("No fetch implementation available for Gemini client");
  }

  const userText = buildPrompt(pkg);
  const parts: Array<Record<string, unknown>> = [{ text: userText }];

  // Include sanitized screenshot as inlineData if present
  if (typeof pkg.sanitizedScreenshot === "string") {
    const parsedImg = parseDataUrl(pkg.sanitizedScreenshot);
    if (parsedImg) {
      parts.push({
        inlineData: {
          mimeType: parsedImg.mimeType,
          data: parsedImg.base64Data,
        },
      });
    }
  }

  const payload = {
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
    },
  };

  const endpoint = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetchClient(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`Gemini API error (${response.status}): ${errBody || response.statusText}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawContent) {
    throw new Error("Empty response content from Gemini model");
  }

  // Parse and validate strictly against AgentAction schema and PII guard
  return parseAgentAction(rawContent);
}
