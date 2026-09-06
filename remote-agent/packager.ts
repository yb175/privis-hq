// remote-agent/packager.ts
// CBA-3 Packager: Assembles model prompt from sanitized context,
// enforces placeholder isolation, attaches last step result, and exports allowlist.

import type { SanitizedPackage, SanitizedContext } from "../types/index.js";
import type { AgentAction } from "./types.js";
import { assertSanitizedPackage } from "./router.js";
import { getPlaceholderAllowlistFromContext } from "./guard.js";

export interface LastStepResult {
  action?: AgentAction;
  result?: { ok: boolean; error?: string };
}

export interface PackagerInput {
  goal: string;
  sanitizedContext: SanitizedContext;
  sanitizedScreenshot?: string;
  lastStepResult?: LastStepResult;
  redacted?: true;
}

export interface PackagedPrompt {
  systemPrompt: string;
  userPrompt: string;
  allowlist: Set<string>;
  screenshot?: string;
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
 * Returns the system prompt text for PRIVIS Remote Agent.
 */
export function buildSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

/**
 * Extracts all valid placeholder tokens present in the sanitized context.
 */
export function extractPlaceholderAllowlist(context: SanitizedContext): Set<string> {
  return getPlaceholderAllowlistFromContext(context);
}

/**
 * Formats the last step action & result into a human-readable summary line for the model.
 */
function formatLastStepResult(lastStep?: LastStepResult): string | null {
  if (!lastStep || (!lastStep.action && !lastStep.result)) {
    return null;
  }

  const parts: string[] = [];
  if (lastStep.action) {
    parts.push(`Action: ${JSON.stringify(lastStep.action)}`);
  }
  if (lastStep.result) {
    if (lastStep.result.ok) {
      parts.push("Result: OK");
    } else {
      parts.push(`Result: FAILED (${lastStep.result.error || "unknown error"})`);
    }
  }

  return parts.length > 0 ? parts.join(" -> ") : null;
}

/**
 * Builds the user prompt summarizing goal, browser state, last step result,
 * placeholder allowlist, and sanitized DOM elements.
 */
export function buildUserPrompt(
  pkg: PackagerInput | SanitizedPackage,
  lastStepResult?: LastStepResult
): string {
  const effectiveLastStep =
    lastStepResult || ("lastStepResult" in pkg ? pkg.lastStepResult : undefined);

  const elementsSummary = (pkg.sanitizedContext.elements || [])
    .map((el, idx) => {
      const parts = [`[${idx}] <${el.tag}`];
      if (el.element_id) parts.push(`id="${el.element_id}"`);
      if (el.type) parts.push(`type="${el.type}"`);
      if (el.role) parts.push(`role="${el.role}"`);
      // `label` is intentionally omitted: the sanitizer only swaps `text`, so a
      // label can still carry raw page/user data (same boundary the extension
      // service-worker applies before dispatching to the remote agent).
      parts.push(`>`);
      if (el.text) parts.push(`text="${el.text}"`);
      if (el.bbox) parts.push(`bbox=[${el.bbox.join(",")}]`);
      return parts.join(" ");
    })
    .join("\n");

  const allowlist = extractPlaceholderAllowlist(pkg.sanitizedContext);
  const allowlistSummary =
    allowlist.size > 0 ? Array.from(allowlist).join(", ") : "(none)";

  const lines: string[] = [
    `USER GOAL: ${pkg.goal}`,
    `PAGE URL: ${pkg.sanitizedContext.browserState.url}`,
    `PAGE TITLE: ${pkg.sanitizedContext.browserState.title}`,
    `VIEWPORT: ${pkg.sanitizedContext.browserState.viewport.w}x${pkg.sanitizedContext.browserState.viewport.h}`,
  ];

  const formattedLastStep = formatLastStepResult(effectiveLastStep);
  if (formattedLastStep) {
    lines.push(`LAST STEP RESULT: ${formattedLastStep}`);
  }

  lines.push(`AVAILABLE PLACEHOLDERS: [${allowlistSummary}]`);
  lines.push(`\nSANITIZED PAGE ELEMENTS:`);
  lines.push(elementsSummary || "(no interactive elements detected)");
  lines.push(
    `\nDetermine the single next AgentAction to take towards the goal. Output raw JSON only.`
  );

  return lines.join("\n");
}

/**
 * Validates the SanitizedPackage boundary and packages the prompts, placeholder allowlist,
 * and optional screenshot ready for the LLM client.
 */
export function packagePrompt(
  pkg: SanitizedPackage | (PackagerInput & { redacted: true; sanitizedScreenshot: string }),
  options?: { lastStepResult?: LastStepResult }
): PackagedPrompt {
  // Validate sanitization boundary
  assertSanitizedPackage(pkg as SanitizedPackage);

  const effectiveLastStep =
    options?.lastStepResult ||
    ("lastStepResult" in pkg ? (pkg as PackagerInput).lastStepResult : undefined);
  const allowlist = extractPlaceholderAllowlist(pkg.sanitizedContext);
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(pkg, effectiveLastStep);

  return {
    systemPrompt,
    userPrompt,
    allowlist,
    screenshot: pkg.sanitizedScreenshot,
  };
}
