"""ML-4 unit tests: DOM + vision detection fusion.

Run from the repository root:
    .venv-ml/Scripts/python.exe ml/fusion/test_fuse.py

All data is synthetic. Covers: exact/partial/below-threshold overlap,
multiple candidates, tie-breaking, no-match, coordinate scaling, equal
dimensions, FACE behavior, multiple vision detections, DOM+vision duplicate
merging, category/confidence/source/element_id preservation, input
non-mutation, and no sensitive text leakage. Exits 0 with
"ALL CHECKS PASSED" on success.
"""

import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fuse import fuse_detections, iou, scale_bbox

SAME = {"w": 1000, "h": 500}  # screenshot == viewport -> scale 1:1
VP = SAME


def element(eid: str, bbox: list) -> dict:
    """Synthetic ElementMeta. The fake text proves fusion never leaks it."""
    return {
        "element_id": eid, "tag": "input", "type": "text", "role": None,
        "label": f"Label {eid}", "text": f"SECRET-VALUE-{eid}", "bbox": bbox,
    }


def vision(category: str, bbox: list, conf: float = 0.8) -> dict:
    return {"category": category, "bbox": bbox, "confidence": conf, "source": "vision"}


def dom(eid: str, category: str, bbox: list, conf: float = 0.95) -> dict:
    return {"element_id": eid, "category": category, "bbox": bbox,
            "confidence": conf, "source": "dom"}


def fuse(elements, doms, visions, screenshot=SAME, viewport=VP):
    return fuse_detections(elements, doms, visions, screenshot, viewport)


def by_key(dets):
    return {(d["element_id"], d["category"]): d for d in dets}


def main() -> None:
    # --- IoU / scale helpers sanity ---
    assert iou([0, 0, 10, 10], [0, 0, 10, 10]) == 1.0
    assert iou([0, 0, 10, 10], [5, 5, 10, 10]) == 25 / 175
    assert iou([0, 0, 10, 10], [20, 20, 5, 5]) == 0.0
    assert scale_bbox([200, 300, 100, 50], 0.5, 0.5) == [100, 150, 50, 25]
    print("  PASS iou/scale_bbox helpers")

    # --- 1. Exact DOM/vision overlap -> matched, element_id assigned ---
    els = [element("email", [100, 100, 200, 30])]
    out = fuse(els, [], [vision("EMAIL", [100, 100, 200, 30], 0.65)])
    assert out == [{"element_id": "email", "category": "EMAIL",
                    "bbox": [100, 100, 200, 30], "confidence": 0.65,
                    "source": "vision"}], out
    print("  PASS exact overlap -> element_id assigned")

    # --- 2. Partial overlap above threshold (IoU 0.5) ---
    out = fuse([element("pan", [100, 100, 100, 100])], [],
               [vision("PAN", [100, 100, 100, 50])])
    assert len(out) == 1 and out[0]["element_id"] == "pan", out
    print("  PASS partial overlap (IoU 0.5) matched")

    # --- 3. Below-threshold overlap: non-FACE skipped, FACE kept ---
    els = [element("far", [0, 0, 100, 100])]
    v = vision("EMAIL", [300, 300, 100, 100])  # zero overlap
    out = fuse(els, [], [v])
    assert out == [], out
    out = fuse(els, [], [vision("FACE", [300, 300, 100, 100], 0.9)])
    assert out == [{"element_id": "vision-0", "category": "FACE",
                    "bbox": [300, 300, 100, 100], "confidence": 0.9,
                    "source": "vision"}], out
    print("  PASS below threshold: EMAIL skipped, FACE kept as vision-0")

    # --- 4. Multiple DOM candidates -> highest IoU wins ---
    els = [element("a", [100, 100, 100, 100]), element("b", [130, 100, 100, 100])]
    out = fuse(els, [], [vision("PHONE", [95, 100, 100, 100])])
    # overlap with a: 105x100=10500; with b: 70x100=7000 -> a wins
    assert out[0]["element_id"] == "a", out
    print("  PASS multiple candidates -> highest IoU wins")

    # --- 5. Tie-breaking -> earlier element in the list wins ---
    els = [element("first", [100, 100, 100, 100]), element("second", [100, 100, 100, 100])]
    out = fuse(els, [], [vision("AADHAAR", [100, 100, 100, 100])])
    assert out[0]["element_id"] == "first", out
    print("  PASS tie-break -> earlier element wins")

    # --- 6. No matching element at all (empty elements) ---
    out = fuse([], [], [vision("EMAIL", [10, 10, 50, 50])])
    assert out == [], out
    print("  PASS no elements -> non-FACE vision skipped")

    # --- 7. Coordinate scaling when screenshot != viewport ---
    # Screenshot is 2x the viewport (devicePixelRatio 2, 2000x1000 -> 1000x500).
    shot, vp = {"w": 2000, "h": 1000}, {"w": 1000, "h": 500}
    els = [element("amount", [100, 150, 50, 25])]
    out = fuse(els, [], [vision("AMOUNT", [200, 300, 100, 50])], shot, vp)
    assert out == [{"element_id": "amount", "category": "AMOUNT",
                    "bbox": [100, 150, 50, 25], "confidence": 0.8,
                    "source": "vision"}], out
    print("  PASS coordinate scaling (2x DPR) -> matched in CSS space")

    # --- 8. Equal screenshot/viewport dimensions -> unchanged ---
    out = fuse([element("email", [75, 151, 284, 40])], [],
               [vision("EMAIL", [75, 151, 284, 40], 0.6541)])
    assert out[0]["bbox"] == [75, 151, 284, 40], out
    print("  PASS equal dimensions -> bbox unchanged")

    # --- 9. FACE behavior: matched FACE gets the element id ---
    els = [element("avatar", [500, 20, 64, 64])]
    out = fuse(els, [], [vision("FACE", [500, 20, 64, 64], 0.88)])
    assert out == [{"element_id": "avatar", "category": "FACE",
                    "bbox": [500, 20, 64, 64], "confidence": 0.88,
                    "source": "vision"}], out
    print("  PASS matched FACE -> element_id assigned")

    # --- 10. Multiple vision detections, mixed outcomes ---
    els = [element("email", [10, 10, 100, 20]), element("avatar", [500, 20, 64, 64])]
    out = fuse(els, [], [
        vision("EMAIL", [10, 10, 100, 20], 0.7),      # matched
        vision("PHONE", [900, 400, 80, 30]),          # unmatched, skipped
        vision("FACE", [500, 20, 64, 64], 0.9),       # matched
        vision("FACE", [800, 100, 60, 60], 0.85),     # unmatched -> vision-3
    ])
    keys = {(d["element_id"], d["category"]) for d in out}
    assert keys == {("email", "EMAIL"), ("avatar", "FACE"), ("vision-3", "FACE")}, keys
    print("  PASS multiple vision detections (matched/skipped/vision-id)")

    # --- 11. Duplicate DOM + vision, same (element, category) ---
    els = [element("pan", [10, 10, 100, 30])]
    doms = [dom("pan", "PAN", [10, 10, 100, 30], 0.95)]
    # a) DOM stronger -> DOM kept as-is
    out = fuse(els, doms, [vision("PAN", [10, 10, 100, 30], 0.6)])
    assert out == [doms[0]], out
    # b) vision stronger -> vision wins, but element_id/category from merge
    out = fuse(els, doms, [vision("PAN", [10, 10, 100, 30], 0.99)])
    assert out == [{"element_id": "pan", "category": "PAN", "bbox": [10, 10, 100, 30],
                    "confidence": 0.99, "source": "vision"}], out
    # c) tie -> DOM wins (deterministic preference)
    out = fuse(els, doms, [vision("PAN", [10, 10, 100, 30], 0.95)])
    assert out == [doms[0]], out
    print("  PASS duplicate merge: higher confidence wins, tie -> DOM")

    # --- 12-15. Preservation: category/confidence/source/element_id ---
    els = [element("phone", [10, 10, 100, 30])]
    out = fuse(els, [], [vision("PHONE", [10, 10, 100, 30], 0.7140)])
    d = out[0]
    assert d["category"] == "PHONE" and d["confidence"] == 0.7140
    assert d["source"] == "vision" and d["element_id"] == "phone"
    assert set(d.keys()) == {"element_id", "category", "bbox", "confidence", "source"}
    print("  PASS category/confidence/source/element_id preserved, exact keys")

    # --- DOM-only categories (PASSWORD) carried through, source "dom" ---
    doms = [dom("pwd", "PASSWORD", [10, 50, 100, 30], 0.95)]
    out = fuse([element("pwd", [10, 50, 100, 30])], doms, [])
    assert out == doms and out[0]["source"] == "dom", out
    print("  PASS DOM-only PASSWORD carried through, source 'dom'")

    # --- 16. Inputs are not mutated ---
    els = [element("email", [10, 10, 100, 20])]
    doms = [dom("pan", "PAN", [10, 40, 100, 30])]
    visions = [vision("EMAIL", [10, 10, 100, 20], 0.7),
               vision("FACE", [500, 20, 64, 64], 0.9)]
    snap = copy.deepcopy((els, doms, visions))
    fuse(els, doms, visions, {"w": 2000, "h": 1000}, {"w": 1000, "h": 500})
    assert (els, doms, visions) == snap, "fuse_detections mutated its input"
    print("  PASS inputs not mutated")

    # --- 17. No sensitive DOM text appears in fusion output ---
    els = [element("email", [10, 10, 100, 20])]
    out = fuse(els, [], [vision("EMAIL", [10, 10, 100, 20], 0.7)])
    dumped = json.dumps(out)
    for secret in ("SECRET-VALUE-email", "Label email"):
        assert secret not in dumped, f"sensitive text leaked: {secret}"
    print("  PASS no sensitive DOM text in output")

    # --- Invalid dimensions fail loudly ---
    for bad in ({"w": 0, "h": 100}, {"w": 100, "h": -1}):
        try:
            fuse([], [], [], bad, {"w": 100, "h": 100})
            raise AssertionError("expected ValueError for invalid dims")
        except ValueError:
            pass
    print("  PASS invalid dimensions rejected")

    print("ALL CHECKS PASSED")


if __name__ == "__main__":
    main()
