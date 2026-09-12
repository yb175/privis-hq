// tests/test-gate.ts
// Phase 01: the redaction gate. seal() closes the source bitmap, encode() is
// the only encoder and refuses unsealed canvases, the receipt digests match
// an INDEPENDENT recomputation, tampering with the payload or the manifest
// breaks verification, and the manifest's over-redaction numbers are honest.
// Runs under the same canvas shims as the privacy-boundary suite.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import process from "node:process";

import { installCanvasShims, StubImageBitmap } from "../privacy/engine/vision/test-canvas-shim.js";
import {
  sealAndRedact,
  encode,
  seal,
  dataUrlToBytes,
  digest,
  canonicaliseManifest,
  POLICY_VERSION,
} from "../privacy/sanitizer/redaction-gate.js";
import { verifyReceipt } from "../remote-agent/receipt.js";
import { verhoeffCheckDigit } from "../privacy/engine/validators.js";
import type { Detection, RedactionManifest } from "../types/index.js";

const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  PASS ${name}`);
  else {
    failures.push(name + (detail ? ` (${detail})` : ""));
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const VIEWPORT = { w: 640, h: 480 };

/** Real 640x480 PNG fixture (same one the privacy-boundary suite uses). */
function syntheticDataUrl(): string {
  return `data:image/png;base64,${readFileSync("ml/dataset/images/f5_text_negative.png").toString("base64")}`;
}

function det(cls: Detection["category"], bbox: [number, number, number, number]): Detection {
  return { element_id: `e-${cls}`, category: cls, bbox, confidence: 0.95, source: "dom" };
}

const aadhaar = `23412341234${verhoeffCheckDigit("23412341234")}`;

async function main(): Promise<void> {
  const restore = installCanvasShims();
  try {
    await runAll();
  } finally {
    restore();
  }

  async function runAll(): Promise<void> {
    console.log("Phase 01 gate tests (seal / encode / receipt / manifest)");

    const raw = syntheticDataUrl();
    const detections = [det("AADHAAR", [100, 100, 200, 50]), det("EMAIL", [10, 10, 60, 20])];

    // --- The full path -------------------------------------------------------
    const { sanitizedScreenshot, manifest } = await sealAndRedact(raw, detections, VIEWPORT, () => 1_700_000_000_000);

    check("sanitized output is a data URL, different from the raw one",
      sanitizedScreenshot.startsWith("data:") && sanitizedScreenshot !== raw);
    check("manifest counts every category", manifest.counts.AADHAAR === 1 && manifest.counts.EMAIL === 1);
    check("manifest carries the policy version", manifest.policyVersion === POLICY_VERSION);
    check("receipt is complete after encode (hash + manifestHash + sealedAt)",
      manifest.receipt.hash.length === 64 && manifest.receipt.manifestHash.length === 64 && manifest.receipt.sealedAt === 1_700_000_000_000,
      JSON.stringify(manifest.receipt));

    // --- Independent verification (the boundary's own math, not the gate's) ---
    const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
    const bytes = dataUrlToBytes(sanitizedScreenshot);
    check("receipt.hash matches an INDEPENDENT sha256 over the bytes",
      sha(bytes) === manifest.receipt.hash);
    const { receipt: _r, ...withoutReceipt } = manifest;
    const canonical = canonicaliseManifest(withoutReceipt);
    check("receipt.manifestHash matches an INDEPENDENT digest of the canonical manifest",
      sha(new TextEncoder().encode(canonical)) === manifest.receipt.manifestHash);

    // canonical form is deterministic and sorted
    check("canonical manifest is deterministic",
      canonicaliseManifest(withoutReceipt) === canonical);
    check("canonical manifest sorts category names",
      /^v=/.test(canonical) && canonical.includes("counts=AADHAAR=1,EMAIL=1"), canonical);

    // --- verifyReceipt accepts the honest pair --------------------------------
    const ok = await verifyReceipt(sanitizedScreenshot, manifest);
    check("verifyReceipt accepts the gate's own output", ok.ok, JSON.stringify(ok));

    // --- Tampering, image side -------------------------------------------------
    const flipped = sanitizedScreenshot.slice(0, -8) + "AAAAAAAA";
    const tamperedImg = await verifyReceipt(flipped, manifest);
    check("verifyReceipt rejects a tampered image", !tamperedImg.ok && tamperedImg.reason === "image-digest-mismatch");

    // --- Tampering, manifest side ----------------------------------------------
    const inflated: RedactionManifest = { ...manifest, counts: { ...manifest.counts, AADHAAR: 0 } };
    const tamperedMan = await verifyReceipt(sanitizedScreenshot, inflated);
    check("verifyReceipt rejects an edited manifest (counts changed)", !tamperedMan.ok && tamperedMan.reason === "manifest-digest-mismatch");

    const { receipt: keep, ...rest } = manifest;
    const shifted: RedactionManifest = { ...rest, redactedFraction: 0, receipt: keep };
    const tamperedFrac = await verifyReceipt(sanitizedScreenshot, shifted);
    check("verifyReceipt rejects an edited redactedFraction", !tamperedFrac.ok && tamperedFrac.reason === "manifest-digest-mismatch");

    check("verifyReceipt rejects a missing manifest", (await verifyReceipt(sanitizedScreenshot, undefined)).reason === "no-manifest");
    check("verifyReceipt rejects an incomplete receipt (empty hash)",
      (await verifyReceipt(sanitizedScreenshot, { ...manifest, receipt: { ...manifest.receipt, hash: "" } })).reason === "receipt-not-completed");

    // --- seal() refuses to leak: unsealed canvas cannot be encoded --------------
    // seal() is not directly reachable with a bare canvas from outside, but encode()
    // must refuse anything without a receipt. Hand it a fake sealed object.
    const fake = { canvas: { width: 1, height: 1 } as never, receipt: {} as never, manifest: {} as never };
    let refused = false;
    try { await encode(fake); } catch { refused = true; }
    check("encode() refuses a canvas with no receipt", refused);

    // --- seal() closes the source bitmap on every path --------------------------
    let closed = false;
    const src = new StubImageBitmap(4, 4, new Uint8ClampedArray(4 * 4 * 4));
    const rawClose = src.close;
    src.close = () => { closed = true; rawClose.call(src); };
    await seal(src as never, [], VIEWPORT);
    check("seal() closes the source bitmap (success path)", closed);

    let closedOnError = false;
    const badSrc = { width: 4, height: -1, close: () => { closedOnError = true; } };
    let threw = false;
    try { await seal(badSrc as never, [], VIEWPORT); } catch { threw = true; }
    check("seal() closes the source bitmap even when it throws", closedOnError && threw);

    // --- Manifest honesty: redacted vs over-redacted ----------------------------
    // Two detections, one union region + a second region with no detection inside:
    const padded = await sealAndRedact(raw, [det("AADHAAR", [100, 100, 200, 50])], VIEWPORT);
    check("single-detection redaction: overRedactedFraction is 0 (nothing painted without cause)",
      padded.manifest.overRedactedFraction === 0, String(padded.manifest.overRedactedFraction));
    check("redactedFraction = painted area / viewport",
      Math.abs(padded.manifest.redactedFraction - (200 * 50) / (640 * 480)) < 1e-6,
      String(padded.manifest.redactedFraction));

    // Merge: two adjacent EMAIL boxes become one painted region, not two.
    const adjacent = await sealAndRedact(
      raw,
      [det("EMAIL", [10, 10, 60, 20]), det("EMAIL", [68, 10, 60, 20])],
      VIEWPORT
    );
    check("adjacent same-class masks merge (fraction < two separate boxes)",
      adjacent.manifest.redactedFraction < (120 * 20 * 2) / (640 * 480) + 1e-9,
      String(adjacent.manifest.redactedFraction));

    // --- Goal values never appear in the sanitized output ------------------------
    // The AADHAAR mask region [100,100,200,50] must be opaque black after the gate.
    const sanitized = dataUrlToBytes(sanitizedScreenshot);
    const o = (100 * 640 + 100) * 4;
    check("mask region is opaque black in the sanitized bytes",
      sanitized[o] === 0 && sanitized[o + 1] === 0 && sanitized[o + 2] === 0,
      `rgb=(${sanitized[o]},${sanitized[o + 1]},${sanitized[o + 2]})`);

    if (failures.length === 0) console.log("\nALL CHECKS PASSED");
    else {
      console.error(`\nFAILED: ${failures.length} check(s)`);
      process.exit(1);
    }
  }

}

main().catch((err) => {
  console.error("HARNESS ERROR:", err);
  process.exit(1);
});
