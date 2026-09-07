// utils/digest.ts
// Computes SHA-256 digest of serialized payloads for tampering verification

export const TRANSPARENCY_STORAGE_KEY = "privis_transparency_log";

/**
 * Computes a deterministic SHA-256 hex digest of the canonical JSON payload.
 */
export async function computeRequestDigest(request: unknown): Promise<string> {
  const json = JSON.stringify(request);
  const encoder = new TextEncoder();
  const data = encoder.encode(json);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
