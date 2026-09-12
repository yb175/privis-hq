"""ML-5 unit tests: privacy detection evaluation harness.

Run from the repository root:
    .venv-ml/Scripts/python.exe test/unit/ml/evaluation/test_evaluate.py

All data is synthetic. Covers: perfect match, missed detection, false
positive, wrong category, IoU below/at/above threshold, one-to-one matching,
multiple categories, DOM matching, aggregate + per-category metrics,
zero-denominator cases, input non-mutation, malformed fixtures, and the
CLI entry point. Exits 0 with "ALL CHECKS PASSED" on success.
"""

import copy
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "ml" / "inference"))
sys.path.insert(0, str(REPO_ROOT / "ml" / "scripts"))

from ml.evaluation.evaluate import (
    IOU_THRESHOLD,
    evaluate,
    iou,
    load_fixture,
    main,
    match_detections,
)

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "mixed.json"


def det(eid: str, category: str, bbox: list, source: str = "vision", conf: float = 0.9) -> dict:
    return {"element_id": eid, "category": category, "bbox": bbox,
            "confidence": conf, "source": source}


def counts(result: dict, cat: str) -> tuple:
    m = result["per_category"][cat]
    return m["tp"], m["fp"], m["fn"]


def expect_error(fn, substring: str) -> None:
    try:
        fn()
    except ValueError as e:
        assert substring in str(e), f"error {e!r} missing {substring!r}"
        return
    raise AssertionError(f"expected ValueError containing {substring!r}")


def main_test() -> None:
    # --- IoU helper sanity ---
    assert iou([0, 0, 10, 10], [0, 0, 10, 10]) == 1.0
    assert iou([0, 0, 10, 10], [20, 20, 5, 5]) == 0.0
    assert iou([0, 0, 10, 10], [0, 0, 10, 5]) == 0.5
    print("  PASS iou helper")

    # --- 1. Perfect match: DOM identity + vision IoU=1 ---
    gt = [det("el-email", "EMAIL", [10, 10, 100, 20], "dom"),
          det("vision-0", "FACE", [500, 20, 64, 64])]
    pred = [det("el-email", "EMAIL", [10, 10, 100, 20], "dom"),
            det("vision-0", "FACE", [500, 20, 64, 64])]
    r = evaluate(gt, pred)
    assert r["aggregate"] == {"tp": 2, "fp": 0, "fn": 0, "precision": 1.0, "recall": 1.0, "f1": 1.0}, r
    assert counts(r, "EMAIL") == (1, 0, 0) and counts(r, "FACE") == (1, 0, 0)
    print("  PASS perfect match (dom + vision)")

    # --- 2. Missed detection -> FN ---
    r = evaluate([det("v1", "PHONE", [0, 0, 100, 20])], [])
    assert counts(r, "PHONE") == (0, 0, 1)
    assert r["aggregate"]["fn"] == 1 and r["aggregate"]["recall"] == 0.0
    print("  PASS missed detection -> FN")

    # --- 3. False positive (extra prediction, no GT) ---
    r = evaluate([], [det("v1", "AMOUNT", [0, 0, 100, 20])])
    assert counts(r, "AMOUNT") == (0, 1, 0)
    assert r["aggregate"]["precision"] == 0.0
    print("  PASS extra prediction -> FP")

    # --- 4. Wrong category -> FP and FN (never cross-matched) ---
    gt = [det("v1", "PAN", [0, 0, 100, 20])]
    pred = [det("v1", "AADHAAR", [0, 0, 100, 20])]
    r = evaluate(gt, pred)
    assert counts(r, "PAN") == (0, 0, 1) and counts(r, "AADHAAR") == (0, 1, 0)
    print("  PASS wrong category -> FP + FN")

    # --- 5. IoU below threshold -> FP + FN (0.25) ---
    gt = [det("v1", "AADHAAR", [10, 110, 150, 20])]
    pred = [det("v2", "AADHAAR", [100, 110, 150, 20])]  # IoU = 0.25
    r = evaluate(gt, pred)
    assert counts(r, "AADHAAR") == (0, 1, 1)
    print("  PASS IoU 0.25 < 0.5 -> no match")

    # --- 6. IoU exactly at and above threshold -> TP ---
    gt = [det("v1", "AADHAAR", [0, 0, 100, 100])]
    r = evaluate(gt, [det("v2", "AADHAAR", [0, 0, 100, 50])])   # exactly 0.5
    assert counts(r, "AADHAAR") == (1, 0, 0), r
    r = evaluate(gt, [det("v2", "AADHAAR", [0, 0, 100, 60])])   # 60/140 > 0.5
    assert counts(r, "AADHAAR") == (1, 0, 0)
    print("  PASS IoU exactly 0.5 and above -> match")

    # --- 7. One-to-one matching: one prediction cannot satisfy two GTs ---
    gt = [det("a", "EMAIL", [0, 0, 100, 100]),
          det("b", "EMAIL", [25, 0, 100, 100])]
    pred = [det("p", "EMAIL", [12, 0, 100, 100])]  # overlaps both (IoU ~0.53 each)
    r = evaluate(gt, pred)
    assert counts(r, "EMAIL") == (1, 0, 1), r  # exactly one TP, one FN, no double count
    # And one GT cannot absorb two predictions:
    gt = [det("a", "EMAIL", [0, 0, 100, 100])]
    pred = [det("p1", "EMAIL", [0, 0, 100, 100]), det("p2", "EMAIL", [10, 0, 100, 100])]
    r = evaluate(gt, pred)
    assert counts(r, "EMAIL") == (1, 1, 0), r
    print("  PASS one-to-one matching (both directions)")

    # --- 8. Multiple categories independently ---
    gt = [det("a", "EMAIL", [0, 0, 50, 20]), det("b", "PAN", [0, 40, 50, 20]),
          det("c", "FACE", [0, 80, 50, 50])]
    pred = [det("b", "PAN", [0, 40, 50, 20]), det("c", "FACE", [0, 80, 50, 50])]
    r = evaluate(gt, pred)
    assert counts(r, "EMAIL") == (0, 0, 1)
    assert counts(r, "PAN") == (1, 0, 0) and counts(r, "FACE") == (1, 0, 0)
    assert r["aggregate"] == {"tp": 2, "fp": 0, "fn": 1, "precision": 1.0,
                              "recall": round(2 / 3, 4), "f1": 0.8}
    print("  PASS multiple categories")

    # --- 9. DOM matching: identity, not geometry ---
    # Same element id -> match even though bboxes differ (DOM boxes are element truth).
    r = evaluate([det("el-1", "EMAIL", [0, 0, 100, 20], "dom")],
                 [det("el-1", "EMAIL", [999, 999, 1, 1], "dom")])
    assert counts(r, "EMAIL") == (1, 0, 0), r
    # Different element id -> no match even with identical bboxes.
    r = evaluate([det("el-1", "EMAIL", [0, 0, 100, 20], "dom")],
                 [det("el-2", "EMAIL", [0, 0, 100, 20], "dom")])
    assert counts(r, "EMAIL") == (0, 1, 1)
    print("  PASS DOM matching by element identity")

    # --- 10/11. Aggregate + per-category metric formulas ---
    gt, pred = load_fixture(FIXTURE)
    r = evaluate(gt, pred)
    a = r["aggregate"]
    assert (a["tp"], a["fp"], a["fn"]) == (4, 4, 3), a
    assert a["precision"] == 0.5 and a["recall"] == round(4 / 7, 4), a
    assert a["f1"] == round(2 * 0.5 * (4 / 7) / (0.5 + 4 / 7), 4), a
    assert counts(r, "FACE") == (1, 0, 0)      # perfect vision
    assert counts(r, "EMAIL") == (1, 0, 0)     # perfect dom
    assert counts(r, "PHONE") == (0, 0, 1)     # missed
    assert counts(r, "PAN") == (0, 1, 1)       # wrong category (pred AADHAAR) + extra dom
    assert counts(r, "AADHAAR") == (0, 2, 1)   # wrong category + low IoU
    assert counts(r, "AMOUNT") == (2, 1, 0)    # multiple dom TPs + extra vision FP
    assert r["per_category"]["AMOUNT"]["f1"] == 0.8
    # All six required categories are always reported.
    for c in ("FACE", "EMAIL", "PHONE", "PAN", "AADHAAR", "AMOUNT"):
        assert c in r["per_category"]
    print("  PASS fixture: aggregate + per-category metrics")

    # --- 12. Zero-denominator cases ---
    r = evaluate([], [])  # everything empty
    assert r["aggregate"] == {"tp": 0, "fp": 0, "fn": 0, "precision": 0.0, "recall": 0.0, "f1": 0.0}
    r = evaluate([det("a", "PHONE", [0, 0, 10, 10])], [])  # precision denominator 0
    assert r["per_category"]["PHONE"]["precision"] == 0.0
    r = evaluate([], [det("a", "PHONE", [0, 0, 10, 10])])  # recall denominator 0
    assert r["per_category"]["PHONE"]["recall"] == 0.0
    print("  PASS zero-denominator cases")

    # --- 13. Input non-mutation ---
    gt = [det("a", "EMAIL", [0, 0, 50, 20], "dom")]
    pred = [det("a", "EMAIL", [0, 0, 50, 20], "dom"), det("b", "FACE", [9, 9, 9, 9])]
    snap = copy.deepcopy((gt, pred))
    evaluate(gt, pred)
    match_detections(gt, pred)
    assert (gt, pred) == snap, "evaluate/match_detections mutated inputs"
    print("  PASS inputs not mutated")

    # --- 14. Malformed fixtures fail loudly with clear messages ---
    expect_error(lambda: evaluate([{"category": "EMAIL"}], []), "ground_truth[0]")
    expect_error(lambda: evaluate([det("a", "NOPE", [0, 0, 1, 1])], []), "unknown category")
    expect_error(lambda: evaluate([det("a", "EMAIL", [0, 0])], []), "bbox")
    expect_error(lambda: evaluate([det("a", "EMAIL", [0, 0, 1, 1], conf=1.5)], []), "confidence")
    expect_error(lambda: evaluate([det("a", "EMAIL", [0, 0, 1, 1], source="gpu")], []), "source")
    expect_error(lambda: evaluate("nope", []), "must be a list")
    bad = Path(FIXTURE).with_suffix(".tmp.json")
    bad.write_text(json.dumps({"ground_truth": []}), encoding="utf-8")  # missing predictions
    try:
        expect_error(lambda: load_fixture(bad), "predictions")
    finally:
        bad.unlink()
    print("  PASS malformed fixture rejection")

    # --- 15. CLI entry point (python -m ml.evaluation.evaluate) ---
    proc = subprocess.run(
        [sys.executable, "-m", "ml.evaluation.evaluate", str(FIXTURE)],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    assert proc.returncode == 0, proc.stderr
    out = json.loads(proc.stdout)
    assert out["counts"] == {"ground_truth": 7, "predictions": 8}
    assert out["iou_threshold"] == IOU_THRESHOLD
    assert out["aggregate"]["tp"] == 4 and out["per_category"]["AMOUNT"]["f1"] == 0.8
    assert "text" not in proc.stdout.replace('"predictions"', "")  # no text key anywhere
    print("  PASS CLI (python -m ml.evaluation.evaluate)")

    print("ALL CHECKS PASSED")


if __name__ == "__main__":
    main_test()
