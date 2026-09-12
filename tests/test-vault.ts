// tests/test-vault.ts
// Phase 01: the secret vault (SIH26171 worker/vault.ts port). Keyed by
// origin+class, nothing read without a visible confirm, declining is a
// first-class outcome. Executor wiring is deferred — this pins the module's
// own contract now so the wiring lands on solid ground.

import {
  vaultKeyOf,
  readSecret,
  saveSecret,
  forgetSecret,
  listSecrets,
  forgetAll,
  VAULT_PREFIX,
  type VaultStore,
} from "../privacy/vault.js";
import process from "node:process";

const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  PASS ${name}`);
  else {
    failures.push(name + (detail ? ` (${detail})` : ""));
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** In-memory store: same shape chrome.storage.local presents. */
function memStore(): VaultStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(key) {
      return data.get(key) as never;
    },
    async set(key, entry) {
      data.set(key, entry);
    },
    async remove(key) {
      data.delete(key);
    },
    async keys() {
      return [...data.keys()];
    },
  };
}

const origin = { origin: "https://portal.gov.in", cls: "PASSWORD" } as const;

// --- Keying ---------------------------------------------------------------------
check("vault key is origin|class, namespaced",
  vaultKeyOf(origin) === `${VAULT_PREFIX}https://portal.gov.in|PASSWORD`);

// --- The read path: stored, confirmed --------------------------------------------
{
  const store = memStore();
  await saveSecret(origin, { label: "IRCTC password", value: "correct horse" }, { store });
  let asked = 0;
  const r = await readSecret(origin, {
    store,
    confirm: async (req) => {
      asked += 1;
      return req.origin === "https://portal.gov.in" && req.label === "IRCTC password";
    },
  });
  check("stored + confirmed -> value", r.ok && r.value === "correct horse");
  check("confirm ran exactly once, naming the origin", asked === 1);
}

// --- Declining is a first-class outcome -------------------------------------------
{
  const store = memStore();
  await saveSecret(origin, { label: "pw", value: "x" }, { store });
  const r = await readSecret(origin, { store, confirm: async () => false });
  check("declined -> { ok: false, reason: 'declined' }, no value field", !r.ok && r.reason === "declined");
}

// --- Not stored: no confirm, no leak ------------------------------------------------
{
  const store = memStore();
  let asked = 0;
  const r = await readSecret({ origin: "https://other.example", cls: "PASSWORD" }, {
    store,
    confirm: async () => {
      asked += 1;
      return true;
    },
  });
  check("not stored -> 'not-stored'", !r.ok && r.reason === "not-stored");
  check("look-first-then-ask: no confirm when nothing is stored", asked === 0);
}

// --- Refusals ------------------------------------------------------------------------
{
  const store = memStore();
  let refused = false;
  try {
    await saveSecret(origin, { label: "empty", value: "" }, { store });
  } catch {
    refused = true;
  }
  check("empty secret refused", refused);
}

// --- Same key replaces; different key coexists ----------------------------------------
{
  const store = memStore();
  await saveSecret(origin, { label: "old", value: "a" }, { store });
  await saveSecret(origin, { label: "new", value: "b" }, { store });
  const r = await readSecret(origin, { store, confirm: async (req) => req.label === "new" });
  check("same origin+class replaces (one entry per key)", r.ok && r.value === "b");
  await saveSecret({ origin: "https://bank.example", cls: "PASSWORD" }, { label: "c", value: "c" }, { store });
  check("listing shows keys only, both origins", (await listSecrets({ store })).length === 2);
}

// --- Forget -----------------------------------------------------------------------------
{
  const store = memStore();
  await saveSecret(origin, { label: "pw", value: "x" }, { store });
  await forgetSecret(origin, { store });
  check("forgetSecret removes exactly that key", (await listSecrets({ store })).length === 0);
}

// --- The operator's escape hatch ----------------------------------------------------------
{
  const store = memStore();
  await saveSecret(origin, { label: "a", value: "a" }, { store });
  await saveSecret({ origin: "https://b.example", cls: "PASSWORD" }, { label: "b", value: "b" }, { store });
  store.data.set("unrelated-key", "not ours");
  const n = await forgetAll({ store });
  check("forgetAll drops only vault-prefixed entries", n === 2 && store.data.size === 1);
}

if (failures.length === 0) console.log("\nALL CHECKS PASSED");
else {
  console.error(`\nFAILED: ${failures.length} check(s)`);
  process.exit(1);
}
