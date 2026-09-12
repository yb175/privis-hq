// privacy/vault.ts
// The secret vault.
//
// PROVENANCE: ported from the approved reference repo PravAl2028/SIH26171,
// extension/src/worker/vault.ts (author-granted permission, Phase 01),
// adapted to PRIVIS (SensitiveCategory instead of PlaceholderClass; the
// chrome.storage seam is injected, so this module is Node-testable).
//
// This is the one place in the extension that would deliberately persist a
// user's plaintext, so the constraints on it are stricter than anywhere else
// and are worth stating before the code.
//
// **The remote agent can never reach it.** A PASSWORD finding is never
// allocated a placeholder (placeholders.ts NO_VALUE), so no token stands for
// it, so a plan cannot name one. Nothing in this file is reachable from a
// plan — the only caller is an `ask` the operator answered.
//
// **Keyed by origin and class, never by field.** `https://portal.gov.in` +
// `PASSWORD` is the key. Not the element index, which changes on every walk;
// not the field name, which the site controls and can change to something
// that looks like another site's. An origin is the coarsest thing that is
// still a real security boundary, and the coarsest correct key is the right
// one for a store that must not accumulate.
//
// **Nothing is read without a visible confirm.** Not once per session, not
// remembered: every read names the field and the origin and waits. A vault
// that fills silently is a credential-stuffing tool that happens to be driven
// by a language model.
//
// Phase 01 status: module + tests landed; executor wiring (the ask-flow that
// calls readSecret and types the credential after the confirm) is deferred —
// see docs/PRIVIS_ROUND2_CONTEXT.md. Until that lands nothing calls it, which
// is the safest possible interim state for a store like this.
//
// Node-pure: storage and confirmation are injected.

import type { SensitiveCategory } from "../types/index.js";

/** Where the vault lives. Its own key space, so a clear is unambiguous. */
export const VAULT_PREFIX = "vault:";

export interface VaultKey {
  /** Scheme and host. Never a full URL: query strings routinely carry identifiers. */
  origin: string;
  cls: SensitiveCategory;
}

export interface VaultEntry {
  /** What the operator is agreeing to release, named in the confirm. */
  label: string;
  value: string;
  savedAt: number;
  expiresAt?: number;
}

/** What a read can produce. Declining is a first-class outcome, not an error. */
export type VaultRead =
  | { ok: true; value: string }
  | { ok: false; reason: "not-stored" | "declined" | "expired" | "invalid-key" };

/**
 * The parts of the backing store this needs, and no more. Injected so the
 * tests run against a Map rather than chrome.storage.local.
 */
export interface VaultStore {
  get(key: string): Promise<VaultEntry | undefined>;
  set(key: string, entry: VaultEntry): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/**
 * Asks the operator, naming what is about to be released and to whom.
 *
 * Injected because the answer must come from a human and a test cannot be
 * one. In the extension this should open a confirmation window rather than a
 * notification, which can be missed or suppressed; what matters is that no
 * code path skips it.
 */
export type ConfirmRelease = (request: {
  origin: string;
  cls: SensitiveCategory;
  label: string;
}) => Promise<boolean>;

export function vaultKeyOf({ origin, cls }: VaultKey): string {
  if (!origin || typeof origin !== "string" || !cls) {
    throw new Error("vault: invalid key parameters");
  }
  return `${VAULT_PREFIX}${origin}|${cls}`;
}

/**
 * Read a secret, if one is stored, not expired, and the operator says yes.
 *
 * The order is deliberate: look first, then ask. Asking about a secret that
 * is not stored would tell the operator, every time a page has a password
 * field, that we looked — and train them to click through a prompt that
 * usually means nothing.
 */
export async function readSecret(
  key: VaultKey,
  deps: { store: VaultStore; confirm: ConfirmRelease; now?: () => number }
): Promise<VaultRead> {
  if (!key.origin || !key.cls) return { ok: false, reason: "invalid-key" };

  const entry = await deps.store.get(vaultKeyOf(key));
  if (!entry) return { ok: false, reason: "not-stored" };

  const now = (deps.now ?? Date.now)();
  if (entry.expiresAt && now > entry.expiresAt) {
    // Automatically purge expired secret
    await deps.store.remove(vaultKeyOf(key));
    return { ok: false, reason: "expired" };
  }

  const allowed = await deps.confirm({
    origin: key.origin,
    cls: key.cls,
    label: entry.label,
  });
  if (!allowed) return { ok: false, reason: "declined" };

  return { ok: true, value: entry.value };
}

/**
 * Store one, replacing whatever was there for that origin and class.
 *
 * Only ever called from operator UI, in response to the operator typing it.
 * There is no path from a page, a plan or a step.
 */
export async function saveSecret(
  key: VaultKey,
  entry: { label: string; value: string; ttlMs?: number },
  deps: { store: VaultStore; now?: () => number }
): Promise<void> {
  if (!key.origin || typeof key.origin !== "string") {
    throw new Error("vault: invalid origin");
  }
  if (entry.value === "") throw new Error("vault: refusing to store an empty secret");
  
  const now = (deps.now ?? Date.now)();
  const expiresAt = entry.ttlMs && entry.ttlMs > 0 ? now + entry.ttlMs : undefined;

  await deps.store.set(vaultKeyOf(key), {
    label: entry.label,
    value: entry.value,
    savedAt: now,
    expiresAt,
  });
}

export async function forgetSecret(key: VaultKey, deps: { store: VaultStore }): Promise<void> {
  await deps.store.remove(vaultKeyOf(key));
}

/** Everything stored, as keys only. The values never leave for a listing. */
export async function listSecrets(deps: { store: VaultStore }): Promise<VaultKey[]> {
  const keys = await deps.store.keys();
  const entries: VaultKey[] = [];

  for (const key of keys) {
    if (!key.startsWith(VAULT_PREFIX)) continue;
    const [origin, cls] = key.slice(VAULT_PREFIX.length).split("|");
    if (origin && cls) entries.push({ origin, cls: cls as SensitiveCategory });
  }
  return entries;
}

/** Drop everything. The operator's escape hatch, and what an uninstall should do. */
export async function forgetAll(deps: { store: VaultStore }): Promise<number> {
  const keys = await deps.store.keys();
  const ours = keys.filter((k) => k.startsWith(VAULT_PREFIX));
  for (const key of ours) await deps.store.remove(key);
  return ours.length;
}
