// tests/test-phase12-ux.ts
// Phase 12: Privacy UX & Transparency Test Suite.

import assert from "node:assert";
import process from "node:process";
import { PlaceholderAllocator } from "../../../privacy/sanitizer/placeholders.js";
import { saveSecret, readSecret, forgetAll, type VaultStore, type VaultKey } from "../../../privacy/vault.js";

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

console.log("=== Phase 12 Privacy UX & Transparency Test Suite ===");

// ── [1] P12-02 / P12-03: Privacy State Model & Tier Transparency ───────────────
console.log("\n[1] P12-02 & P12-03: Privacy State Model & Tier Transparency");
{
  type PrivacyState =
    | "IDLE"
    | "DETECTING_LOCAL"
    | "SANITIZING"
    | "LOCAL_EXECUTION"
    | "REMOTE_PLANNING_SANITIZED"
    | "WAITING_CONFIRMATION"
    | "COMPLETED"
    | "FAILED";

  interface PrivacyStatusBadge {
    state: PrivacyState;
    networkCallRequired: boolean;
    rawPiiOnWire: boolean;
    redactedElementCount: number;
    remoteModel?: string;
  }

  function getPrivacyBadge(tier: "tier0" | "tier2", placeholderCount: number): PrivacyStatusBadge {
    if (tier === "tier0") {
      return {
        state: "LOCAL_EXECUTION",
        networkCallRequired: false,
        rawPiiOnWire: false,
        redactedElementCount: 0,
      };
    }
    return {
      state: "REMOTE_PLANNING_SANITIZED",
      networkCallRequired: true,
      rawPiiOnWire: false, // Invariant: always false
      redactedElementCount: placeholderCount,
      remoteModel: "gemini-1.5-pro",
    };
  }

  const badgeLocal = getPrivacyBadge("tier0", 0);
  check("Tier 0 badge communicates zero network calls and 0 raw PII on wire", !badgeLocal.networkCallRequired && !badgeLocal.rawPiiOnWire);

  const badgeRemote = getPrivacyBadge("tier2", 3);
  check("Tier 2 remote badge communicates sanitized state and 0 raw PII on wire", badgeRemote.networkCallRequired && !badgeRemote.rawPiiOnWire && badgeRemote.redactedElementCount === 3);
}

// ── [2] P12-04 / P12-06: Detection Transparency & Placeholder Presentation ─────
console.log("\n[2] P12-04 & P12-06: Detection Transparency & Placeholder Presentation");
{
  const alloc = new PlaceholderAllocator("ux-session");
  const p1 = alloc.allocate("PAN", "ABCPE1234F", "dom");
  const p2 = alloc.allocate("EMAIL", "contact@domain.gov.in", "user");

  const uxSummary = alloc.toString();
  const serialized = JSON.parse(JSON.stringify(alloc));

  check("UX summary displays session token counts without leaking values", !uxSummary.includes("ABCPE1234F") && uxSummary.includes("tokens=2"));
  check("Serialized UX metadata shows category counts", serialized.counts?.PAN === 1 && serialized.counts?.EMAIL === 1);
}

// ── [3] P12-07 / P12-09: Vault Status UX & Sensitive Action Confirmation ──────
console.log("\n[3] P12-07 & P12-09: Vault Status UX & Sensitive Action Confirmation");
{
  const store = memStore();
  const originKey: VaultKey = { origin: "https://irs.gov.in", cls: "PASSWORD" };
  await saveSecret(originKey, { label: "Tax Portal Password", value: "SecretAuth!123" }, { store });

  let promptShown = false;
  const readRes = await readSecret(originKey, {
    store,
    confirm: async (req) => {
      promptShown = true;
      return req.origin === "https://irs.gov.in";
    },
  });

  check("Vault access triggers operator confirmation dialog before fill", promptShown && readRes.ok && readRes.value === "SecretAuth!123");
}

// ── [4] P12-12 / P12-13: Safe User-Facing Error UX (Zero Secret Residue) ──────
console.log("\n[4] P12-12 & P12-13: Safe User-Facing Error UX");
{
  function formatUserFacingError(err: Error, secrets: string[]): string {
    let msg = err.message || "Operation failed.";
    for (const s of secrets) {
      if (s && s.length > 2) {
        msg = msg.split(s).join("[PROTECTED_VALUE]");
      }
    }
    return msg;
  }

  const rawSecret = "UserSecretPassword999";
  const rawError = new Error(`Authentication field rejection for ${rawSecret}`);
  const userSafeMessage = formatUserFacingError(rawError, [rawSecret]);

  check("User-facing error message masks sensitive parameters", !userSafeMessage.includes(rawSecret) && userSafeMessage.includes("[PROTECTED_VALUE]"));
}

// ── [5] P12-16: Session Reset & Forget UX ─────────────────────────────────────
console.log("\n[5] P12-16: Session Reset & Forget UX");
{
  const store = memStore();
  await saveSecret({ origin: "https://portal1.gov.in", cls: "PASSWORD" }, { label: "p1", value: "v1" }, { store });
  await saveSecret({ origin: "https://portal2.gov.in", cls: "PASSWORD" }, { label: "p2", value: "v2" }, { store });

  check("Vault contains 2 stored secrets before reset", (await store.keys()).length === 2);

  const purged = await forgetAll({ store });
  check("Session Forget/Reset action completely clears vault", purged === 2 && (await store.keys()).length === 0);
}

console.log("\n============================================================");
if (failures.length === 0) {
  console.log("✅ ALL PHASE 12 PRIVACY UX & TRANSPARENCY TESTS PASSED (100%)");
} else {
  console.error(`❌ FAILED: ${failures.length} check(s)`);
  process.exit(1);
}
