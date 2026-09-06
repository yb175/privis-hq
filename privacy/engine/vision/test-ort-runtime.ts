// privacy/engine/vision/test-ort-runtime.ts
// ML-6A test harness for the ORT Web runtime foundation.
//
// Run from the repository root:  npm run test:vision
//
// Node cannot run Chrome APIs, so this installs a deterministic
// chrome.runtime.getURL stub that resolves extension-package-relative paths
// ("dist/...") to file:// URLs against the repo root — the same prefix
// semantics chrome.runtime.getURL has in the extension. No browser test
// framework is introduced.
//
// Exits 0 printing "ALL CHECKS PASSED" on success.

/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { getVisionRuntime } from "./ort-runtime.js";

const failures: string[] = [];
let stubCalls: string[] = [];

// Deterministic chrome.runtime.getURL stub: "dist/x" -> file://<repo>/dist/x.
// (cwd is the repo root because npm run test:vision runs there. Like the real
// chrome.runtime.getURL, a trailing slash in the path is preserved.)
(globalThis as Record<string, unknown>).chrome = {
  runtime: {
    getURL: (path: string): string => {
      stubCalls.push(path);
      const abs = resolve(path);
      return pathToFileURL(path.endsWith("/") ? abs + "/" : abs).href;
    },
  },
};

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures.push(name + (detail ? ` (${detail})` : ""));
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function expectRejection(name: string, fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  failures.push(name);
  console.log(`  FAIL ${name} — expected rejection, call succeeded`);
  return null;
}

async function main(): Promise<void> {
  // --- 1 + 2. Initialization succeeds and the WASM asset path resolves ---
  const rt = await getVisionRuntime();
  check("runtime initialization succeeds", rt.wasmAssetUrl.startsWith("file://"), rt.wasmAssetUrl);
  // ORT's WASM-only build (onnxruntime-web@1.29.0) dynamically loads exactly
  // these two files from env.wasm.wasmPaths — both must be packaged in dist/ort/.
  check(
    "WASM glue asset packaged (dist/ort/ort-wasm-simd-threaded.mjs)",
    existsSync(new URL("ort-wasm-simd-threaded.mjs", rt.wasmAssetUrl))
  );
  check(
    "WASM binary asset packaged (dist/ort/ort-wasm-simd-threaded.wasm)",
    existsSync(new URL("ort-wasm-simd-threaded.wasm", rt.wasmAssetUrl))
  );

  // --- 3. Missing/invalid model fails explicitly (never silently succeeds) ---
  const badBytes = await expectRejection(
    "invalid model bytes rejected explicitly", () =>
      rt.createSession(new Uint8Array([0x01, 0x02, 0x03])));
  check(
    "invalid model error names the cause",
    badBytes !== null && /model|protobuf|session|backend/i.test(badBytes),
    badBytes ?? ""
  );
  const badUrl = await expectRejection(
    "missing model URL rejected explicitly", () =>
      rt.createSession(pathToFileURL(resolve("dist/ort/does-not-exist.onnx")).href));
  check("missing model URL rejected", badUrl !== null);

  // --- 4. No network is used: block fetch, then prove the WASM runtime still
  //        loads (the garbage-bytes session attempt reaches ONNX's own model
  //        parser, which is only possible after the .mjs + .wasm loaded). ---
  const realFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = () =>
    Promise.reject(new Error("network access blocked by test"));
  try {
    const blocked = await expectRejection(
      "session attempt with fetch disabled", () =>
        rt.createSession(new Uint8Array([0x01, 0x02, 0x03])));
    check(
      "WASM runtime loaded without network (error is model parsing, not fetch)",
      blocked !== null && /model|protobuf/i.test(blocked),
      blocked ?? ""
    );
  } finally {
    (globalThis as Record<string, unknown>).fetch = realFetch;
  }
  // Static source audit: the wrapper itself must reference no network or
  // persistence mechanism. chrome.runtime.getURL (extension-local assets) is
  // the only URL-producing call allowed.
  const source = readFileSync("privacy/engine/vision/ort-runtime.ts", "utf-8");
  for (const forbidden of [
    "http://", "https://", "ws://", "localhost", "fetch(", "XMLHttpRequest",
    "WebSocket", "chrome.storage", "indexedDB", "navigator.sendBeacon",
  ]) {
    check(`wrapper source free of "${forbidden}"`, !source.includes(forbidden));
  }
  // Every chrome.runtime.getURL call resolved inside the packaged dist/ tree.
  check(
    "all asset lookups stay inside dist/ort/",
    stubCalls.length > 0 && stubCalls.every((p) => p === "dist/ort/"),
    stubCalls.join(", ")
  );

  // --- 5. Initialization is idempotent (shared, never re-initialized) ---
  const callsBefore = stubCalls.length;
  const [a, b, c] = await Promise.all([
    getVisionRuntime(), getVisionRuntime(), getVisionRuntime(),
  ]);
  check("repeated + concurrent calls share one runtime", a === b && b === c);
  check("no re-initialization on repeat calls", stubCalls.length === callsBefore);

  if (failures.length === 0) {
    console.log("ALL CHECKS PASSED");
  } else {
    console.error(`FAILED: ${failures.length} check(s)`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("HARNESS ERROR:", err);
  process.exit(1);
});
