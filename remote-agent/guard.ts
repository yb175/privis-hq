// remote-agent/guard.ts
// CBA-3 Guard: Validates model outputs, rejects raw PII / illegal actions,
// and fails closed to ask_human before Local Executor runs.

import type { SanitizedPackage, SanitizedContext } from "../types/index.js";
import {
  type AgentAction,
  type AskHumanAction,
  type Target,
  PII_PATTERNS,
  PLACEHOLDER_TOKEN_REGEX,
  isTarget,
} from "./types.js";

export interface GuardOptions {
  allowlist?: Set<string> | string[];
  sanitizedPackage?: SanitizedPackage;
  sanitizedContext?: SanitizedContext;
}

export interface GuardSuccess {
  ok: true;
  action: AgentAction;
}

export interface GuardFailure {
  ok: false;
  error: string;
  fallbackAction: AskHumanAction;
}

export type GuardResult = GuardSuccess | GuardFailure;

const ALLOWED_NAVIGATE_PROTOCOLS = ["http:", "https:"];
const FORBIDDEN_RAW_KEYS = ["value", "text", "input", "val", "content", "password", "secret"];

/**
 * Replaces PII pattern matches with [REDACTED_<NAME>] markers so a string is
 * safe to embed in a fallback reason (which flows back into the next prompt
 * via lastStepResult) or any operator-facing surface. Category names survive;
 * raw values do not.
 */
export function redactPii(text: string): string {
  let out = text;
  for (const { name, re } of PII_PATTERNS) {
    const globalRe = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    out = out.replace(globalRe, `[REDACTED_${name}]`);
  }
  return out;
}

/**
 * Extracts all valid placeholder tokens present in a sanitized context.
 */
export function getPlaceholderAllowlistFromContext(
  context?: SanitizedContext | null
): Set<string> {
  const allowlist = new Set<string>();
  if (!context || !Array.isArray(context.elements)) {
    return allowlist;
  }

  for (const el of context.elements) {
    if (typeof el.text === "string") {
      const trimmed = el.text.trim();
      if (PLACEHOLDER_TOKEN_REGEX.test(trimmed)) {
        allowlist.add(trimmed);
      }
    }
  }
  return allowlist;
}

/**
 * Unwraps markdown code fences or single-action wrappers.
 * Rejects multi-action arrays immediately.
 */
function normalizeRawOutput(input: unknown): unknown {
  let val = input;
  if (typeof val === "string") {
    let clean = val.trim();
    if (clean.startsWith("```")) {
      clean = clean.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    }
    try {
      val = JSON.parse(clean);
    } catch (err) {
      throw new Error(`Invalid JSON output from model: ${(err as Error).message}`);
    }
  }

  if (Array.isArray(val)) {
    throw new Error(
      `Multiple actions detected (${val.length}) — model must return exactly one action per step`
    );
  }

  if (typeof val === "object" && val !== null) {
    const record = val as Record<string, unknown>;
    if (Array.isArray(record.actions)) {
      throw new Error(
        `Multiple actions detected in 'actions' array (${record.actions.length}) — exactly one action allowed`
      );
    }
    if ("action" in record && typeof record.action === "object" && record.action !== null) {
      if (Array.isArray(record.action)) {
        throw new Error("Multiple actions detected in 'action' wrapper — exactly one action allowed");
      }
      val = record.action;
    } else if (
      "agent_action" in record &&
      typeof record.agent_action === "object" &&
      record.agent_action !== null
    ) {
      if (Array.isArray(record.agent_action)) {
        throw new Error(
          "Multiple actions detected in 'agent_action' wrapper — exactly one action allowed"
        );
      }
      val = record.agent_action;
    }
  }

  return val;
}

/**
 * Resolves the active placeholder allowlist from options.
 */
function resolveAllowlist(options?: GuardOptions): Set<string> | null {
  if (!options) return null;
  if (options.allowlist) {
    return options.allowlist instanceof Set
      ? options.allowlist
      : new Set(options.allowlist);
  }
  if (options.sanitizedPackage?.sanitizedContext) {
    return getPlaceholderAllowlistFromContext(options.sanitizedPackage.sanitizedContext);
  }
  if (options.sanitizedContext) {
    return getPlaceholderAllowlistFromContext(options.sanitizedContext);
  }
  return null;
}

/**
 * Scans an arbitrary string or object for raw PII patterns.
 */
export function findPiiInValue(val: unknown): string | null {
  if (typeof val === "string") {
    for (const { name, re } of PII_PATTERNS) {
      if (re.test(val)) {
        return name;
      }
    }
  } else if (typeof val === "object" && val !== null) {
    for (const v of Object.values(val)) {
      const match = findPiiInValue(v);
      if (match) return match;
    }
  }
  return null;
}

/**
 * Validates candidate object against Guard rules and schema.
 */
function validateActionWithGuard(
  candidate: unknown,
  allowlist: Set<string> | null,
  goalText = "",
  pkg?: SanitizedPackage
): { ok: true; action: AgentAction } | { ok: false; error: string } {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return { ok: false, error: "Action must be a non-null JSON object" };
  }

  const obj = candidate as Record<string, unknown>;

  if (typeof obj.type !== "string" || obj.type.trim().length === 0) {
    return { ok: false, error: "Missing or invalid 'type' property in action" };
  }

  // Check for raw values accidentally included in top-level action object
  for (const rawKey of FORBIDDEN_RAW_KEYS) {
    if (rawKey in obj) {
      return {
        ok: false,
        error: `Forbidden raw field '${rawKey}' present in action — must never send raw data`,
      };
    }
  }

  switch (obj.type) {
    case "navigate": {
      if (typeof obj.url !== "string" || obj.url.trim().length === 0) {
        return { ok: false, error: "'navigate' action requires a non-empty 'url' string" };
      }
      const rawUrl = obj.url.trim();
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(rawUrl);
      } catch {
        return { ok: false, error: `Invalid URL format in navigate action: "${rawUrl}"` };
      }

      if (!ALLOWED_NAVIGATE_PROTOCOLS.includes(parsedUrl.protocol)) {
        return {
          ok: false,
          error: `Disallowed URL protocol "${parsedUrl.protocol}" in navigate action — only http: and https: allowed`,
        };
      }

      const piiMatch = findPiiInValue(rawUrl);
      if (piiMatch) {
        return {
          ok: false,
          error: `Raw ${piiMatch} detected in navigate URL: "${rawUrl}"`,
        };
      }

      return { ok: true, action: { type: "navigate", url: rawUrl } };
    }

    case "click": {
      if (!isTarget(obj.target)) {
        return {
          ok: false,
          error: "'click' action requires a valid 'target' with css, role, name, or bbox",
        };
      }
      const piiMatch = findPiiInValue(obj.target);
      if (piiMatch) {
        return {
          ok: false,
          error: `Raw ${piiMatch} detected in click target`,
        };
      }
      return { ok: true, action: { type: "click", target: obj.target as Target } };
    }

    case "type": {
      if (!isTarget(obj.target)) {
        return {
          ok: false,
          error: "'type' action requires a valid 'target' with css, role, name, or bbox",
        };
      }

      if (typeof obj.placeholder !== "string" || obj.placeholder.trim().length === 0) {
        return { ok: false, error: "'type' action requires a non-empty 'placeholder' string" };
      }

      const trimmedPlaceholder = obj.placeholder.trim();

      // 1. Scan target locators for raw PII (same rule as the click branch —
      // a model echoing page data back in css/name must never pass)
      const targetPii = findPiiInValue(obj.target);
      if (targetPii) {
        return {
          ok: false,
          error: `Raw ${targetPii} detected in type target`,
        };
      }

      // 2. Scan for raw PII in placeholder
      const piiMatch = findPiiInValue(trimmedPlaceholder);
      if (piiMatch) {
        return {
          ok: false,
          error: `Raw ${piiMatch} detected in placeholder: "${obj.placeholder}". Only placeholder tokens allowed.`,
        };
      }

      // 3. Placeholder must be a category token (PAN_1) — or an exact phrase
      //    from the user's own goal, which the device re-verifies before
      //    typing (search boxes are not PII fields). GuardOptions carries the
      //    goal via sanitizedPackage.
      const isToken = PLACEHOLDER_TOKEN_REGEX.test(trimmedPlaceholder);
      if (!isToken) {
        const goal = goalText;
        const inGoal = goal.toLowerCase().includes(trimmedPlaceholder.toLowerCase());
        if (!inGoal) {
          return {
            ok: false,
            error: `Invalid placeholder format: "${obj.placeholder}". Must be a CATEGORY_N token from the allowlist or an exact phrase from the USER GOAL.`,
          };
        }

        // Secret field check: goal phrases may NOT be typed into password/OTP/secret fields
        if (pkg?.sanitizedContext?.elements) {
          const elements = pkg.sanitizedContext.elements;
          const targetObj = obj.target as Target;
          const matchedEl = elements.find((e) => {
            if (targetObj.css) {
              if (targetObj.css === e.element_id || targetObj.css === `#${e.element_id}` || targetObj.css.includes(e.element_id)) return true;
            }
            if (targetObj.name && e.label && e.label.toLowerCase().includes(targetObj.name.toLowerCase())) return true;
            return false;
          });
          if (matchedEl) {
            const isSecret = matchedEl.type === "password" || (matchedEl.label && /password|otp|pin|cvv|secret|token/i.test(matchedEl.label));
            if (isSecret) {
              return {
                ok: false,
                error: `Typing goal phrase into secret/password field is forbidden. Escalate to ask_human.`,
              };
            }
          }
        }
      }

      // 4. Enforce placeholder allowlist if available (tokens only — literal
      //    goal phrases are not in the placeholder map by definition)
      if (isToken && allowlist && !allowlist.has(trimmedPlaceholder)) {
        return {
          ok: false,
          error: `Placeholder "${trimmedPlaceholder}" does not exist in sanitized context allowlist [${Array.from(
            allowlist
          ).join(", ")}] — model hallucination`,
        };
      }

      return {
        ok: true,
        action: {
          type: "type",
          target: obj.target as Target,
          placeholder: trimmedPlaceholder,
        },
      };
    }

    case "scroll": {
      if (typeof obj.dy !== "number" || !Number.isFinite(obj.dy)) {
        return { ok: false, error: "'scroll' action requires a finite number 'dy'" };
      }
      return { ok: true, action: { type: "scroll", dy: obj.dy } };
    }

    case "search": {
      if (typeof obj.query !== "string" || obj.query.trim().length === 0) {
        return {
          ok: false,
          error: "'search' action requires a non-empty 'query' string",
        };
      }
      const trimmedQuery = obj.query.trim();
      if (trimmedQuery.length > 200) {
        return { ok: false, error: "'search' query exceeds 200 characters" };
      }
      // The query leaves this device for a third party (SerpAPI) — it must be
      // as PII-clean as anything else crossing the wire.
      const piiMatch = findPiiInValue(trimmedQuery);
      if (piiMatch) {
        return {
          ok: false,
          error: `Raw ${piiMatch} detected in search query — search terms must be PII-free`,
        };
      }
      // Prohibit personal identity/account queries
      if (/\b(?:my\s+account|my\s+password|user\s+name|ssn|dob|card|address|phone|email|pan|aadhaar)\b/i.test(trimmedQuery)) {
        return {
          ok: false,
          error: "Search query contains sensitive personal keywords — search queries must be destination-only or generic",
        };
      }
      return { ok: true, action: { type: "search", query: trimmedQuery } };
    }

    case "done": {
      if (typeof obj.reason !== "string" || obj.reason.trim().length === 0) {
        return { ok: false, error: "'done' action requires a non-empty 'reason' string" };
      }
      const piiMatch = findPiiInValue(obj.reason);
      if (piiMatch) {
        return {
          ok: false,
          error: `Raw ${piiMatch} detected in done reason: "${obj.reason}"`,
        };
      }
      return { ok: true, action: { type: "done", reason: obj.reason.trim() } };
    }

    case "ask_human": {
      if (typeof obj.reason !== "string" || obj.reason.trim().length === 0) {
        return {
          ok: false,
          error: "'ask_human' action requires a non-empty 'reason' string",
        };
      }
      const piiMatch = findPiiInValue(obj.reason);
      if (piiMatch) {
        return {
          ok: false,
          error: `Raw ${piiMatch} detected in ask_human reason: "${obj.reason}"`,
        };
      }
      return { ok: true, action: { type: "ask_human", reason: obj.reason.trim() } };
    }

    default:
      return { ok: false, error: `Unknown action type: "${obj.type}"` };
  }
}

/**
 * Guards raw model output (string, JSON, object).
 * If validation fails, returns ok: false with fallbackAction: ask_human.
 */
export function guardModelOutput(
  rawOutput: unknown,
  options?: GuardOptions
): GuardResult {
  const allowlist = resolveAllowlist(options);

  try {
    const normalized = normalizeRawOutput(rawOutput);
    const result = validateActionWithGuard(
      normalized,
      allowlist,
      options?.sanitizedPackage?.goal ?? "",
      options?.sanitizedPackage
    );
    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
        // Redact: the fallback reason flows back into the next prompt via
        // lastStepResult — it must never carry the raw offending value.
        fallbackAction: {
          type: "ask_human",
          reason: redactPii(`Guard rejected model action: ${result.error}`),
        },
      };
    }
    return { ok: true, action: result.action };
  } catch (err) {
    const msg = (err as Error).message || String(err);
    return {
      ok: false,
      error: msg,
      fallbackAction: {
        type: "ask_human",
        reason: redactPii(`Guard rejected model output: ${msg}`),
      },
    };
  }
}

/**
 * Guards an already-parsed AgentAction against allowlist, PII leaks, and schema constraints.
 */
export function guardAction(
  action: AgentAction,
  options?: GuardOptions
): GuardResult {
  const allowlist = resolveAllowlist(options);
  const result = validateActionWithGuard(
    action,
    allowlist,
    options?.sanitizedPackage?.goal ?? "",
    options?.sanitizedPackage
  );
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      fallbackAction: {
        type: "ask_human",
        reason: redactPii(`Guard rejected action: ${result.error}`),
      },
    };
  }
  return { ok: true, action: result.action };
}
