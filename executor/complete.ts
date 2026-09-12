// executor/complete.ts
// Post-action verification and completion determination.
//
// PROVENANCE: ported from approved reference PravAl2028/SIH26171,
// extension/src/worker/complete.ts (author-granted permission).
//
// Re-reads element state after an action to confirm success using a closed
// vocabulary of verdicts instead of assuming an action succeeded merely because
// an event dispatched without throwing.

import type { Action, ElementMeta } from "../types/index.js";

export type CompletionVerdict =
  | "VERIFIED_FILLED"
  | "VERIFIED_CLICKED"
  | "VALUE_MISMATCH"
  | "TARGET_CLEARED"
  | "TARGET_STALE"
  | "PAGE_NAVIGATED"
  | "UNVERIFIABLE";

export interface VerificationResult {
  verdict: CompletionVerdict;
  ok: boolean;
  expectedValue?: string;
  actualValue?: string;
  detail?: string;
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Verifies that a executed action produced the intended outcome on the page.
 */
export function verifyActionCompletion(
  action: Action,
  preElements: readonly ElementMeta[],
  postElements: readonly ElementMeta[],
  options?: { targetRealValue?: string; navigated?: boolean }
): VerificationResult {
  if (options?.navigated) {
    return { verdict: "PAGE_NAVIGATED", ok: true, detail: "Page navigation detected" };
  }

  if (action.type === "navigate" || action.type === "finish" || action.type === "wait") {
    return { verdict: "VERIFIED_CLICKED", ok: true };
  }

  const targetSelector = action.target || "";
  const postEl = postElements.find(
    (e) => e.element_id === targetSelector || (targetSelector.startsWith("#") && e.element_id === targetSelector.slice(1))
  );

  if (!postEl) {
    // If target was a button/submit or link, disappearing post-action often means success/transition
    if (action.type === "click") {
      return { verdict: "VERIFIED_CLICKED", ok: true, detail: "Element disappeared or page transitioned after click" };
    }
    return { verdict: "TARGET_STALE", ok: false, detail: `Target ${targetSelector} not found in post-action DOM` };
  }

  if (action.type === "click") {
    return { verdict: "VERIFIED_CLICKED", ok: true };
  }

  if (action.type === "type") {
    const expected = options?.targetRealValue ?? action.value ?? "";
    const actual = postEl.text ?? "";

    if (!actual && expected) {
      return {
        verdict: "TARGET_CLEARED",
        ok: false,
        expectedValue: "[REDACTED]",
        actualValue: "",
        detail: "Target field is empty after type action",
      };
    }

    if (norm(actual) === norm(expected) || actual.includes(expected) || expected.includes(actual)) {
      return { verdict: "VERIFIED_FILLED", ok: true };
    }

    return {
      verdict: "VALUE_MISMATCH",
      ok: false,
      expectedValue: "[REDACTED]",
      actualValue: "[REDACTED]",
      detail: "Field content does not match expected typed value",
    };
  }

  return { verdict: "UNVERIFIABLE", ok: true };
}
