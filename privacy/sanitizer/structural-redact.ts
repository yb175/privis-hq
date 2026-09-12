// privacy/sanitizer/structural-redact.ts
// Sanitizer — structural placeholder replacement.
//
// Responsibilities:
// - Replaces sensitive values with stable, type-preserving tokens (EMAIL_1,
//   PAN_1, ...).
// - Isolates real values in a local lookup map (never emitted upstream).
//
// Detection is NOT done here: it lives in the Local Privacy Vision Engine
// (privacy/engine/detect-dom.ts for the DOM path, privacy/engine/vision/ for
// the vision path, fused in privacy/engine/fuse.ts). This module only
// sanitizes what the engine detected.
//
// Phase 01 contract (privacy/engine/normalize.ts):
// - Findings are normalized on entry; malformed findings throw PrivacyError
//   and abort the step (fail closed) — they are never silently skipped,
//   because a skipped finding means its raw value could cross the boundary.
// - A non-FACE detection whose element_id has no backing element is a
//   contract violation (stale capture / detector bug) and throws. Only
//   vision-source FACE detections may reference elements that do not exist
//   (fusion's synthetic "vision-<i>" ids) — they are redacted as pixels, not
//   text.
//
// Placeholder lifecycle: tokens are stable for the same logical value within
// a session (the remote agent may reference PAN_1 across steps). Real values
// are held in memory for the minimum lifetime that allows: resetPlaceholder-
// Tokens() is called at session start (orchestrator/runStep.ts), so the map
// never outlives the session that created it. Values never leave the device.

import type { Detection, ElementMeta } from "../../types/index.js";
import { normalizeDetections, PrivacyError } from "../engine/normalize.js";

// Session-stable tokens: the same real value always maps to the same placeholder
// (user@x.com is EMAIL_1 every step), and counters start per category.
// Reset per session via resetPlaceholderTokens(); values stay in memory only.
const tokenByValue = new Map<string, string>();
const nextIndex: Record<string, number> = {};

function tokenFor(category: Detection["category"], value: string): string {
  const key = `${category}\u0000${value}`;
  let token = tokenByValue.get(key);
  if (!token) {
    const n = (nextIndex[category] = (nextIndex[category] ?? 0) + 1);
    token = `${category}_${n}`;
    tokenByValue.set(key, token);
  }
  return token;
}

/**
 * Clears the placeholder→value mapping and category counters. Called at
 * session start so real values are retained only for the minimum lifetime
 * the multi-step session semantics require — never for the service-worker
 * lifetime.
 */
export function resetPlaceholderTokens(): void {
  tokenByValue.clear();
  for (const k of Object.keys(nextIndex)) delete nextIndex[k];
}

/**
 * Replaces sensitive values with stable placeholders and builds local mapping.
 *
 * Determinism: token assignment follows the elements array order (DOM query
 * order — stable for an unchanged page), and identical raw values always map
 * to the identical token (value-keyed). Malformed findings throw; a non-FACE
 * detection without a backing element throws (stale capture — its raw value
 * would otherwise cross the boundary un-placeholdered).
 *
 * @param elements Extracted DOM element metadata
 * @param detections Detected sensitive entities
 */
export function applyPlaceholders(
  elements: ElementMeta[],
  detections: Detection[]
): { sanitized: ElementMeta[]; map: Record<string, string> } {
  const valid = normalizeDetections(detections);
  const byId = new Map<string, Detection>();
  for (const d of valid) byId.set(d.element_id, d);

  const elementIds = new Set(elements.map((el) => el.element_id));

  const sanitized: ElementMeta[] = [];
  const map: Record<string, string> = {};

  for (const el of elements) {
    const d = byId.get(el.element_id);
    const text = el.text.trim();
    let out = el;
    if (d && text) {
      if (d.category === "PASSWORD") {
        // Password value is never extracted; redacted by input type, no placeholder.
        out = { ...el, text: "" };
      } else if (d.category === "FACE") {
        // Face is redacted as pixels only; never placeholder-swapped or text-blanked.
        out = el;
      } else {
        map[el.element_id] = el.text; // real value stays local, never sent to remote
        out = { ...el, text: tokenFor(d.category, el.text) };
      }
    }
    sanitized.push(out);
  }

  // Fail closed on findings that reference nothing: every non-FACE detection
  // must have a backing element whose value was considered above. FACE is the
  // documented exception (vision synthetic ids — pixel-only redaction).
  for (const d of valid) {
    if (d.category !== "FACE" && !elementIds.has(d.element_id)) {
      throw new PrivacyError(
        "INVALID_DETECTION",
        `detection "${d.element_id}" (${d.category}, ${d.source}) has no backing element — stale capture or detector contract violation`
      );
    }
  }

  return { sanitized, map };
}
