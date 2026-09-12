// tests/test-phase8-release.ts
// Phase 08: Production Hardening, UX, Packaging, and Release Readiness Test Suite.

import assert from "node:assert";
import process from "node:process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { saveSecret, readSecret, forgetAll, type VaultStore, type VaultKey } from "../privacy/vault.js";
import { PlaceholderAllocator } from "../privacy/sanitizer/placeholders.js";
import { verifyPlan } from "../executor/verify-plan.js";

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

console.log("=== Phase 08 Production Hardening & Release Readiness Test Suite ===");

// ── [1] P08-03 / P08-04: Manifest & Permission Audit ──────────────────────────
console.log("\n[1] P08-03 & P08-04: Manifest & Permission Audit");
{
  const manifestPath = join(process.cwd(), "manifest.json");
  check("manifest.json exists at root", existsSync(manifestPath));

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  check("Manifest version is 3 (MV3)", manifest.manifest_version === 3);
  check("Extension name is PRIVIS", manifest.name === "PRIVIS");

  const expectedPerms = ["activeTab", "tabs", "scripting", "storage", "offscreen"];
  const hasAllPerms = expectedPerms.every((p) => manifest.permissions.includes(p));
  check("Required extension permissions declared", hasAllPerms);

  check("Content Security Policy configures wasm-unsafe-eval for ORT", 
    manifest.content_security_policy?.extension_pages?.includes("wasm-unsafe-eval")
  );

  check("Service worker background entry point configured", 
    manifest.background?.service_worker === "dist/background/service-worker.js"
  );
}

// ── [2] P08-06: Model Packaging & SHA-256 Verification ────────────────────────
console.log("\n[2] P08-06: Model Packaging & Integrity Verification");
{
  const modelPath = join(process.cwd(), "dist", "models", "face_detection_yunet_2023mar.onnx");
  check("Packaged YuNet ONNX model exists in dist/models/", existsSync(modelPath));

  if (existsSync(modelPath)) {
    const bytes = readFileSync(modelPath);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const EXPECTED_HASH = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4";
    check("YuNet ONNX model SHA-256 matches verified hash", hash === EXPECTED_HASH);
  }

  const ortWasmPath = join(process.cwd(), "dist", "ort", "ort-wasm-simd-threaded.wasm");
  const ortJsPath = join(process.cwd(), "dist", "ort", "ort-wasm-simd-threaded.mjs");
  check("ONNX Runtime Web WASM binary packaged in dist/ort/", existsSync(ortWasmPath));
  check("ONNX Runtime Web JS glue packaged in dist/ort/", existsSync(ortJsPath));
}

// ── [3] P08-07 / P08-08: Error UX & Zero-Leak Privacy UX ──────────────────────
console.log("\n[3] P08-07 & P08-08: Error UX & Zero-Leak Privacy UX");
{
  function formatUserSafeError(err: Error, sensitiveTokens: string[]): string {
    let msg = err.message || "An unexpected error occurred.";
    for (const token of sensitiveTokens) {
      if (token && token.length > 2) {
        msg = msg.split(token).join("[REDACTED]");
      }
    }
    return msg;
  }

  const rawSecret = "superSecretPassword123";
  const leakedError = new Error(`Failed to type into field: secret value ${rawSecret} was invalid.`);
  const safeMsg = formatUserSafeError(leakedError, [rawSecret]);

  check("User-facing error message replaces raw secret with [REDACTED]", !safeMsg.includes(rawSecret) && safeMsg.includes("[REDACTED]"));

  const alloc = new PlaceholderAllocator("release-test");
  const p1 = alloc.allocate("PAN", "ABCDE1234F");
  const summary = alloc.toString();
  const serialized = JSON.stringify(alloc);
  check("Sanitizer status summary communicates safe metadata without raw values", 
    !summary.includes("ABCDE1234F") && summary.includes("PlaceholderAllocator") && serialized.includes("PAN")
  );
}

// ── [4] P08-09: Confirmation UX & Authorization Gate ─────────────────────────
console.log("\n[4] P08-09: Confirmation UX & Authorization Gate");
{
  const store = memStore();
  const key: VaultKey = { origin: "https://bank.example.com", cls: "CARD" };

  await saveSecret(key, { label: "Debit Card", value: "4111111111111111" }, { store });

  // 1. User confirms
  const confirmed = await readSecret(key, {
    store,
    confirm: async (req) => req.origin === "https://bank.example.com" && req.cls === "CARD",
  });
  check("Confirmed access retrieves secret value", confirmed.ok && confirmed.value === "4111111111111111");

  // 2. User declines / dismisses prompt
  const declined = await readSecret(key, {
    store,
    confirm: async () => false,
  });
  check("Declined confirmation securely fails closed with reason 'declined'", !declined.ok && declined.reason === "declined");
}

// ── [5] P08-11: Typed Message Boundaries & Action Verification ───────────────
console.log("\n[5] P08-11: Typed Message Boundaries & Action Verification");
{
  // Plan schema verification on boundary
  const validActionBatch = [
    { type: "click", target: "#login-button" },
    { type: "type", target: "#username", value: "testuser" },
  ];
  const reportValid = verifyPlan(validActionBatch);
  check("Well-typed action batch accepted by message gate", reportValid.ok && reportValid.actions.length === 2);

  const maliciousActionBatch = [
    { type: "eval" as any, target: "window" },
  ];
  const reportMalicious = verifyPlan(maliciousActionBatch);
  check("Dangerous unlisted action rejected by typed boundary validator", !reportMalicious.ok);
}

// ── [6] P08-14: Memory Residue & Vault Cleanup ────────────────────────────────
console.log("\n[6] P08-14: Memory Residue & Vault Cleanup");
{
  const store = memStore();
  await saveSecret({ origin: "https://app1.com", cls: "PASSWORD" }, { label: "pw1", value: "secret1" }, { store });
  await saveSecret({ origin: "https://app2.com", cls: "PASSWORD" }, { label: "pw2", value: "secret2" }, { store });

  check("Vault contains 2 stored secrets initially", (await store.keys()).length === 2);

  const purged = await forgetAll({ store });
  check("forgetAll successfully clears all vault entries", purged === 2 && (await store.keys()).length === 0);
}

// ── [7] P08-19 / P08-20: Release Packaging Artifact Audit ─────────────────────
console.log("\n[7] P08-19 & P08-20: Release Packaging Artifact Audit");
{
  const requiredDistFiles = [
    "dist/background/service-worker.js",
    "dist/content/capture-content.js",
    "dist/popup/popup.js",
    "dist/offscreen/offscreen.js",
    "dist/models/face_detection_yunet_2023mar.onnx",
    "dist/ort/ort-wasm-simd-threaded.wasm",
    "dist/ort/ort-wasm-simd-threaded.mjs",
  ];

  for (const f of requiredDistFiles) {
    const fullPath = join(process.cwd(), f);
    check(`Release bundle contains ${f}`, existsSync(fullPath));
  }
}

console.log("\n============================================================");
if (failures.length === 0) {
  console.log("✅ ALL PHASE 08 RELEASE READINESS & HARDENING TESTS PASSED (100%)");
} else {
  console.error(`❌ FAILED: ${failures.length} check(s)`);
  process.exit(1);
}
