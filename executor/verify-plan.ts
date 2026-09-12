// executor/verify-plan.ts
// Structured Plan Schema Validation and Semantic Security Verification.
//
// PROVENANCE: ported from approved reference PravAl2028/SIH26171,
// extension/src/worker/verify-plan.ts (author-granted permission).
//
// Ensures no planner output executes directly. Verifies schema integrity,
// checks for hallucinated targets, label echo, raw PII leakage, and smeared tokens.

import type { Action, ElementMeta, SanitizedPackage } from "../types/index.js";
import { PII_PATTERNS } from "../remote-agent/types.js";

export interface PlanViolation {
  code:
    | "INVALID_SCHEMA"
    | "UNKNOWN_ACTION_TYPE"
    | "MALFORMED_TARGET"
    | "TARGET_NOT_IN_CONTEXT"
    | "LABEL_ECHO"
    | "RAW_PII_LEAK"
    | "HALLUCINATED_PLACEHOLDER"
    | "SMEARED_VALUE"
    | "UNSAFE_ACTION";
  message: string;
  actionIndex?: number;
  detail?: string;
}

export interface VerificationReport {
  ok: boolean;
  violations: PlanViolation[];
  actions: Action[];
}

const ALLOWED_ACTION_TYPES = new Set(["click", "type", "select", "scroll", "navigate", "submit", "wait", "finish", "ask_human"]);
const PLACEHOLDER_RE =
  /^(EMAIL|PAN|AADHAAR|AMOUNT|PHONE|NAME|CARD|IFSC|GSTIN|UPI|ACCOUNT|DOB|PASSPORT|LICENCE)_\d+$/;

/**
 * Checks if a string looks like a corrupted / smeared placeholder token (e.g. "PAN_1_extra", "EMAIL_NaN", "AADHAAR_").
 */
function isSmearedPlaceholder(val: string): boolean {
  if (!val.includes("_")) return false;
  const parts = val.split("_");
  if (parts.length < 2) return false;
  const prefix = parts[0]!.toUpperCase();
  const knownPrefixes = [
    "EMAIL", "PAN", "AADHAAR", "AMOUNT", "PHONE", "NAME",
    "CARD", "IFSC", "GSTIN", "UPI", "ACCOUNT", "DOB", "PASSPORT", "LICENCE"
  ];
  if (knownPrefixes.includes(prefix) && !PLACEHOLDER_RE.test(val)) {
    return true;
  }
  return false;
}

/**
 * Validates and security-verifies a proposed plan / action list against the sanitized context.
 */
export function verifyPlan(
  actions: readonly Action[],
  context?: {
    elements?: readonly ElementMeta[];
    sanitizedPackage?: SanitizedPackage;
  }
): VerificationReport {
  const violations: PlanViolation[] = [];
  const validActions: Action[] = [];

  if (!Array.isArray(actions) || actions.length === 0) {
    violations.push({
      code: "INVALID_SCHEMA",
      message: "Plan must be a non-empty array of actions",
    });
    return { ok: false, violations, actions: [] };
  }

  const elements = context?.elements ?? context?.sanitizedPackage?.sanitizedContext.elements ?? [];
  const elementMap = new Map<string, ElementMeta>();
  const knownPlaceholders = new Set<string>();

  for (const el of elements) {
    elementMap.set(el.element_id, el);
    if (el.text && PLACEHOLDER_RE.test(el.text)) {
      knownPlaceholders.add(el.text);
    }
  }

  if (context?.sanitizedPackage?.goal) {
    const goalTokens = context.sanitizedPackage.goal.match(/\b(?:EMAIL|PAN|AADHAAR|AMOUNT|PHONE|NAME|CARD|IFSC|GSTIN|UPI|ACCOUNT|DOB|PASSPORT|LICENCE|PASSWORD|OTP|SECRET)_\d+\b/g);
    if (goalTokens) {
      for (const t of goalTokens) {
        knownPlaceholders.add(t);
      }
    }
  }

  actions.forEach((action, idx) => {
    if (!action || typeof action !== "object") {
      violations.push({
        code: "INVALID_SCHEMA",
        message: `Action at index ${idx} is not an object`,
        actionIndex: idx,
      });
      return;
    }

    // 1. Action type validation
    if (!action.type || !ALLOWED_ACTION_TYPES.has(action.type)) {
      violations.push({
        code: "UNKNOWN_ACTION_TYPE",
        message: `Unknown or disallowed action type: ${(action as any).type}`,
        actionIndex: idx,
      });
      return;
    }

    // 2. Action specific validation
    if (action.type === "click" || action.type === "type" || action.type === "select" || action.type === "submit") {
      if (!action.target || typeof action.target !== "string" || action.target.trim().length === 0) {
        violations.push({
          code: "MALFORMED_TARGET",
          message: `Action '${action.type}' requires a non-empty string target`,
          actionIndex: idx,
        });
        return;
      }

      // Check that target exists in context if context elements were supplied
      if (elements.length > 0) {
        const targetMatches =
          elementMap.has(action.target) ||
          (action.target.startsWith("#") && elementMap.has(action.target.slice(1))) ||
          Array.from(elementMap.values()).some((e) =>
            action.target === e.element_id ||
            action.target === `#${e.element_id}` ||
            (action.target.startsWith("__privis_generated:") && action.target.slice("__privis_generated:".length) === e.element_id) ||
            action.target.startsWith(`[data-privis-id="${e.element_id}"]`) ||
            action.target.startsWith(`[data-agent-id="${e.element_id}"]`)
          );
        if (!targetMatches) {
          violations.push({
            code: "TARGET_NOT_IN_CONTEXT",
            message: `Target '${action.target}' cannot be resolved in sanitized context`,
            actionIndex: idx,
          });
          return;
        }
      }
    }

    if (action.type === "type") {
      const val = action.value ?? "";
      if (typeof val !== "string") {
        violations.push({
          code: "INVALID_SCHEMA",
          message: `Type action value must be a string`,
          actionIndex: idx,
        });
        return;
      }

      // Check for raw PII leakage in typed value
      for (const pattern of PII_PATTERNS) {
        if (pattern.re.test(val)) {
          violations.push({
            code: "RAW_PII_LEAK",
            message: `Raw ${pattern.name} detected in planned type action value`,
            actionIndex: idx,
          });
        }
      }

      // Check for smeared/corrupted placeholder
      if (isSmearedPlaceholder(val)) {
        violations.push({
          code: "SMEARED_VALUE",
          message: `Smeared or malformed placeholder token: ${val}`,
          actionIndex: idx,
        });
      }

      // Check for hallucinated placeholder (if a token is used, must exist in context or allocated)
      if (
        PLACEHOLDER_RE.test(val) &&
        (context?.elements !== undefined || context?.sanitizedPackage !== undefined) &&
        !knownPlaceholders.has(val)
      ) {
        violations.push({
          code: "HALLUCINATED_PLACEHOLDER",
          message: `Placeholder '${val}' does not exist in sanitized context`,
          actionIndex: idx,
        });
      }

      // Check for label echo (typing label text into the field)
      const targetEl =
        elementMap.get(action.target) ||
        (action.target.startsWith("#") ? elementMap.get(action.target.slice(1)) : undefined) ||
        Array.from(elementMap.values()).find(
          (e) => action.target === e.element_id || action.target === `#${e.element_id}`
        );
      if (targetEl && targetEl.label) {
        const normLabel = targetEl.label.trim().toLowerCase();
        const normVal = val.trim().toLowerCase();
        if (normLabel.length > 2 && normLabel === normVal) {
          violations.push({
            code: "LABEL_ECHO",
            message: `Type action echoes field label '${normLabel}' into value`,
            actionIndex: idx,
          });
        }
      }
    }

    if (action.type === "navigate") {
      const url = (action as any).url;
      if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
        violations.push({
          code: "UNSAFE_ACTION",
          message: `Navigate action requires a valid http(s) URL`,
          actionIndex: idx,
        });
        return;
      }
    }

    validActions.push(action);
  });

  return {
    ok: violations.length === 0,
    violations,
    actions: violations.length === 0 ? validActions : [],
  };
}
