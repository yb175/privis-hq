"""ML-1 smoke test: pretrained FACE detection.

Run from the repository root:
    .venv-ml/Scripts/python.exe ml/inference/test_face_detector.py

Checks: model loads, FACE detections come back, bbox format/bounds are valid,
confidence is sane, CPU fallback works, GPU path works when CUDA is available.
Uses only the deterministic synthetic fixture (no real faces, no network).
Exits 0 with "ALL CHECKS PASSED" on success.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))            # face_detector
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))  # make_synthetic_face

import torch

from face_detector import detect_faces, pick_device
from make_synthetic_face import draw_face


def check(detections: list[dict], img_w: int, img_h: int, label: str) -> None:
    assert detections, f"{label}: expected at least one FACE detection"
    for det in detections:
        assert det["category"] == "FACE", f"{label}: bad category {det['category']!r}"
        x, y, w, h = det["bbox"]
        assert len(det["bbox"]) == 4, f"{label}: bbox must have 4 values"
        assert w > 0 and h > 0, f"{label}: bbox w/h must be positive, got {det['bbox']}"
        assert 0 <= x and x + w <= img_w and 0 <= y and y + h <= img_h, \
            f"{label}: bbox {det['bbox']} outside image bounds {img_w}x{img_h}"
        assert 0.0 <= det["confidence"] <= 1.0, f"{label}: confidence out of range"
        assert det["confidence"] >= 0.5, f"{label}: confidence below detector threshold"
    print(f"  PASS {label}: {len(detections)} face(s), e.g. {detections[0]}")


def main() -> None:
    print(f"torch {torch.__version__}, CUDA available: {torch.cuda.is_available()}")

    # 1. Device selection
    auto = pick_device("auto")
    assert auto in ("cpu", "cuda"), f"pick_device('auto') returned {auto!r}"
    assert pick_device("cpu") == "cpu" and pick_device("cuda") == "cuda"
    print(f"  PASS device auto-detection -> {auto}")

    # 2. CPU fallback (always runs)
    img = draw_face()
    cpu_dets, cpu_dev = detect_faces(img, device="cpu")
    assert cpu_dev == "cpu"
    check(cpu_dets, img.width, img.height, "CPU inference")

    # 3. GPU path (only when CUDA is present) — must agree with CPU
    if torch.cuda.is_available():
        gpu_dets, gpu_dev = detect_faces(img, device="cuda")
        assert gpu_dev == "cuda"
        check(gpu_dets, img.width, img.height, "CUDA inference")
        a, b = cpu_dets[0]["bbox"], gpu_dets[0]["bbox"]
        iou_num = max(0, min(a[0]+a[2], b[0]+b[2]) - max(a[0], b[0])) * \
                  max(0, min(a[1]+a[3], b[1]+b[3]) - max(a[1], b[1]))
        iou_den = a[2]*a[3] + b[2]*b[3] - iou_num
        assert iou_num / iou_den > 0.9, f"CPU/CUDA boxes disagree: {a} vs {b}"
        print("  PASS CPU/CUDA agreement (IoU > 0.9)")
    else:
        print("  SKIP CUDA inference (no CUDA available — CPU fallback verified)")

    print(f"ALL CHECKS PASSED (resolved device: {auto})")


if __name__ == "__main__":
    main()
