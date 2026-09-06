// remote-agent/types.ts
// CBA-1: AgentAction contract + session types for Cloud Browser Agent

export interface Target {
  css?: string;
  role?: string;
  name?: string;
  bbox?: [number, number, number, number];
}

export interface NavigateAction {
  type: "navigate";
  url: string;
}

export interface ClickAction {
  type: "click";
  target: Target;
}

export interface TypeAction {
  type: "type";
  target: Target;
  placeholder: string; // e.g. "PAN_1", "EMAIL_1"
}

export interface ScrollAction {
  type: "scroll";
  dy: number;
}

export interface DoneAction {
  type: "done";
  reason: string;
}

export interface AskHumanAction {
  type: "ask_human";
  reason: string;
}

export type AgentAction =
  | NavigateAction
  | ClickAction
  | TypeAction
  | ScrollAction
  | DoneAction
  | AskHumanAction;

export type AgentActionType = AgentAction["type"];

export type SessionStatus = "idle" | "running" | "waiting_human" | "done" | "error";

export interface SessionStep {
  step: number;
  url: string;
  action: AgentAction;
  result?: { ok: boolean; error?: string };
  timestamp: number;
}

export interface AgentSession {
  sessionId: string;
  tabId: number;
  goal: string;
  step: number;
  maxSteps: number;
  status: SessionStatus;
  history: SessionStep[];
  lastAction?: AgentAction;
  error?: string;
}

const PII_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "PAN", re: /^[A-Z]{5}[0-9]{4}[A-Z]$/i },
  { name: "AADHAAR", re: /^\d{4}[\s-]?\d{4}[\s-]?\d{4}$/ },
  { name: "EMAIL", re: /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/ },
  { name: "PHONE", re: /^(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}$/ },
];

/**
 * Validates a Target object.
 * Must be a non-null object with at least one locator or bbox field.
 */
export function isTarget(target: unknown): target is Target {
  if (typeof target !== "object" || target === null || Array.isArray(target)) {
    return false;
  }
  const t = target as Record<string, unknown>;
  const hasCss = typeof t.css === "string" && t.css.trim().length > 0;
  const hasRole = typeof t.role === "string" && t.role.trim().length > 0;
  const hasName = typeof t.name === "string" && t.name.trim().length > 0;
  const hasBbox =
    Array.isArray(t.bbox) &&
    t.bbox.length === 4 &&
    t.bbox.every((n) => typeof n === "number" && Number.isFinite(n));

  return hasCss || hasRole || hasName || hasBbox;
}

/**
 * Validates whether an unknown value conforms to the AgentAction schema.
 * Rejects raw values, invalid action types, or malformed targets.
 */
export function validateAgentAction(
  input: unknown
): { ok: true; action: AgentAction } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "Action must be a non-null object" };
  }

  const obj = input as Record<string, unknown>;

  if (typeof obj.type !== "string") {
    return { ok: false, error: "Missing or invalid 'type' property in action" };
  }

  switch (obj.type) {
    case "navigate": {
      if (typeof obj.url !== "string" || obj.url.trim().length === 0) {
        return { ok: false, error: "'navigate' action requires a non-empty 'url' string" };
      }
      return { ok: true, action: { type: "navigate", url: obj.url } };
    }

    case "click": {
      if (!isTarget(obj.target)) {
        return {
          ok: false,
          error: "'click' action requires a valid 'target' with css, role, name, or bbox",
        };
      }
      return { ok: true, action: { type: "click", target: obj.target } };
    }

    case "type": {
      if ("value" in obj) {
        return {
          ok: false,
          error: "'type' action must not contain 'value' — pass placeholder only (e.g. 'PAN_1')",
        };
      }
      if (!isTarget(obj.target)) {
        return {
          ok: false,
          error: "'type' action requires a valid 'target' with css, role, name, or bbox",
        };
      }
      if (typeof obj.placeholder !== "string" || obj.placeholder.trim().length === 0) {
        return { ok: false, error: "'type' action requires a non-empty 'placeholder' string" };
      }

      for (const { name, re } of PII_PATTERNS) {
        if (re.test(obj.placeholder.trim())) {
          return {
            ok: false,
            error: `Raw ${name} detected in placeholder: "${obj.placeholder}". Only placeholder tokens are allowed.`,
          };
        }
      }

      return {
        ok: true,
        action: {
          type: "type",
          target: obj.target,
          placeholder: obj.placeholder,
        },
      };
    }

    case "scroll": {
      if (typeof obj.dy !== "number" || !Number.isFinite(obj.dy)) {
        return { ok: false, error: "'scroll' action requires a finite number 'dy'" };
      }
      return { ok: true, action: { type: "scroll", dy: obj.dy } };
    }

    case "done": {
      if (typeof obj.reason !== "string") {
        return { ok: false, error: "'done' action requires a 'reason' string" };
      }
      return { ok: true, action: { type: "done", reason: obj.reason } };
    }

    case "ask_human": {
      if (typeof obj.reason !== "string") {
        return { ok: false, error: "'ask_human' action requires a 'reason' string" };
      }
      return { ok: true, action: { type: "ask_human", reason: obj.reason } };
    }

    default:
      return { ok: false, error: `Unknown action type: "${obj.type}"` };
  }
}

/**
 * Type guard for AgentAction.
 */
export function isAgentAction(input: unknown): input is AgentAction {
  return validateAgentAction(input).ok;
}

/**
 * Parses a JSON string or raw object into a validated AgentAction.
 * Throws a descriptive Error on validation failure or raw PII detection.
 */
export function parseAgentAction(input: unknown): AgentAction {
  let parsed = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input);
    } catch (err) {
      throw new Error(`Invalid JSON for AgentAction: ${(err as Error).message}`);
    }
  }

  const result = validateAgentAction(parsed);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.action;
}
