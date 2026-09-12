// remote-agent/transport.ts
// Secure Transport, Timeout Budgets, and Bounded Retries.
//
// PROVENANCE: ported from approved reference PravAl2028/SIH26171,
// extension/src/worker/transport.ts (author-granted permission).
//
// Wraps outbound HTTP requests with strict receipt verification, schema
// assertions, timeout budgets, and failure classification.

import type { SanitizedPackage } from "../types/index.js";
import { assertSanitizedPackage } from "./assert.js";
import { verifyReceipt } from "./receipt.js";

export interface TransportOptions {
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  fetchFn?: typeof fetch;
}

export interface TransportResponse<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  retriesAttempted: number;
  elapsedMs: number;
}

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 500;

/**
 * Sends an outbound request with complete receipt check and timeout protection.
 */
export async function securePostJson<T = unknown>(
  url: string,
  pkg: SanitizedPackage,
  headers: Record<string, string> = {},
  options: TransportOptions = {}
): Promise<TransportResponse<T>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const fetchFn = options.fetchFn ?? fetch;
  const start = Date.now();

  // 1. Mandatory Pre-Flight Security & Receipt Verification
  assertSanitizedPackage(pkg);
  const receiptCheck = await verifyReceipt(pkg.sanitizedScreenshot, pkg.redactionManifest);
  if (!receiptCheck.ok) {
    throw new Error(
      `securePostJson: receipt verification failed (${receiptCheck.reason}) — aborting outbound request`
    );
  }

  const body = JSON.stringify(pkg);
  let retries = 0;
  let lastError = "";

  while (retries <= maxRetries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!resp.ok) {
        // 4xx client errors or privacy errors: non-retryable
        if (resp.status >= 400 && resp.status < 500) {
          const errText = await resp.text();
          return {
            ok: false,
            status: resp.status,
            error: `Client error (${resp.status}): ${errText}`,
            retriesAttempted: retries,
            elapsedMs: Date.now() - start,
          };
        }
        // 5xx server errors: retryable
        lastError = `Server error ${resp.status}`;
      } else {
        const data = (await resp.json()) as T;
        return {
          ok: true,
          status: resp.status,
          data,
          retriesAttempted: retries,
          elapsedMs: Date.now() - start,
        };
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === "AbortError") {
        lastError = `Request timeout after ${timeoutMs}ms`;
      } else {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    retries++;
    if (retries <= maxRetries) {
      await new Promise((r) => setTimeout(r, retryDelayMs * Math.pow(2, retries - 1)));
    }
  }

  return {
    ok: false,
    status: 0,
    error: `Transport failed after ${retries} attempts: ${lastError}`,
    retriesAttempted: retries,
    elapsedMs: Date.now() - start,
  };
}
