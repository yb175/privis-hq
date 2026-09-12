"""ML-6B tests: offline YuNet FACE detector validation.

Run from the repository root:
    .venv-ml/Scripts/python.exe ml/inference/test_yunet_detector.py

Covers: model checksum verification (pass + tamper + missing), model load,
successful inference, detection structure, bbox validity, confidence range,
deterministic repeated inference, empty-face negatives, missing/corrupt model
failure, decode math, NMS behavior, letterbox preprocessing, and synthetic
fixture evaluation. Uses only the deterministic synthetic fixtures — no real
faces, no network. Exits 0 with "ALL CHECKS PASSED" on success.
"""

import json
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "ml" / "inference"))
sys.path.insert(0, str(REPO_ROOT / "ml" / "scripts"))

from PIL import Image

from yunet_detector import (
    MODEL_PATH, YuNetDetector, decode_stride, nms, preprocess, verify_model,
)

IMAGES = REPO_ROOT / "ml" / "dataset" / "images"
ANNOTATIONS = REPO_ROOT / "ml" / "dataset" / "annotations" / "m6b_face_fixtures.json"

passed = []


def check(name: str, cond: bool, detail: str = "") -> None:
    assert cond, f"{name}: {detail}"
    passed.append(name)
    print(f"  PASS {name}")


def expect_error(fn, substring: str) -> None:
    try:
        fn()
    except Exception as e:
        assert substring.lower() in str(e).lower(), f"error {e!r} missing {substring!r}"
        return
    raise AssertionError(f"expected an error containing {substring!r}")


def main() -> None:
    fixtures = json.loads(ANNOTATIONS.read_text(encoding="utf-8"))
    f1 = Image.open(IMAGES / "synthetic_face.png").convert("RGB")
    f2 = Image.open(IMAGES / "f2_multi_scale_faces.png").convert("RGB")

    # --- 1. Model checksum verification ---
    verify_model()  # exact size + SHA-256 against the official artifact
    check("checksum verification passes on the official artifact", True)
    with tempfile.NamedTemporaryFile(suffix=".onnx", delete=False) as tmp:
        # 232,589 bytes of garbage: passes the size gate, fails SHA-256
        tmp.write((b"not a model" * 21145)[:232589])
        tampered = Path(tmp.name)
    try:
        expect_error(lambda: verify_model(tampered), "SHA-256 mismatch")
        check("tampered model (right size, wrong hash) rejected by checksum", True)
        expect_error(lambda: verify_model(Path("does/not/exist.onnx")), "not found")
        check("missing model rejected", True)
    finally:
        tampered.unlink(missing_ok=True)

    # --- 2. Model loads (ORT session, declared input shape enforced) ---
    det = YuNetDetector()
    check("model loads via onnxruntime CPU EP", det.input_name == "input")

    # --- 3. Successful inference ---
    dets = det.detect(f1)
    check("F1 inference finds >= 1 face", len(dets) >= 1, f"got {dets}")

    # --- 4. Valid FACE detection structure (ML-1 shape; element_id NOT assigned) ---
    for d in dets:
        assert set(d.keys()) == {"category", "bbox", "confidence", "source"}, d
        assert d["category"] == "FACE" and d["source"] == "vision", d
    check("detection structure is ML-1 shape (no element_id)", True)

    # --- 5/6. bbox validity + confidence range (all fixtures) ---
    for fid, spec in fixtures.items():
        img = Image.open(spec["image"]).convert("RGB")
        for d in det.detect(img):
            x, y, w, h = d["bbox"]
            assert len(d["bbox"]) == 4 and all(isinstance(v, int) for v in d["bbox"]), d
            assert w > 0 and h > 0, d
            assert 0 <= x and x + w <= spec["width"], d
            assert 0 <= y and y + h <= spec["height"], d
            assert 0.0 <= d["confidence"] <= 1.0, d
    check("bbox in-bounds/positive + confidence 0..1 on all fixtures", True)

    # --- 7. Deterministic repeated inference (same session + fresh session) ---
    a = json.dumps(det.detect(f2))
    b = json.dumps(det.detect(f2))
    c = json.dumps(YuNetDetector().detect(f2))
    check("repeated + fresh-session inference identical", a == b == c)

    # --- 8. Empty-face behavior: negatives return [], not an error ---
    for fid in ("F5", "F6", "F7"):
        img = Image.open(fixtures[fid]["image"]).convert("RGB")
        assert det.detect(img) == [], fid
    check("negative fixtures -> [] (successful pass, zero faces)", True)

    # --- 9. Missing / corrupt model failure (never silent []) ---
    expect_error(lambda: YuNetDetector(Path("no/such/model.onnx")), "not found")
    check("missing model -> explicit error", True)
    with tempfile.NamedTemporaryFile(suffix=".onnx", delete=False) as tmp:
        tmp.write(bytes(range(256)) * 10)  # wrong checksum AND not a model
        garbage = Path(tmp.name)
    try:
        expect_error(lambda: YuNetDetector(garbage), "mismatch")  # checksum gate fires first
        expect_error(lambda: YuNetDetector(garbage, verify=False), "session")  # ORT-level failure
        check("corrupt model -> explicit error (checksum gate and ORT both fail loudly)", True)
    finally:
        garbage.unlink(missing_ok=True)

    # --- 10. Decode math (crafted tensors, 1-cell grid: input_size=8, stride=8) ---
    # score = sqrt(clamp(cls)*clamp(obj)); cx=(c+dx)*s; w=exp(dw)*s; box=(cx-w/2, ...)
    out = decode_stride([[1.0]], [[1.0]], [[0.5, 0.5, 0.0, 0.0]], stride=8, input_size=8)
    assert out == [(0.0, 0.0, 8.0, 8.0, 1.0)], out  # cx=4, w=8 -> x=0
    check("decode math (score/box formulas)", True)
    out = decode_stride([[4.0]], [[0.25]], [[0.5, 0.5, 0.0, 0.0]], stride=8,
                        input_size=8, score_threshold=0.4)
    assert abs(out[0][4] - 0.5) < 1e-6, out  # sqrt(clamp(4.0)*0.25) = 0.5
    check("decode clamps cls/obj to 0..1", True)
    assert decode_stride([[1.0]], [[0.5]], [[0.5, 0.5, 0.0, 0.0]], stride=8,
                         input_size=8, score_threshold=0.9) == []  # sqrt(0.5) ~ 0.71 < 0.9
    check("below-threshold cells filtered", True)
    expect_error(lambda: decode_stride([[1.0]] * 5, [[1.0]] * 5, [[0, 0, 0, 0]] * 5,
                                       stride=8, input_size=64), "malformed")
    check("malformed tensor shapes -> explicit error", True)

    # --- 11. NMS behavior ---
    base = (0.0, 0.0, 10.0, 10.0)
    overlap = (1.0, 1.0, 10.0, 10.0)  # IoU ~0.68 > 0.3 with base
    disjoint = (50.0, 50.0, 10.0, 10.0)
    kept = nms([base + (0.9,), overlap + (0.8,), disjoint + (0.7,)])
    check("NMS suppresses overlapping box, keeps disjoint", len(kept) == 2 and kept[0][4] == 0.9)
    kept = nms([base + (0.8,), base + (0.8,)])  # identical boxes, equal score
    check("NMS deterministic tie-break (first by order kept)", len(kept) == 1 and kept[0][4] == 0.8)
    kept = nms([base + (0.9,), disjoint + (0.8,)], top_k=1)
    check("NMS respects top_k", len(kept) == 1 and kept[0][4] == 0.9)

    # --- 11b. Letterbox preprocessing ---
    blob, scale = preprocess(f1)  # 640x480 -> scale 1.0, pad bottom 160
    assert scale == 1.0 and blob.shape == (1, 3, 640, 640), (scale, blob.shape)
    assert blob[:, :, 480:, :].max() == 0.0, "bottom pad must be zero"
    assert blob[:, :, :480, :].max() > 0.0
    f3 = Image.open(IMAGES / "f3_small_faces.png").convert("RGB")  # 1280x720
    blob3, scale3 = preprocess(f3)
    assert scale3 == 0.5 and blob3.shape == (1, 3, 640, 640), (scale3, blob3.shape)
    assert blob3[:, :, 360:, :].max() == 0.0
    check("letterbox preprocessing (aspect-preserving, zero pad, BGR NCHW)", True)

    # --- 12. Synthetic fixture evaluation (F2: >=1 face, all detections sane) ---
    dets_f2 = det.detect(f2)
    check("F2 multi-scale fixture: >= 1 face detected", len(dets_f2) >= 1, str(dets_f2))

    print(f"ALL CHECKS PASSED ({len(passed)} checks)")


if __name__ == "__main__":
    main()
