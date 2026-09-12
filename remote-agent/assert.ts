// remote-agent/assert.ts
// Outbound sanitization boundary — the leaf module every provider/server/client
// path imports. Living here (not in router.ts) lets the LLM clients enforce
// the same boundary without an import cycle (router -> clients -> assert).
//
// One contract: only a proven-sanitized SanitizedPackage may cross to any
// provider/server. This module never redacts — it refuses. The Sanitizer is
// the only package builder (CONTRACT.md data flow).

import type { SanitizedPackage } from "../types/index.js";
import { PII_PATTERNS } from "./types.js";

/**
 * Validates that the package is properly sanitized before transmitting over the network.
 * Throws if raw data, missing fields, or unredacted PII patterns are found.
 */
export function assertSanitizedPackage(pkg: SanitizedPackage): void {
  if (!pkg || typeof pkg !== "object") {
    throw new Error("Invalid package: expected a non-null object");
  }

  const raw = pkg as unknown as Record<string, unknown>;
  for (const rawKey of ["tabId", "dataUrl", "detections"]) {
    if (rawKey in raw) {
      throw new Error(
        `Refusing to route: package contains raw field "${rawKey}" — run the Sanitizer first`
      );
    }
  }

  if (typeof pkg.goal !== "string" || pkg.goal.trim().length === 0) {
    throw new Error("Refusing to route: missing or empty goal");
  }

  if (typeof pkg.sanitizedScreenshot !== "string" || pkg.sanitizedScreenshot.trim().length === 0) {
    throw new Error("Refusing to route: missing or empty sanitizedScreenshot");
  }

  if (!pkg.sanitizedContext || !Array.isArray(pkg.sanitizedContext.elements)) {
    throw new Error("Refusing to route: missing sanitizedContext elements array");
  }

  if (!pkg.sanitizedContext.browserState) {
    throw new Error("Refusing to route: missing browserState in sanitizedContext");
  }

  // Provenance gate: only the on-device Sanitizer path stamps redacted: true
  // after structural + visual redaction. A textual PII regex scan cannot verify
  // that PIXELS were redacted, so an unmarked package is never dispatched.
  // ponytail: flag set by trusted in-device code; a fully compromised extension
  // process could forge it — real mitigation is the sanitizer being the only
  // package builder, per CONTRACT.md data flow.
  if (pkg.redacted !== true) {
    throw new Error(
      "Refusing to route: package not marked as sanitized (redacted flag missing) — run the Sanitizer first"
    );
  }

  // Scan full serialized payload to ensure no raw PII leaks across the wire
  const serialized = JSON.stringify({
    goal: pkg.goal,
    sanitizedContext: pkg.sanitizedContext,
  });

  for (const { name, re } of PII_PATTERNS) {
    if (re.test(serialized)) {
      throw new Error(
        `Refusing to route: ${name} pattern detected in sanitized package — Sanitizer leaked`
      );
    }
  }
}
