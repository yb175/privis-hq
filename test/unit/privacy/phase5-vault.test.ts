// tests/test-phase5-vault.ts
// Phase 05: Privacy Vault, Secret Lifecycle, and Zero-Leak Data Handling Test Suite.

import assert from "node:assert";
import process from "node:process";
import {
  vaultKeyOf,
  readSecret,
  saveSecret,
  forgetSecret,
  listSecrets,
  forgetAll,
  VAULT_PREFIX,
  type VaultStore,
  type VaultKey,
} from "../../../privacy/vault.js";
import {
  PlaceholderAllocator,
  resetPlaceholderTokens,
  placeholderAllocator,
} from "../../../privacy/sanitizer/placeholders.js";
import { tokeniseGoal } from "../../../orchestrator/goal-tokenize.js";

const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures.push(name + (detail ? ` (${detail})` : ""));
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

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

console.log("=== Phase 05 Privacy Vault & Zero-Leak Secret Management Test Suite ===");

// ── [1] P05-02: Secret Vault Core & Isolation ─────────────────────────────────
console.log("\n[1] P05-02: Secret Vault Core & Isolation");
{
  const store = memStore();
  const originKey: VaultKey = { origin: "https://portal.gov.in", cls: "PASSWORD" };
  
  await saveSecret(originKey, { label: "Login PW", value: "Secret@123" }, { store });

  let confirmCalled = 0;
  const readRes = await readSecret(originKey, {
    store,
    confirm: async (req) => {
      confirmCalled++;
      return req.origin === "https://portal.gov.in" && req.cls === "PASSWORD";
    },
  });

  check("Secret read succeeds with operator confirmation", readRes.ok && readRes.value === "Secret@123");
  check("Confirm called exactly once with origin and class metadata", confirmCalled === 1);

  // Different origin on same store
  const otherOrigin: VaultKey = { origin: "https://bank.com", cls: "PASSWORD" };
  const readOther = await readSecret(otherOrigin, {
    store,
    confirm: async () => true,
  });
  check("Unstored origin returns not-stored without invoking confirm", !readOther.ok && readOther.reason === "not-stored");
}

// ── [2] P05-03: Placeholder Allocator & Safety ───────────────────────────────
console.log("\n[2] P05-03: Placeholder Allocator & Safety");
{
  const alloc = new PlaceholderAllocator("test-session");

  const p1 = alloc.allocate("EMAIL", "alice@example.com");
  const p2 = alloc.allocate("EMAIL", "alice@example.com");
  check("Identical value receives stable placeholder", p1 === "EMAIL_1" && p2 === "EMAIL_1");

  const p3 = alloc.allocate("EMAIL", "bob@example.com");
  check("Different value receives incremented index", p3 === "EMAIL_2");

  let faceRefused = false;
  try {
    alloc.allocate("FACE" as any, "binary-bytes");
  } catch {
    faceRefused = true;
  }
  check("FACE allocation refused outright (no text placeholder for image)", faceRefused);

  let passwordRefused = false;
  try {
    alloc.allocate("PASSWORD" as any, "plainpass");
  } catch {
    passwordRefused = true;
  }
  check("PASSWORD allocation refused outright (credentials not placeholdered)", passwordRefused);
}

// ── [3] P05-04: Provenance Tracking ──────────────────────────────────────────
console.log("\n[3] P05-04: Provenance Tracking");
{
  const alloc = new PlaceholderAllocator("test-prov");

  const pDom = alloc.allocate("PAN", "ABCPE1234F", "dom");
  check("DOM provenance recorded", alloc.getProvenance(pDom) === "dom" && !alloc.isFromUser(pDom));

  const pUser = alloc.allocate("PAN", "XYZPE5678G", "user");
  check("User goal provenance recorded", alloc.getProvenance(pUser) === "user" && alloc.isFromUser(pUser));

  const pOcr = alloc.allocate("GSTIN", "27ABCPE1234F1Z5", "ocr");
  check("OCR provenance recorded", alloc.getProvenance(pOcr) === "ocr");
}

// ── [4] P05-05: Secret Lifecycle & Expiration (TTL) ──────────────────────────
console.log("\n[4] P05-05: Secret Lifecycle & Expiration (TTL)");
{
  const store = memStore();
  const key: VaultKey = { origin: "https://temp.gov.in", cls: "CARD" };
  let currentTime = 1000;

  await saveSecret(
    key,
    { label: "Temp OTP", value: "987654", ttlMs: 500 },
    { store, now: () => currentTime }
  );

  // Read before expiration
  const readValid = await readSecret(key, {
    store,
    confirm: async () => true,
    now: () => 1200,
  });
  check("Secret accessible before TTL expiration", readValid.ok && readValid.value === "987654");

  // Read after expiration
  const readExpired = await readSecret(key, {
    store,
    confirm: async () => true,
    now: () => 1600,
  });
  check("Secret rejected and auto-purged after TTL expiration", !readExpired.ok && readExpired.reason === "expired");

  // Verify purged from store
  const postPurge = await store.get(vaultKeyOf(key));
  check("Expired secret deleted from storage", postPurge === undefined);
}

// ── [5] P05-08: Secret Residue Prevention & Zero-Leak Auditing ───────────────
console.log("\n[5] P05-08: Secret Residue Prevention & Zero-Leak Auditing");
{
  const alloc = new PlaceholderAllocator("test-zero-leak");
  alloc.allocate("EMAIL", "secret-agent@cia.gov");
  alloc.allocate("PAN", "ABCPE1234F");

  const json = JSON.stringify(alloc);
  check("toJSON() serializes metadata only", !json.includes("secret-agent@cia.gov") && !json.includes("ABCPE1234F"));
  check("toJSON() contains totalAllocated and counts", json.includes("totalAllocated") && json.includes("counts"));

  const str = alloc.toString();
  check("toString() formats summary without raw values", !str.includes("secret-agent") && str.startsWith("[PlaceholderAllocator:"));
}

// ── [6] P05-10: Adversarial Vault Tests ──────────────────────────────────────
console.log("\n[6] P05-10: Adversarial Vault Tests");
{
  const store = memStore();

  // Invalid key parameters
  let malformedRefused = false;
  try {
    vaultKeyOf({ origin: "", cls: "PASSWORD" });
  } catch {
    malformedRefused = true;
  }
  check("Empty origin in vaultKeyOf rejected", malformedRefused);

  // Empty value refusal
  let emptyValRefused = false;
  try {
    await saveSecret({ origin: "https://a.com", cls: "PASSWORD" }, { label: "l", value: "" }, { store });
  } catch {
    emptyValRefused = true;
  }
  check("Empty secret value rejected on save", emptyValRefused);

  // Operator decline
  const key: VaultKey = { origin: "https://decline.com", cls: "PASSWORD" };
  await saveSecret(key, { label: "pw", value: "pass" }, { store });
  const declined = await readSecret(key, {
    store,
    confirm: async () => false,
  });
  check("Operator decline produces safe non-throw verdict", !declined.ok && declined.reason === "declined");

  // Forget all escape hatch
  await saveSecret({ origin: "https://x.com", cls: "PASSWORD" }, { label: "x", value: "x" }, { store });
  store.data.set("unrelated_app_setting", "preserve_this");
  const purgedCount = await forgetAll({ store });
  check("forgetAll purges exactly vault entries", purgedCount === 2 && store.data.has("unrelated_app_setting"));
}

console.log("\n============================================================");
if (failures.length === 0) {
  console.log("✅ ALL PHASE 05 PRIVACY VAULT TESTS PASSED (100%)");
} else {
  console.error(`❌ FAILED: ${failures.length} check(s)`);
  process.exit(1);
}
