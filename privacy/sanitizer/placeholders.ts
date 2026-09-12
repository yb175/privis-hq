// privacy/sanitizer/placeholders.ts
// The session placeholder allocator.
//
// PROVENANCE: PlaceholderAllocator semantics ported from the approved
// reference repo PravAl2028/SIH26171, extension/src/shared/placeholders.ts
// (author-granted permission, Phase 01), adapted to PRIVIS's plain
// `CLASS_N` token syntax (the existing wire contract — guard/router/popup
// all validate it via PLACEHOLDER_TOKEN_REGEX; no guillemet migration).
//
// A placeholder is what the remote agent sees where a value used to be.
// Numbering is per-class and per-session, and it is *stable across steps*:
// PAN_1 on step 9 is the same value as PAN_1 on step 2. That stability is
// what lets a planner refer back to something it saw three screens ago
// without ever learning what it is.
//
// Classes with no value for a token to stand for are refused outright:
//   FACE      a photograph has no string a plan could emit that should turn
//             back into an image — allocate() throws rather than trusting
//             callers to remember.
//   PASSWORD  redacted by input type (value never extracted); a numbered
//             password placeholder would be rehydratable, which is exactly
//             what must never happen for credentials.
//
// Node-pure.

import type { SensitiveCategory } from "../../types/index.js";

/** Categories that never receive a numbered token. */
const NO_VALUE: ReadonlySet<SensitiveCategory> = new Set(["FACE", "PASSWORD"]);

/** CLASS_N, 1-based index. Must stay compatible with PLACEHOLDER_TOKEN_REGEX. */
export function formatPlaceholder(cls: SensitiveCategory, index: number): string {
  if (!Number.isInteger(index) || index < 1) {
    throw new RangeError(`placeholder index must be a positive integer, got ${String(index)}`);
  }
  return `${cls}_${index}`;
}

/**
 * Hands out stable placeholders and holds the local rehydration map.
 *
 * The map never leaves the device and is never serialised. Callers get
 * three verbs: allocate, resolve, counts.
 */
export type PlaceholderSource = "dom" | "vision" | "ocr" | "user" | "derived";

/**
 * Hands out stable placeholders and holds the local rehydration map.
 *
 * The map never leaves the device and is never serialised. Callers get
 * three verbs: allocate, resolve, counts.
 */
export class PlaceholderAllocator {
  readonly sessionId: string;

  /** `cls\0value` -> placeholder. Private: no iteration, no export. */
  readonly #byValue = new Map<string, string>();
  /** placeholder -> original value. */
  readonly #byPlaceholder = new Map<string, string>();
  /** class -> highest index handed out so far. */
  readonly #counters = new Map<SensitiveCategory, number>();
  /**
   * Provenance of each placeholder (where it was detected / allocated).
   */
  readonly #provenance = new Map<string, PlaceholderSource>();

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  /**
   * The placeholder for this value in this session. Idempotent: the same class
   * and value always come back to the same placeholder, which is what makes
   * numbering stable across steps.
   */
  allocate(cls: SensitiveCategory, value: string, fromUser: boolean | PlaceholderSource = false): string {
    if (NO_VALUE.has(cls)) {
      throw new TypeError(`${cls} has no value to stand for and cannot be allocated`);
    }
    const source: PlaceholderSource = typeof fromUser === "string" ? fromUser : fromUser ? "user" : "dom";
    const key = `${cls}\0${value}`;
    const existing = this.#byValue.get(key);
    if (existing !== undefined) {
      if (source === "user") this.#provenance.set(existing, "user");
      return existing;
    }

    const next = (this.#counters.get(cls) ?? 0) + 1;
    this.#counters.set(cls, next);
    const placeholder = formatPlaceholder(cls, next);
    this.#byValue.set(key, placeholder);
    this.#byPlaceholder.set(placeholder, value);
    this.#provenance.set(placeholder, source);
    return placeholder;
  }

  /** Did this token's value come from the operator's own sentence? */
  isFromUser(placeholder: string): boolean {
    return this.#provenance.get(placeholder) === "user";
  }

  /** Get exact provenance source for a placeholder token */
  getProvenance(placeholder: string): PlaceholderSource | undefined {
    return this.#provenance.get(placeholder);
  }

  /**
   * The value behind a placeholder, or undefined when this session never
   * issued it. A planner that invents a placeholder gets undefined here —
   * callers must reject the action, never type the placeholder literally.
   */
  resolve(placeholder: string): string | undefined {
    return this.#byPlaceholder.get(placeholder);
  }

  /** How many placeholders of a class this session has issued. Counts only. */
  count(cls: SensitiveCategory): number {
    return this.#counters.get(cls) ?? 0;
  }

  /** Explicitly purges all in-memory values and mappings */
  clear(): void {
    this.#byValue.clear();
    this.#byPlaceholder.clear();
    this.#counters.clear();
    this.#provenance.clear();
  }

  /** Secure serialization: exposes only safe session counters, NEVER raw values */
  toJSON(): Record<string, unknown> {
    const counts: Record<string, number> = {};
    for (const [cls, cnt] of this.#counters.entries()) {
      counts[cls] = cnt;
    }
    return {
      sessionId: this.sessionId,
      totalAllocated: this.#byPlaceholder.size,
      counts,
    };
  }

  toString(): string {
    return `[PlaceholderAllocator: session=${this.sessionId}, tokens=${this.#byPlaceholder.size}]`;
  }
}

// ── The session allocator ─────────────────────────────────────────────────────
// Module-level instance reset per session by resetPlaceholderTokens() (called
// from orchestrator/runStep.ts at session start), so real values are retained
// only for the minimum lifetime the multi-step session semantics require.

let sessionAllocator = new PlaceholderAllocator("session");

/** Clears all placeholder state. Called at session start. */
export function resetPlaceholderTokens(): void {
  sessionAllocator.clear();
  sessionAllocator = new PlaceholderAllocator("session");
}

/** The live session allocator. */
export function placeholderAllocator(): PlaceholderAllocator {
  return sessionAllocator;
}
