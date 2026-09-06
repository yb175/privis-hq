# ml/fusion/ — DOM + vision detection fusion (ML-4)

Fuses the existing DOM detection output with ML-1/ML-3 vision detections
into one `Detection[]`-shaped list (the contract shape from `CONTRACT.md` /
`types/index.ts`). Pure Python stdlib — no network, no LLM, no model, no
browser API. The runtime TypeScript integration (inside the extension's
Local Privacy Vision Engine) is M5; this module is the dev-side, tested
implementation of the fusion algorithm.

## Inputs

| Input | Shape | Producer |
|---|---|---|
| `elements` | `ElementMeta[]` | Capture Layer content script (`utils/dom-extractor.ts`) |
| `dom_detections` | `Detection[]`, `source:"dom"` | existing `detectSensitive()` in `privacy/sanitizer/structural-redact.ts` — **not duplicated here** |
| `vision_detections` | `{category, bbox, confidence, source:"vision"}` | ML-1 (`face_detector.py`) + ML-3 (`pii_classifier.py`) |
| `screenshot` | `{w, h}` | screenshot pixel dimensions |
| `viewport` | `{w, h}` | CSS viewport dimensions |

Only `element_id` and `bbox` are read from elements — `text`/`label` values
are never accessed, copied, or emitted.

## Output

One dict per detection, exactly the contract `Detection` keys:
`{element_id, category, bbox, confidence, source}`. DOM-only categories
(e.g. `PASSWORD`) pass through unchanged with `source:"dom"`.

## Coordinate systems and scaling

DOM bboxes are **CSS viewport pixels** (`getBoundingClientRect`). Vision
bboxes are **screenshot pixels**. Vision boxes are converted before matching:

```
sx = viewport.w / screenshot.w      sy = viewport.h / screenshot.h
css_bbox = [round(x*sx), round(y*sy), round(w*sx), round(h*sy)]
```

Equal screenshot/viewport dimensions → `sx = sy = 1` → coordinates unchanged.
Rounding to integers keeps output deterministic. (Scroll offset is not
needed: the capture pipeline screenshots the visible viewport.)

## Matching

- **Metric:** IoU between the scaled vision bbox and each element bbox.
- **Threshold:** `IOU_THRESHOLD = 0.3` — below it, no match.
- **Best candidate:** highest IoU; **ties break to the element appearing
  earlier in the `elements` list** (deterministic).
- **Multiple overlapping DOM elements:** the highest-IoU element wins;
  ties by list order. One vision detection matches at most one element.

## Duplicate handling (DOM + vision agree)

Detections are keyed by `(element_id, category)`:

1. DOM detections are inserted first (input order).
2. A matched vision detection with an existing key replaces it **only if
   its confidence is strictly higher**; ties keep the DOM detection (the
   deterministic signal is preferred).
3. Exactly one detection is emitted per `(element, category)`.

So a DOM EMAIL (0.95) plus a vision EMAIL (0.65) on the same element emits
one EMAIL detection, `source:"dom"`, confidence 0.95. If vision is stronger
(0.99), the emitted detection is the vision one — same `element_id`, same
category, vision bbox (in CSS space), `source:"vision"`.

## Unmatched vision detections

- **FACE** (matched or not) is **never discarded** — it is inherently visual
  and routinely has no DOM element. An unmatched FACE keeps a synthetic
  stable id `vision-<i>` (`i` = index in the vision input list). This is
  contract-compatible and justified by the existing architecture:
  `redactVisual()` redacts by `bbox` + `category` only and never resolves
  `element_id`; `applyPlaceholders()` safely ignores ids with no backing
  element (pixel redaction still applies, structural swap is a no-op).
- **Other categories with no matching element are skipped** (documented
  limitation): the structural placeholder machinery works on real DOM
  element ids, and M4 prefers skipping over inventing ids for text
  categories. Recall for DOM-invisible text PII (canvas, images) improves
  in a later milestone.

## Limitations

- IoU matching is rectangle-only; a vision box spanning several elements
  matches only its best-overlapping one.
- One vision detection per (element, category) merge — two vision boxes of
  the same category matching the same element collapse to the strongest.
- Unmatched non-FACE detections are dropped (see above).
- `vision-<i>` ids are stable per fusion call, not across steps.

## Privacy

- 100% local, pure stdlib, no network/LLM/browser API.
- Inputs handled in memory; nothing persisted by the library. The dev CLI
  reads one JSON file you give it and prints ids/categories/bboxes/
  confidences only — never element text.
- All test data is synthetic.

## Usage

```bash
# Unit tests:
.venv-ml/Scripts/python.exe ml/fusion/test_fuse.py

# CLI: one JSON file with elements, dom_detections, vision_detections,
# screenshot, viewport:
.venv-ml/Scripts/python.exe ml/fusion/fuse.py fusion_input.json
```

Library: `from fuse import fuse_detections`.

## Files

| File | Purpose |
|------|---------|
| `fuse.py` | Fusion library (`fuse_detections`, `iou`, `scale_bbox`) + CLI |
| `test_fuse.py` | Unit tests (17 behavior checks) |
