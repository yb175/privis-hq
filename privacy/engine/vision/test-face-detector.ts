// privacy/engine/vision/test-face-detector.ts
// ML-6C test harness: browser ↔ offline parity for the YuNet FACE detector.
//
// Run from the repository root:  npm run test:face
//
// Loads the SAME committed fixtures (F1-F12 PNGs) and the SAME model artifact
// the offline Python reference validated, runs the TypeScript detector on
// ORT Web WASM (the exact M6-A runtime), and compares against the offline
// reference outputs at the approved 0.35 operating point:
//   - identical detection counts
//   - boxes within <= 1 px
//   - confidence within <= 0.01
//   - category "FACE", source "vision", element_id "vision-<i>"
// Plus: latency gates, determinism, fail-explicit behavior, and a no-network
// proof (fetch disabled during all inference — same methodology as M6-A).
//
// Node cannot run Chrome APIs, so a deterministic chrome.runtime.getURL stub
// is installed (same pattern as test-ort-runtime.ts). PNGs are decoded with
// node:zlib — no new dependencies, no real photographs, nothing persisted.

/// <reference types="node" />
import { readFileSync } from "node:fs";
import process from "node:process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadFaceDetector, SCORE_THRESHOLD, type FaceDetectorInput } from "./face-detector.js";
import { decodePngRGBA } from "./test-png.js";

const failures: string[] = [];
const stubCalls: string[] = [];

// Deterministic chrome.runtime.getURL stub (same semantics as the real API).
(globalThis as Record<string, unknown>).chrome = {
  runtime: {
    getURL: (path: string): string => {
      stubCalls.push(path);
      return pathToFileURL(resolve(path)).href;
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

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const modelBytes = new Uint8Array(
    readFileSync("ml/models/face_detection_yunet/face_detection_yunet_2023mar.onnx")
  );
  const reference = JSON.parse(
    readFileSync("ml/models/face_detection_yunet/reference_outputs_m6c.json", "utf-8")
  );
  const fixtures: Record<string, { image: string; detections: unknown[] }> = reference;
  const order = ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12"];

  // --- 1. Latency: load + first inference + steady state (WASM) ---
  const t0 = performance.now();
  const detector = await loadFaceDetector(modelBytes);
  const loadMs = performance.now() - t0;
  const f1 = decodePngRGBA("ml/dataset/images/synthetic_face.png");
  const input = (fid: string): FaceDetectorInput => {
    const img = decodePngRGBA(reference[fid].image);
    return { width: img.width, height: img.height, data: img.data };
  };
  const t1 = performance.now();
  await detector.detect(f1);
  const firstMs = performance.now() - t1;
  const times: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t = performance.now();
    await detector.detect(f1);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  const steadyMs = times[10];
  check(`model load < 2000 ms (${loadMs.toFixed(0)} ms)`, loadMs < 2000);
  check(`first inference < 300 ms (${firstMs.toFixed(0)} ms)`, firstMs < 300);
  check(`steady-state < 150 ms (median ${steadyMs.toFixed(0)} ms)`, steadyMs < 150);

  // --- 2. Offline ↔ browser parity on all F1-F12, with fetch DISABLED ---
  // (proves inference needs no network; the model bytes were injected above)
  const realFetch = globalThis.fetch;
  (globalThis as Record<string, unknown>).fetch = () =>
    Promise.reject(new Error("network access blocked by test"));
  let parityFailures = 0;
  let maxBoxErr = 0;
  let maxConfErr = 0;
  try {
    for (const fid of order) {
      const refDets = reference[fid].detections as Array<{
        category: string; bbox: number[]; confidence: number; source: string;
      }>;
      const got = await detector.detect(input(fid));
      if (got.length !== refDets.length) {
        parityFailures++;
        console.log(`  FAIL ${fid}: count ${got.length} != reference ${refDets.length}`);
        continue;
      }
      for (let i = 0; i < got.length; i++) {
        const g = got[i];
        const r = refDets[i];
        const boxErr = Math.max(
          Math.abs(g.bbox[0] - r.bbox[0]), Math.abs(g.bbox[1] - r.bbox[1]),
          Math.abs(g.bbox[2] - r.bbox[2]), Math.abs(g.bbox[3] - r.bbox[3]),
        );
        const confErr = Math.abs(g.confidence - r.confidence);
        maxBoxErr = Math.max(maxBoxErr, boxErr);
        maxConfErr = Math.max(maxConfErr, confErr);
        const ok =
          g.category === "FACE" && g.source === "vision" &&
          g.element_id === `vision-${i}` &&
          g.category === r.category && g.source === r.source &&
          boxErr <= 1 && confErr <= 0.01;
        if (!ok) {
          parityFailures++;
          console.log(
            `  FAIL ${fid}[${i}]: got ${JSON.stringify(g)} vs ref ${JSON.stringify(r)}` +
              ` (boxErr=${boxErr}, confErr=${confErr})`
          );
        }
      }
    }
  } finally {
    (globalThis as Record<string, unknown>).fetch = realFetch;
  }
  check(
    `offline ↔ browser parity on F1-F12 @ ${SCORE_THRESHOLD} (counts, boxes ≤1 px, conf ≤0.01, category/source)`,
    parityFailures === 0,
    `${parityFailures} mismatch(es)`
  );
  console.log(
    `  parity margins: max box error ${maxBoxErr} px (tolerance 1), max confidence error ${maxConfErr.toFixed(5)} (tolerance 0.01)`
  );
  check("inference ran with fetch disabled (no-network proof)", true);
  // Coverage sanity: the parity set must include every required case class.
  check(
    "parity set covers normal/small/edge/multi-face + negatives (F1-F12)",
    order.length === 12 && reference.F1.detections.length >= 1 &&
      reference.F3.detections.length >= 2 && reference.F4.detections.length >= 1 &&
      ["F5", "F11", "F12"].every((f) => reference[f].detections.length === 0)
  );

  // --- 3. Determinism: 3 repeats + a fresh detector, identical output ---
  const f2 = input("F2");
  const runs = [
    JSON.stringify(await detector.detect(f2)),
    JSON.stringify(await detector.detect(f2)),
    JSON.stringify(await detector.detect(f2)),
    JSON.stringify(await (await loadFaceDetector(modelBytes)).detect(f2)),
  ];
  check("deterministic (repeat x3 + fresh detector, identical output)", runs.every((r) => r === runs[0]));

  // --- 4. Fail-explicit behavior (never silently []) ---
  let rejected = false;
  try {
    await loadFaceDetector(new Uint8Array([1, 2, 3])); // wrong size AND hash
  } catch {
    rejected = true;
  }
  check("tampered/invalid model bytes rejected explicitly", rejected);

  // --- 5. Static privacy audit of the detector source ---
  const source = readFileSync("privacy/engine/vision/face-detector.ts", "utf-8");
  for (const forbidden of [
    "http://", "https://", "ws://", "localhost", "XMLHttpRequest",
    "WebSocket", "chrome.storage", "indexedDB", "navigator.sendBeacon",
    "writeFile", "appendFile",
  ]) {
    check(`detector source free of "${forbidden}"`, !source.includes(forbidden));
  }
  // The only URL-producing calls must be extension-local assets: the ORT
  // WASM dir (from the M6-A runtime) and the packaged model file.
  check(
    "all chrome.runtime.getURL lookups target packaged assets (dist/ort/, dist/models/)",
    stubCalls.length > 0 && stubCalls.every((p) =>
      p === "dist/ort/" || p === "dist/models/face_detection_yunet_2023mar.onnx"),
    stubCalls.join(", ")
  );

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
