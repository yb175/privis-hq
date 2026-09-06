"""DOM + vision detection fusion — ML-4.

Fuses the existing DOM detection output (detectSensitive in
privacy/sanitizer/structural-redact.ts, source:"dom") with ML-1/ML-3 vision
detections (source:"vision") into one Detection[]-shaped list, fully locally.
Pure stdlib — no network, no LLM, no model, no browser API.

Inputs (JSON-shaped dicts):
    elements          ElementMeta[] from the Capture Layer content script
                      ({element_id, tag, type, role, label, text, bbox}).
                      ONLY element_id and bbox are read — text/label values
                      are never accessed, copied, or emitted.
    dom_detections    Detection[] from the existing TS detectSensitive()
                      ({element_id, category, bbox, confidence, source:"dom"}).
    vision_detections ML-3/ML-1 output ({category, bbox, confidence,
                      source:"vision"}), bbox in SCREENSHOT PIXEL space.
    screenshot        {"w", "h"} — screenshot pixel dimensions.
    viewport          {"w", "h"} — CSS viewport dimensions.

Output: one dict per detection, contract Detection-shaped:
    {"element_id", "category", "bbox", "confidence", "source"}
(See CONTRACT.md / types/index.ts. This Python module mirrors the shape;
the runtime TS integration is M5.)

Coordinate systems:
    DOM bboxes are CSS viewport pixels (getBoundingClientRect).
    Vision bboxes are screenshot pixels. Conversion (before matching):
        sx = viewport.w / screenshot.w ;  sy = viewport.h / screenshot.h
        css_bbox = [round(x*sx), round(y*sy), round(w*sx), round(h*sy)]
    Equal dimensions -> sx = sy = 1 -> coordinates unchanged.

Matching (deterministic):
    Metric: IoU between the scaled vision bbox and each element bbox.
    Threshold: IOU_THRESHOLD = 0.3. Best (highest) IoU wins; ties break to
    the element appearing EARLIER in the elements list. No match below
    threshold.

Duplicate handling (deterministic):
    Detections are keyed by (element_id, category). DOM detections are
    inserted first; a matched vision detection with an existing key REPLACES
    it only if its confidence is strictly higher (tie -> DOM wins, the
    deterministic signal). One detection per (element, category) is emitted.

Unmatched vision detections:
    - FACE: kept, with the synthetic stable id "vision-<i>" (i = index in
      the vision input list). Justified by the existing architecture:
      redactVisual() redacts by bbox+category only and never resolves
      element_id, and applyPlaceholders() safely ignores ids with no
      backing element. FACE is inherently visual and routinely has no DOM
      element — discarding it would leak face pixels.
    - other categories: SKIPPED (documented limitation). The structural
      placeholder machinery works on real DOM element ids; inventing ids
      for text categories buys pixel blackout but risks downstream
      confusion, so M4 stays conservative. Recall for DOM-invisible text
      PII improves in a later milestone.

Library use:
    from fuse import fuse_detections
    detections = fuse_detections(elements, dom_detections,
                                 vision_detections, screenshot, viewport)

CLI use (input: one JSON file with all five inputs above as keys):
    python ml/fusion/fuse.py fusion_input.json
Output prints ids/categories/bboxes/confidences only — never element text.
"""

import argparse
import json

# Minimum IoU for a vision detection to match a DOM element.
IOU_THRESHOLD = 0.3


def iou(a: list, b: list) -> float:
    """IoU of two [x, y, w, h] boxes."""
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    x1, y1 = max(ax, bx), max(ay, by)
    x2, y2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def scale_bbox(bbox: list, sx: float, sy: float) -> list:
    """Scale a screenshot-pixel bbox into viewport/CSS pixels."""
    x, y, w, h = bbox
    return [round(x * sx), round(y * sy), round(w * sx), round(h * sy)]


def fuse_detections(
    elements: list,
    dom_detections: list,
    vision_detections: list,
    screenshot: dict,
    viewport: dict,
) -> list:
    """Fuse DOM and vision detections into one Detection[]-shaped list.
    Inputs are never mutated; no element text is read or emitted."""
    sw, sh = screenshot["w"], screenshot["h"]
    vw, vh = viewport["w"], viewport["h"]
    if sw <= 0 or sh <= 0 or vw <= 0 or vh <= 0:
        raise ValueError("screenshot and viewport dimensions must be positive")
    sx, sy = vw / sw, vh / sh

    # Keyed merge: one detection per (element_id, category).
    # DOM first (input order), so ties prefer the deterministic DOM signal.
    merged: dict = {}
    for det in dom_detections:
        merged[(det["element_id"], det["category"])] = dict(det)

    for i, det in enumerate(vision_detections):
        css_bbox = scale_bbox(det["bbox"], sx, sy)

        # Best-IoU element; ties -> earlier element in the list wins
        # (strict > means only a strictly better candidate replaces).
        best_id, best_iou = None, 0.0
        for el in elements:
            score = iou(css_bbox, el["bbox"])
            if score > best_iou:
                best_id, best_iou = el["element_id"], score

        if best_id is not None and best_iou >= IOU_THRESHOLD:
            key = (best_id, det["category"])
            candidate = {
                "element_id": best_id,
                "category": det["category"],
                "bbox": css_bbox,
                "confidence": det["confidence"],
                "source": "vision",
            }
            existing = merged.get(key)
            if existing is None or candidate["confidence"] > existing["confidence"]:
                merged[key] = candidate
            # else: duplicate — keep the existing (DOM-preferred) detection
        elif det["category"] == "FACE":
            # Unmatched FACE: keep with a synthetic stable id (see module
            # docstring for the architectural justification). Never dropped.
            merged[(f"vision-{i}", "FACE")] = {
                "element_id": f"vision-{i}",
                "category": "FACE",
                "bbox": css_bbox,
                "confidence": det["confidence"],
                "source": "vision",
            }
        # else: unmatched non-FACE vision detection — skipped by design.

    return list(merged.values())


def main() -> None:
    ap = argparse.ArgumentParser(description="DOM + vision detection fusion (ML-4)")
    ap.add_argument("fusion_json", help='JSON file: {"elements", "dom_detections", "vision_detections", "screenshot", "viewport"}')
    args = ap.parse_args()

    with open(args.fusion_json, encoding="utf-8") as f:
        data = json.load(f)
    print(json.dumps(fuse_detections(
        data["elements"], data["dom_detections"], data["vision_detections"],
        data["screenshot"], data["viewport"],
    ), indent=2))


if __name__ == "__main__":
    main()
