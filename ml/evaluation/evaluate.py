"""Local deterministic evaluation harness for PRIVIS privacy detections — ML-5.

Compares predicted Detection[]-compatible dicts (contract shape from
CONTRACT.md / types/index.ts: {element_id, category, bbox, confidence,
source}) against ground-truth detections and reports TP/FP/FN, precision,
recall, and F1 — aggregate and per-category. Pure stdlib: no network, no
cloud API, no LLM, no screenshots, no model. The evaluator sees detection
metadata (ids, categories, boxes) only; Detection[] carries no text.

Matching rules (deterministic, one-to-one — a prediction never matches two
ground truths and vice versa):
- Category must always match exactly.
- source "dom" predictions match by ELEMENT IDENTITY: same element_id as a
  ground-truth detection of the same category (their bbox comes from
  getBoundingClientRect and means the same element).
- source "vision" predictions match SPATIALLY: IoU >= IOU_THRESHOLD (0.5)
  against a same-category ground truth (works for vision-vs-vision and
  vision-prediction-vs-DOM-ground-truth; pixel boxes are already in one
  space by the time they reach Detection[]).
- Order: element-identity pairs first (by ground-truth index, then
  prediction index), then spatial pairs by IoU descending, ties by index.
  Each detection is used at most once — no double counting.

Metric definitions (per category and aggregate):
    precision = TP / (TP + FP)     (0.0 when TP + FP == 0)
    recall    = TP / (TP + FN)     (0.0 when TP + FN == 0)
    f1        = 2 * precision * recall / (precision + recall)   (0.0 when P + R == 0)

CLI (from the repository root):
    python -m ml.evaluation.evaluate ml/evaluation/fixtures/mixed.json
Outputs machine-readable JSON with metrics and metadata only.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

IOU_THRESHOLD = 0.5

# Per-category metrics are always reported for these (issue requirement)...
REQUIRED_CATEGORIES = ("FACE", "EMAIL", "PHONE", "PAN", "AADHAAR", "AMOUNT")
# ...in contract order for any other category that shows up in the data.
ALL_CATEGORIES = ("EMAIL", "PAN", "AADHAAR", "AMOUNT", "PHONE", "NAME", "FACE", "PASSWORD")

DETECTION_KEYS = {"element_id", "category", "bbox", "confidence", "source"}


def iou(a: list[float], b: list[float]) -> float:
    """IoU of two [x, y, w, h] boxes."""
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    x1, y1 = max(ax, bx), max(ay, by)
    x2, y2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def _validate_detection(det: Any, kind: str, index: int) -> None:
    """Raise ValueError with a precise message for a malformed detection."""
    where = f"{kind}[{index}]"
    if not isinstance(det, dict):
        raise ValueError(f"{where}: must be an object, got {type(det).__name__}")
    missing = DETECTION_KEYS - det.keys()
    if missing:
        raise ValueError(f"{where}: missing key(s): {sorted(missing)}")
    if det["category"] not in ALL_CATEGORIES:
        raise ValueError(f"{where}: unknown category {det['category']!r}")
    if det["source"] not in ("dom", "vision"):
        raise ValueError(f"{where}: source must be 'dom' or 'vision', got {det['source']!r}")
    if not isinstance(det["element_id"], str) or not det["element_id"]:
        raise ValueError(f"{where}: element_id must be a non-empty string")
    bbox = det["bbox"]
    if (not isinstance(bbox, list) or len(bbox) != 4
            or not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in bbox)):
        raise ValueError(f"{where}: bbox must be [x, y, w, h] numbers, got {bbox!r}")
    conf = det["confidence"]
    if (not isinstance(conf, (int, float)) or isinstance(conf, bool)
            or not 0.0 <= conf <= 1.0):
        raise ValueError(f"{where}: confidence must be a number in 0..1, got {conf!r}")


def validate_detections(dets: Any, kind: str) -> None:
    """Validate a list of Detection-shaped dicts; raises ValueError."""
    if not isinstance(dets, list):
        raise ValueError(f"{kind}: must be a list, got {type(dets).__name__}")
    for i, det in enumerate(dets):
        _validate_detection(det, kind, i)


def match_detections(ground_truth: list[dict], predictions: list[dict]) -> list[tuple[int, int]]:
    """One-to-one matching. Returns (ground_truth_index, prediction_index) pairs."""
    identity: list[tuple[int, int]] = []
    spatial: list[tuple[float, int, int]] = []
    for j, pred in enumerate(predictions):
        for i, gt in enumerate(ground_truth):
            if gt["category"] != pred["category"]:
                continue
            if pred["source"] == "dom":
                # Element identity: same element, same category.
                if gt["element_id"] == pred["element_id"]:
                    identity.append((i, j))
            else:
                # Vision: spatial agreement required, regardless of ids
                # (fusion may or may not have assigned an element_id).
                score = iou(gt["bbox"], pred["bbox"])
                if score >= IOU_THRESHOLD:
                    spatial.append((score, i, j))

    used_gt: set[int] = set()
    used_pred: set[int] = set()
    matches: list[tuple[int, int]] = []
    # Identity pairs first (exact), in input order for determinism.
    for i, j in sorted(identity):
        if i not in used_gt and j not in used_pred:
            matches.append((i, j))
            used_gt.add(i)
            used_pred.add(j)
    # Then spatial pairs: best IoU first, ties by ground-truth then prediction index.
    for score, i, j in sorted(spatial, key=lambda t: (-t[0], t[1], t[2])):
        if i not in used_gt and j not in used_pred:
            matches.append((i, j))
            used_gt.add(i)
            used_pred.add(j)
    return matches


def _metrics(tp: int, fp: int, fn: int) -> dict[str, Any]:
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "tp": tp, "fp": fp, "fn": fn,
        "precision": round(precision, 4), "recall": round(recall, 4), "f1": round(f1, 4),
    }


def evaluate(ground_truth: list[dict], predictions: list[dict]) -> dict[str, Any]:
    """Compute aggregate and per-category metrics. Inputs are not mutated."""
    validate_detections(ground_truth, "ground_truth")
    validate_detections(predictions, "predictions")

    matches = match_detections(ground_truth, predictions)
    matched_gt = {i for i, _ in matches}
    matched_pred = {j for _, j in matches}

    present = {d["category"] for d in ground_truth} | {d["category"] for d in predictions}
    categories = list(REQUIRED_CATEGORIES) + \
                 [c for c in ALL_CATEGORIES if c in present and c not in REQUIRED_CATEGORIES]

    tp = {c: 0 for c in categories}
    fp = {c: 0 for c in categories}
    fn = {c: 0 for c in categories}
    for i, j in matches:
        tp[ground_truth[i]["category"]] += 1
    for j, pred in enumerate(predictions):
        if j not in matched_pred:
            fp[pred["category"]] += 1
    for i, gt in enumerate(ground_truth):
        if i not in matched_gt:
            fn[gt["category"]] += 1

    return {
        "aggregate": _metrics(sum(tp.values()), sum(fp.values()), sum(fn.values())),
        "per_category": {c: _metrics(tp[c], fp[c], fn[c]) for c in categories},
    }


def load_fixture(path: str | Path) -> tuple[list[dict], list[dict]]:
    """Load and validate a fixture file: {"ground_truth": [...], "predictions": [...]}."""
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict) or "ground_truth" not in data or "predictions" not in data:
        raise ValueError("fixture: expected an object with 'ground_truth' and 'predictions' lists")
    validate_detections(data["ground_truth"], "ground_truth")
    validate_detections(data["predictions"], "predictions")
    return data["ground_truth"], data["predictions"]


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Evaluate PRIVIS privacy detections against ground truth (ML-5)")
    ap.add_argument("fixture", help='JSON file: {"ground_truth": [...], "predictions": [...]}')
    args = ap.parse_args(argv)

    ground_truth, predictions = load_fixture(args.fixture)
    result = evaluate(ground_truth, predictions)
    print(json.dumps({
        "fixture": str(args.fixture),
        "iou_threshold": IOU_THRESHOLD,
        "counts": {"ground_truth": len(ground_truth), "predictions": len(predictions)},
        **result,
    }, indent=2))


if __name__ == "__main__":
    main()
