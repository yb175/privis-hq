// orchestrator/transparency-log.ts
// CBA-11: Session Transparency Log.
// Persists exact wire packages sent to the AI agent per session for jury audits.
// Boundaries:
// - Boundary: Reuses assertSanitizedPackage() + PII_PATTERNS tripwires.
// - Fail-closed: Raw field leaks fail closed to a digest-only stub + error.
// - Ring buffer: Max 5 sessions and 4MB storage cap, oldest-first pruning.

import type {
  SanitizedPackage,
  TransparencyEntry,
  TransparencyLogStore,
} from "../types/index.js";
import { assertSanitizedPackage } from "../remote-agent/router.js";
import { PII_PATTERNS } from "../remote-agent/types.js";
import {
  TRANSPARENCY_STORAGE_KEY,
  computeRequestDigest,
} from "../utils/digest.js";

export { TRANSPARENCY_STORAGE_KEY, computeRequestDigest };
export const MAX_TRANSPARENCY_SESSIONS = 5;
export const MAX_TRANSPARENCY_BYTES = 4 * 1024 * 1024; // 4MB

// In-memory fallback for environments without chrome.storage.local
let inMemoryFallbackStore: TransparencyLogStore = {
  version: 1,
  prunedCount: 0,
  entries: [],
};

/**
 * Validates that an outbound package strictly obeys the sanitization boundary
 * before being committed to on-device audit storage.
 */
export function validateSanitizedForLog(
  pkg: SanitizedPackage
): { ok: true } | { ok: false; error: string } {
  try {
    if (!pkg || typeof pkg !== "object") {
      return { ok: false, error: "Package is not a valid non-null object" };
    }

    // Reuse official router sanitization assertion (boundary check)
    assertSanitizedPackage(pkg);

    // Deep check for structural forbidden keys
    const raw = pkg as unknown as Record<string, unknown>;
    for (const forbidden of ["tabId", "dataUrl", "detections"]) {
      if (forbidden in raw) {
        return {
          ok: false,
          error: `Package contains forbidden raw field "${forbidden}"`,
        };
      }
    }

    // Verify all element labels are stripped/null
    if (pkg.sanitizedContext?.elements) {
      for (const el of pkg.sanitizedContext.elements) {
        if (el.label !== null && el.label !== undefined && el.label !== "") {
          return {
            ok: false,
            error: `Element "${el.element_id}" has non-null label "${el.label}"`,
          };
        }
      }
    }

    // Tripwire: regex scan across full serialized request
    const serialized = JSON.stringify(pkg);
    for (const { name, re } of PII_PATTERNS) {
      if (re.test(serialized)) {
        return {
          ok: false,
          error: `Raw PII pattern "${name}" detected in outbound package`,
        };
      }
    }

    return { ok: true };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Helper to get unique sessionIds in arrival order (oldest first).
 */
function getUniqueSessionIds(entries: TransparencyEntry[]): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const e of entries) {
    if (!seen.has(e.sessionId)) {
      seen.add(e.sessionId);
      list.push(e.sessionId);
    }
  }
  return list;
}

/**
 * Enforces the bounded ring buffer:
 * 1. Max 5 sessions (oldest sessions dropped first).
 * 2. Max 4MB size (oldest sessions dropped first, newest session always intact).
 */
export function pruneLogStore(store: TransparencyLogStore): void {
  // 1. Session count cap
  let sessionIds = getUniqueSessionIds(store.entries);
  if (sessionIds.length > MAX_TRANSPARENCY_SESSIONS) {
    const overflow = sessionIds.length - MAX_TRANSPARENCY_SESSIONS;
    const toPrune = new Set(sessionIds.slice(0, overflow));
    store.entries = store.entries.filter((e) => !toPrune.has(e.sessionId));
    store.prunedCount += toPrune.size;
  }

  // 2. Byte size cap (~4MB)
  let bytes = new TextEncoder().encode(JSON.stringify(store)).length;
  sessionIds = getUniqueSessionIds(store.entries);

  while (bytes > MAX_TRANSPARENCY_BYTES && sessionIds.length > 1) {
    const oldestId = sessionIds[0];
    store.entries = store.entries.filter((e) => e.sessionId !== oldestId);
    store.prunedCount += 1;
    sessionIds = getUniqueSessionIds(store.entries);
    bytes = new TextEncoder().encode(JSON.stringify(store)).length;
  }
}

/**
 * Read the transparency log store from chrome.storage.local or fallback.
 */
export async function getTransparencyLog(): Promise<TransparencyLogStore> {
  if (
    typeof chrome !== "undefined" &&
    chrome.storage &&
    chrome.storage.local &&
    typeof chrome.storage.local.get === "function"
  ) {
    try {
      const res = await chrome.storage.local.get(TRANSPARENCY_STORAGE_KEY);
      const data = res?.[TRANSPARENCY_STORAGE_KEY];
      if (
        data &&
        typeof data === "object" &&
        Array.isArray((data as TransparencyLogStore).entries)
      ) {
        return data as TransparencyLogStore;
      }
    } catch {
      // Fall through to in-memory fallback
    }
  }
  return inMemoryFallbackStore;
}

/**
 * Save transparency log store to chrome.storage.local or fallback after pruning.
 */
export async function saveTransparencyLog(
  store: TransparencyLogStore
): Promise<void> {
  pruneLogStore(store);
  if (
    typeof chrome !== "undefined" &&
    chrome.storage &&
    chrome.storage.local &&
    typeof chrome.storage.local.set === "function"
  ) {
    try {
      await chrome.storage.local.set({ [TRANSPARENCY_STORAGE_KEY]: store });
      return;
    } catch {
      // Fall through to in-memory
    }
  }
  inMemoryFallbackStore = store;
}

// Write mutex queue to prevent concurrency race conditions during read-modify-write
let logQueue: Promise<void> = Promise.resolve();

/**
 * Appends a verified TransparencyEntry to storage.
 * Enforces fail-closed: if the package violates sanitization or leaks raw fields/PII,
 * the stored request is replaced with a safe digest-only stub and marked with an error.
 */
export function logTransparencyEntry(entry: TransparencyEntry): Promise<void> {
  const operation = async () => {
    // Ensure request digest is calculated
    if (!entry.requestDigest && entry.request) {
      entry.requestDigest = await computeRequestDigest(entry.request);
    }

    // Boundary check: assertSanitizedPackage + PII scan
    const validation = validateSanitizedForLog(entry.request);
    if (!validation.ok) {
      // FAIL-CLOSED: Replace with digest-only safe stub + record security error
      entry.request = {
        goal: entry.goal || "",
        sanitizedScreenshot: "",
        sanitizedContext: {
          elements: [],
          browserState: {
            url: entry.request?.sanitizedContext?.browserState?.url || "",
            title: entry.request?.sanitizedContext?.browserState?.title || "",
            viewport: { w: 0, h: 0 },
          },
        },
        redactionManifest: {
          counts: {},
          redactedFraction: 0,
          overRedactedFraction: 0,
          policyVersion: "1.0",
          receipt: {
            algo: "SHA-256",
            hash: "",
            manifestHash: "",
            sealedAt: Date.now(),
          },
        },
        redacted: true,
      };
      entry.error = `FAIL_CLOSED: ${validation.error}`;
    }

    const store = await getTransparencyLog();
    store.entries.push(entry);
    await saveTransparencyLog(store);
  };

  logQueue = logQueue.then(operation, operation);
  return logQueue;
}

/**
 * Clears the transparency log store.
 */
export async function clearTransparencyLog(): Promise<void> {
  const empty: TransparencyLogStore = {
    version: 1,
    prunedCount: 0,
    entries: [],
  };
  inMemoryFallbackStore = empty;
  if (
    typeof chrome !== "undefined" &&
    chrome.storage &&
    chrome.storage.local &&
    typeof chrome.storage.local.set === "function"
  ) {
    try {
      await chrome.storage.local.set({ [TRANSPARENCY_STORAGE_KEY]: empty });
    } catch {
      // Ignore
    }
  }
}
