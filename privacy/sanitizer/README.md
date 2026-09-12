# privacy/sanitizer/

**Owner:** background (canvas work happens off-screen in the service worker context).

## Responsibility

- Visual redaction: blur FACE boxes, black-out PASSWORD fields, mask PII text boxes on a canvas copy of the in-memory screenshot (`visual-redact.js`, background).
- Structural redaction (`structural-redact.js`): replaces values with stable placeholders (`EMAIL_1`, `PAN_1`, `AADHAAR_1`, `AMOUNT_1`, `PHONE_1`, `NAME_1`); keeps the placeholder→real-value mapping on-device. Detection itself lives in the engine (`privacy/engine/detect-dom.js`).
- Preserve layout, button labels, form structure, and all non-sensitive text.
- Keep the placeholder→real-value mapping table on-device only.

## Inputs

- In-memory screenshot + detections list from the Local Privacy Vision Engine + element metadata.

## Outputs

- Sanitized screenshot (canvas data) + sanitized context (JSON with placeholders).

## Forbidden

- Writing the canvas or mapping table to disk/storage.
- Sending the mapping table off-device.
- Redacting button labels or form structure — the Remote Agent must still be able to navigate.

## Phase 01 hardening (detection/redaction contract)

Both sanitizer halves fail closed instead of skipping:

- `applyPlaceholders` (structural) normalizes all findings on entry
  (`privacy/engine/normalize.ts`) and throws `PrivacyError` on a malformed
  finding — a skipped finding means its raw value could cross the boundary.
  A non-FACE finding whose `element_id` has no backing element also throws
  (stale capture). Vision-source FACE findings with synthetic `vision-*` ids
  are the documented exception — they are redacted as pixels only.
  `resetPlaceholderTokens()` is called at session start by the orchestrator,
  so real values are retained in the local map only for the session's
  lifetime, not the service worker's.
- `redactVisual` (visual) validates every bbox with `assertValidBBox` before
  painting: NaN/Infinity/zero/negative dimensions throw and abort the step —
  never a silently un-redacted region. Valid boxes that fall fully outside
  the canvas clamp to a no-op.

## Swapping the DOM heuristics for a real ML pipeline

The Sanitizer is decoupled from *how* detections are produced — it only consumes a
`Detection[]` and keys on `element_id` + `category` + `source`. So swapping the model in
never touches `applyPlaceholders`; it replaces the thing that *emits* the detections.

Today `detectSensitive(elements)` is a DOM-regex stand-in for the **Local Privacy Vision
Engine** (README-only until the ML team lands it, issue #21). A real ML pipeline replaces
that stand-in's *role* (produce a `Detection[]`), not the Sanitizer's redaction functions.

### Flow after the swap

```
DOM heuristics ─► Detection[] {source:"dom"}   ┐
                                               ├─► applyPlaceholders(elements, Detection[])
ML vision model ─► Detection[] {source:"vision"} ┘      + redactVisual(bbox) for pixel-only PII
                              (both fused by the engine)
```

### Three rules that keep it working

1. **Keep `element_id` aligned.** The ML engine must map its bounding boxes onto the same
   `element_id` values `dom-extractor` emits. `applyPlaceholders` redacts DOM text by
   `element_id` — if the id doesn't line up, the structural swap silently does nothing.
2. **Route pixel-only PII to `redactVisual`, not `applyPlaceholders`.** A PII region with
   no backing DOM `text` (e.g. an unlabeled FACE, or text only the model can see) has
   nothing to token-swap. Mask it by `bbox` on the canvas; `applyPlaceholders` only swaps
   `ElementMeta.text`.
3. **The `map` stays local regardless of confidence/source.** A model brings its own
   confidence and false-positive profile; it just flows through. The `element_id → real
   value` map is built in `applyPlaceholders` and never enters the sanitized output, so
   no model output changes the privacy boundary.

### Swap procedure

1. Implement the engine (issue #21) so it emits one `Detection[]` fused from
   `source:"dom"` heuristics + `source:"vision"` model boxes.
2. In the Sanitizer, replace the call to `detectSensitive(elements)` with the engine result;
   leave `applyPlaceholders(elements, detections)` as-is.
3. Point `redactVisual` at every bounding box the engine reports (dom + vision), not just
   the DOM ones, so pixel-only PII is masked too.
4. Re-run the fixtures: category + placeholder tokens must match `fixtures/sanitized-context.json`
   shape; the face/password elements stay intact.

No rule here depends on `source` — `dom` and `vision` detections are interchangeable
inputs to the Sanitizer from the day the model lands.
