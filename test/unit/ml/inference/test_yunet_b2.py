"""M6-B2 tests: YuNet operating-point justification (hard negatives F8-F12).

Run from the repository root:
    .venv-ml/Scripts/python.exe ml/inference/test_yunet_b2.py

Covers: F1-F7 preservation (annotations unchanged), F8-F12 ground truth is
zero faces with deterministic regeneration (byte-identical), detection
structure/bbox/confidence validity at the approved 0.35 operating point over
F1-F12, determinism at 0.35 (repeat + fresh session), and the recorded
per-face score / gate evidence being consistent with actual model output.
No network, synthetic fixtures only. Exits 0 with "ALL CHECKS PASSED".
"""

import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "ml" / "inference"))
sys.path.insert(0, str(REPO_ROOT / "ml" / "scripts"))

from PIL import Image

from yunet_detector import YuNetDetector, verify_model

ROOT = REPO_ROOT
IMAGES = ROOT / "ml" / "dataset" / "images"
MANIFEST_F1_7 = ROOT / "ml" / "dataset" / "annotations" / "m6b_face_fixtures.json"
MANIFEST_F8_12 = ROOT / "ml" / "dataset" / "annotations" / "m6b2_face_fixtures.json"
REPORT = ROOT / "ml" / "models" / "face_detection_yunet" / "validation_report_b2.json"
APPROVED_THRESHOLD = 0.35

# F1-F7 expected ground truth (M6-B baseline — MUST stay unchanged).
EXPECTED_F1_7 = {
    "F1": [[220, 120, 200, 260]],
    "F2": [[30, 100, 200, 260], [300, 40, 100, 130], [480, 300, 50, 65]],
    "F3": [[200, 200, 40, 52], [800, 400, 40, 52]],
    "F4": [[0, 140, 140, 260]],
    "F5": [], "F6": [], "F7": [],
}
HARD_NEGATIVES = ("F8", "F9", "F10", "F11", "F12")

passed = []


def check(name, cond, detail=""):
    assert cond, f"{name}: {detail}"
    passed.append(name)
    print(f"  PASS {name}")


def main():
    # --- 1. F1-F7 preservation ---
    f1_7 = json.loads(MANIFEST_F1_7.read_text(encoding="utf-8"))
    check("F1-F7 annotations unchanged (ids + GT boxes)",
          {k: v["faces"] for k, v in f1_7.items()} == EXPECTED_F1_7)

    # --- 2. F8-F12 manifest integrity ---
    f8_12 = json.loads(MANIFEST_F8_12.read_text(encoding="utf-8"))
    check("F8-F12 manifest present with all five fixtures",
          all(f in f8_12 for f in HARD_NEGATIVES))
    check("F8-F12 ground truth is ZERO faces (by construction)",
          all(f8_12[f]["faces"] == [] for f in HARD_NEGATIVES))

    # --- 3. F8-F12 regeneration determinism (byte-identical) ---
    fname = {f: f8_12[f]["image"].split("/")[-1] for f in HARD_NEGATIVES}
    before = {f: (IMAGES / fname[f]).read_bytes() for f in HARD_NEGATIVES}
    subprocess.run([sys.executable, str(ROOT / "ml" / "scripts" / "make_m6b2_fixtures.py")],
                   check=True, capture_output=True, cwd=ROOT)
    after = {f: (IMAGES / fname[f]).read_bytes() for f in HARD_NEGATIVES}
    check("F8-F12 regeneration is byte-identical (deterministic)", before == after)

    # --- 4. Artifact still the verified 2023mar model ---
    verify_model()
    check("artifact checksum unchanged (2023mar, SHA-256 verified)", True)

    # --- 5. Detection structure at the approved operating point, all F1-F12 ---
    det = YuNetDetector(score_threshold=APPROVED_THRESHOLD)
    images = {}
    for fid, spec in {**f1_7, **f8_12}.items():
        img = Image.open(ROOT / spec["image"]).convert("RGB")
        images[fid] = img
        for d in det.detect(img):
            x, y, w, h = d["bbox"]
            assert set(d.keys()) == {"category", "bbox", "confidence", "source"}, d
            assert d["category"] == "FACE" and d["source"] == "vision", d
            assert w > 0 and h > 0 and 0 <= x and x + w <= spec["width"], d
            assert 0 <= y and y + h <= spec["height"], d
            assert 0.0 <= d["confidence"] <= 1.0, d
    check(f"detections at {APPROVED_THRESHOLD} structurally valid + in-bounds on F1-F12", True)

    # --- 6. Determinism at 0.35 (repeat + fresh session, per fixture) ---
    order = ("F1", "F2", "F3", "F4", "F5", "F6", "F7") + HARD_NEGATIVES
    run_a = [json.dumps(det.detect(images[f])) for f in order]
    run_b = [json.dumps(det.detect(images[f])) for f in order]
    run_c = [json.dumps(YuNetDetector(score_threshold=APPROVED_THRESHOLD).detect(images[f])) for f in order]
    check("deterministic at 0.35 (same session repeat + fresh session)", run_a == run_b == run_c)

    # --- 7. Recorded B2 evidence consistent with live model output ---
    report = json.loads(REPORT.read_text(encoding="utf-8"))
    check("B2 report exists with decision + gate table",
          "decision" in report and "gate_table" in report and "threshold_sweep" in report)
    # per-face scores in the report must match a fresh probe for the F1 face
    probe = YuNetDetector(score_threshold=0.05)
    f1_live = probe.detect(images["F1"])[0]["confidence"]
    f1_recorded = [s for s in report["per_face_scores"] if s["fixture"] == "F1"][0]["score"]
    check("recorded per-face score matches live model output (F1)",
          abs(f1_live - f1_recorded) < 1e-4)
    # gate decision must agree with the sweep row it points at
    if report["decision"].startswith("YUNET APPROVED"):
        thr = report["selected_threshold"]
        row = report["threshold_sweep"][f"{thr:.2f}"]
        check("approved threshold's sweep row actually passes accuracy gates",
              row["precision"] >= 0.90 and row["recall"] >= 0.90 and row["f1"] >= 0.90
              and row["fp_F5_F7"] == 0 and row["fp_F8_F12"] == 0)

    print(f"ALL CHECKS PASSED ({len(passed)} checks)")


if __name__ == "__main__":
    main()
