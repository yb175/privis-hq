# privacy/sanitizer/

**Owner:** background (canvas work happens off-screen in the service worker context).

## Responsibility

- Visual redaction: blur FACE boxes, black-out PASSWORD fields, mask PII text boxes on a canvas copy of the in-memory screenshot (`visual-redact.js`, background).
- Structural redaction + DOM-rule detection (`structural-redact.js`): regex PAN/Aadhaar/email/phone/amount + `input[type=password]` + name-labelled fields; replaces values with stable placeholders (`EMAIL_1`, `PAN_1`, `AADHAAR_1`, `AMOUNT_1`, `PHONE_1`, `NAME_1`).
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
