// remote/client.ts
// Network gateway to remote agent model (only outbound network pathway).
//
// Responsibilities:
// - Sends ONLY sanitized screenshot and tokenized DOM context to remote server.
// - Returns planned actions array from remote agent.

import type { Action, SanitizedPackage } from "../types/index.js";

// Last-line defense: the Sanitizer should have replaced these before anything
// reaches this file. If they appear, something upstream broke — refuse to send.
const PII_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "PAN", re: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/ },
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

  // Scan every string that would leave the device for PII.
  const texts = [
    pkg.goal,
    pkg.sanitizedContext.browserState.url,
    pkg.sanitizedContext.browserState.title,
    ...pkg.sanitizedContext.elements.flatMap((el) => [
      el.text,
      el.label ?? "",
    ]),
  ];
  for (const text of texts) {
    for (const { name, re } of PII_PATTERNS) {
      if (re.test(text)) {
        throw new Error(
          `Refusing to send: ${name} pattern found in sanitized package — Sanitizer leaked`
        );
      }
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
  // from the response. Until then, return the fixture action.
  return [{ type: "click", target: "#submit" }];
}
