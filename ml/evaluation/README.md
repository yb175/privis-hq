# ml/evaluation/ — privacy detection evaluation and metrics (ML-5)

Local, deterministic evaluation harness for PRIVIS privacy detections.
Compares predicted `Detection[]`-compatible dicts (the contract shape from
`CONTRACT.md` / `types/index.ts`: `{element_id, category, bbox, confidence,
source}`) against ground-truth detections and reports TP/FP/FN, precision,
recall, F1 — aggregate and per-category. Pure Python stdlib: no network, no
cloud API, no LLM, no model, no screenshots.

## Metric definitions

Per category and aggregated over all categories:

| Metric | Formula | Zero denominator |
|---|---|---|
| precision | `TP / (TP + FP)` | 0.0 |
| recall | `TP / (TP + FN)` | 0.0 |
| F1 | `2·P·R / (P + R)` | 0.0 |

- A **true positive** is a prediction matched one-to-one to a ground truth.
- A **false positive** is an unmatched prediction.
- A **false negative** is an unmatched ground truth.

## Matching rules (deterministic, one-to-one)

1. **Category must match exactly.** A PAN prediction never matches an
   AADHAAR ground truth (that is one FP + one FN, not a credit).
2. **`source: "dom"` predictions match by element identity**: the same
   `element_id` on a same-category ground truth. DOM bboxes come from
   `getBoundingClientRect()` — the element id *is* the truth; geometry is
   not consulted (a dom prediction with a different element_id never
   matches, even with an identical box).
3. **`source: "vision"` predictions match spatially: IoU ≥ 0.5** against a
   same-category ground truth. This covers vision-vs-vision and
   vision-prediction-vs-DOM-ground-truth (by the time detections reach
   `Detection[]`, ML-4 fusion has already put all boxes in one coordinate
   space). The element_id on a vision prediction is ignored for matching.
4. **One-to-one:** each ground truth and each prediction is used at most
   once — no double counting in either direction.
5. **Deterministic order:** element-identity pairs are assigned first (in
   ground-truth then prediction input order); spatial pairs are then
   assigned best-IoU-first, ties broken by ground-truth index then
   prediction index.

## Per-category reporting

`FACE`, `EMAIL`, `PHONE`, `PAN`, `AADHAAR`, `AMOUNT` are always reported
(even with zero detections). Any other contract category present in the
data (`NAME`, `PASSWORD`) is reported too, in contract order.

## CLI

From the repository root:

```bash
.venv-ml/Scripts/python.exe -m ml.evaluation.evaluate ml/evaluation/fixtures/mixed.json
```

Input: one JSON file `{"ground_truth": [...], "predictions": [...]}` of
Detection-shaped dicts. Output: machine-readable JSON with metrics and
metadata only (`fixture`, `iou_threshold`, `counts`, `aggregate`,
`per_category`). Malformed fixtures (missing keys, unknown categories, bad
bboxes/confidences/sources, wrong top-level shape) fail loudly with a
`ValueError` naming the offending index.

Library: `from ml.evaluation.evaluate import evaluate, match_detections,
load_fixture`.

## Synthetic fixture

`fixtures/mixed.json` — deterministic, 100% synthetic ids/boxes covering:
perfect detection (DOM + vision), missed detection, extra predictions,
wrong category, low-IoU prediction (0.25), multiple detections of one
category, and mixed DOM + vision detections. Expected result: aggregate
TP=4 / FP=4 / FN=3, precision 0.5, recall 0.5714, F1 0.5333.

## Synthetic-only privacy policy

- Fixtures and tests contain no real names, emails, phone numbers, PANs,
  Aadhaar numbers, financial data, or screenshots — only ids, categories,
  and synthetic boxes.
- The evaluator operates on detection metadata only; `Detection[]` carries
  no text, and nothing in this module prints or stores matched values.
- No network access, no cloud APIs, no LLM, no persistence of screenshots.

## Limitations

- Greedy one-to-one matching is not globally optimal; a rare adversarial
  arrangement could match a lower-IoU pair while a higher-IoU one goes
  unmatched (both orders are deterministic and documented).
- Vision-vs-DOM matching relies on boxes already sharing a coordinate
  space (ML-4's job); the evaluator does not rescale.
- Confidence plays no role in matching — a 0.51-confidence prediction
  counts exactly like a 0.99 one. Thresholded variants are future work.
- Latency budgets (the other M6 metric family) are not measured here.
