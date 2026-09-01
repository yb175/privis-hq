// remote/client.ts
// Network gateway to remote agent model (only outbound network pathway).
//
// Responsibilities:
// - Sends ONLY sanitized screenshot and tokenized DOM context to remote server.
// - Returns planned actions array from remote agent.

import type { Action, ElementMeta, SanitizedPackage } from "../types/index.js";

// Last-line defense: the Sanitizer should have replaced these before anything
// reaches this file. If they appear, something upstream broke — refuse to send.
const PII_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "PAN", re: /[a-z]{5}[0-9]{4}[a-z]/i },
  { name: "AADHAAR", re: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/ },
  { name: "EMAIL", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
];

/**
 * Throws unless pkg looks like a SanitizedPackage (not a raw CapturePackage)
 * and contains no PII patterns in any text field that would cross the wire.
 * @param pkg Candidate sanitized package
 */
function assertSanitized(pkg: SanitizedPackage): void {
  const raw = pkg as unknown as Record<string, unknown>;
  for (const key of ["tabId", "dataUrl", "elements", "detections"]) {
    if (key in raw) {
      throw new Error(
        `Refusing to send: package has raw field "${key}" — run the Sanitizer first`
      );
    }
  }
  if (typeof pkg.goal !== "string" || pkg.goal.length === 0) {
    throw new Error("Refusing to send: missing goal");
  }
  if (typeof pkg.sanitizedScreenshot !== "string" || pkg.sanitizedScreenshot === "") {
    throw new Error("Refusing to send: missing sanitizedScreenshot");
  }
  if (!pkg.sanitizedContext || !Array.isArray(pkg.sanitizedContext.elements)) {
    throw new Error("Refusing to send: missing sanitizedContext");
  }

  // Scan the full serialized context (every element field, browser state, goal)
  // so no unscanned metadata field can carry PII across the wire.
  const serialized = JSON.stringify({
    goal: pkg.goal,
    ...pkg.sanitizedContext,
  });
  for (const { name, re } of PII_PATTERNS) {
    if (re.test(serialized)) {
      throw new Error(
        `Refusing to send: ${name} pattern found in sanitized package — Sanitizer leaked`
      );
    }
  }
}

/**
 * Sends sanitized package to the remote planner endpoint.
 * Called strictly after Policy Gate grants "allow".
 * @param pkg Sanitized package containing tokens and redacted image
 */
export async function sendSanitized(pkg: SanitizedPackage): Promise<Action[]> {
  assertSanitized(pkg);

  // v0 stub: no network call yet. A real VLM agent plugs in here — it would
  // POST { goal, sanitizedScreenshot, sanitizedContext } and parse Action[]
  // from the response. Until then, derive a sensible action from the real
  // sanitized DOM so the demo behaves correctly on any tab.
  return stubPlan(pkg.sanitizedContext.elements);
}

/**
 * Picks the first real clickable control from the sanitized DOM. No AI — just
 * the same kind of rule a lightweight agent would use: click a submit button,
 * a regular button, or a button/link role in document order.
 */
function stubPlan(elements: ElementMeta[]): Action[] {
  const isClickable = (el: ElementMeta): boolean =>
    el.tag === "button" ||
    el.role === "button" ||
    el.role === "link" ||
    (el.tag === "input" && (el.type === "submit" || el.type === "button"));

  const target = elements.find(isClickable);
  if (!target) return [];
  return [{ type: "click", target: selectorFor(target) }];
}

/**
 * Builds a resolver-friendly target. Real DOM ids resolve via getElementById;
 * generated ids (el-<tag>-<n>) fall back to a tag/attribute CSS selector.
 */
function selectorFor(el: ElementMeta): string {
  if (!/^el-/.test(el.element_id)) return `#${el.element_id}`;
  if (el.tag === "input" && el.type) return `input[type="${el.type}"]`;
  return el.tag;
}
