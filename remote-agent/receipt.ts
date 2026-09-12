// remote-agent/receipt.ts
// The outbound boundary's independent verification of the gate's receipt.
//
// PROVENANCE: ported from the approved reference repo PravAl2028/SIH26171,
// extension/src/worker/receipt.ts (author-granted permission, Phase 01),
// adapted to PRIVIS's data-URL wire format.
//
// Recomputes SHA-256 over the bytes about to be sent and the digest over the
// canonicalised manifest, and compares both against the receipt the gate
// stamped. A mismatch is not a warning: the step fails and nothing leaves the
// device.
//
// "Independent" is the whole value. The gate already refuses to encode an
// unsealed canvas, but that check runs inside the module it is protecting —
// one refactor, one caching layer between seal and encode, and it protects
// nothing. This check runs at the moment of transmission, over the bytes as
// they actually are, and does not care how they got there.
//
// Node-pure: data in, verdict out.

import type { RedactionManifest } from "../types/index.js";
import { canonicaliseManifest, dataUrlToBytes, digest } from "../privacy/sanitizer/redaction-gate.js";

export interface VerificationResult {
  ok: boolean;
  /** Machine-readable reason on failure, e.g. "image-digest-mismatch". */
  reason?:
    | "no-manifest"
    | "unknown-digest-algorithm"
    | "receipt-not-completed"
    | "image-digest-mismatch"
    | "manifest-digest-mismatch";
  /** What was expected and what was found, for the step log. Never the bytes. */
  detail?: { expected: string; actual: string };
}

/**
 * Verify the receipt of a sanitized package against the screenshot bytes that
 * are about to cross the wire.
 */
export async function verifyReceipt(
  sanitizedScreenshot: string,
  manifest: RedactionManifest | undefined
): Promise<VerificationResult> {
  if (!manifest) return { ok: false, reason: "no-manifest" };

  const receipt = manifest.receipt;
  if (receipt.algo !== "SHA-256") {
    return { ok: false, reason: "unknown-digest-algorithm" };
  }
  if (!receipt.hash) {
    // seal() leaves this empty and encode() fills it. An empty hash here
    // means the payload never went through the gate at all.
    return { ok: false, reason: "receipt-not-completed" };
  }

  const actualImage = await digest(dataUrlToBytes(sanitizedScreenshot));
  if (actualImage !== receipt.hash) {
    return {
      ok: false,
      reason: "image-digest-mismatch",
      detail: { expected: receipt.hash, actual: actualImage },
    };
  }

  const allowedManifestKeys = new Set(["counts", "redactedFraction", "overRedactedFraction", "policyVersion", "receipt"]);
  const allowedReceiptKeys = new Set(["algo", "hash", "manifestHash", "sealedAt"]);
  if (
    Object.keys(manifest).some((key) => !allowedManifestKeys.has(key)) ||
    Object.keys(receipt).some((key) => !allowedReceiptKeys.has(key))
  ) {
    return { ok: false, reason: "manifest-digest-mismatch" };
  }

  const { receipt: _receipt, ...withoutReceipt } = manifest;
  const actualManifest = await digest(
    new TextEncoder().encode(canonicaliseManifest(withoutReceipt))
  );
  if (actualManifest !== receipt.manifestHash) {
    return {
      ok: false,
      reason: "manifest-digest-mismatch",
      detail: { expected: receipt.manifestHash, actual: actualManifest },
    };
  }

  return { ok: true };
}
