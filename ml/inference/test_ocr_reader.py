"""ML-2 smoke test: local pretrained OCR.

Run from the repository root:
    .venv-ml/Scripts/python.exe ml/inference/test_ocr_reader.py

Checks: model loads, OCR returns the fixture's synthetic strings with valid
in-bounds pixel-space bounding boxes and sane confidences, CPU fallback
works, GPU path works when CUDA is available and agrees with CPU.
Uses only the deterministic synthetic fixture (no real PII, no network).
Exits 0 with "ALL CHECKS PASSED" on success.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))            # ocr_reader
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))  # make_synthetic_text

import torch

from ocr_reader import read_text
from make_synthetic_text import draw_text_page

# Strings the fixture contains. The first three must be recognized verbatim.
# The amount is checked by digits only: EasyOCR's English model lacks the
# rupee glyph (it reads '₹' as '{'), so we assert '12,345' survives.
EXACT_STRINGS = ("TEST USER", "test@example.com", "+91 90000 00000")
DIGIT_SUBSTRING = "12,345"


def check(lines: list[dict], img_w: int, img_h: int, label: str) -> None:
    texts = [ln["text"] for ln in lines]
    for expected in EXACT_STRINGS:
        assert expected in texts, f"{label}: expected {expected!r} in OCR output, got {texts}"
    assert any(DIGIT_SUBSTRING in t for t in texts), \
        f"{label}: expected {DIGIT_SUBSTRING!r} in some OCR line, got {texts}"
    for ln in lines:
        x, y, w, h = ln["bbox"]
        assert len(ln["bbox"]) == 4, f"{label}: bbox must have 4 values"
        assert w > 0 and h > 0, f"{label}: bbox w/h must be positive, got {ln['bbox']}"
        assert 0 <= x and x + w <= img_w and 0 <= y and y + h <= img_h, \
            f"{label}: bbox {ln['bbox']} outside image bounds {img_w}x{img_h}"
        assert 0.0 <= ln["confidence"] <= 1.0, f"{label}: confidence out of range: {ln['confidence']}"
    print(f"  PASS {label}: {len(lines)} line(s), e.g. {lines[0]}")


def box_iou(a: list[int], b: list[int]) -> float:
    ax1, ay1, aw, ah = a
    bx1, by1, bw, bh = b
    num = max(0, min(ax1 + aw, bx1 + bw) - max(ax1, bx1)) * \
          max(0, min(ay1 + ah, by1 + bh) - max(ay1, by1))
    den = aw * ah + bw * bh - num
    return num / den


def main() -> None:
    print(f"torch {torch.__version__}, CUDA available: {torch.cuda.is_available()}")

    # 1. CPU fallback (always runs)
    img = draw_text_page()
    cpu_lines, cpu_dev = read_text(img, device="cpu")
    assert cpu_dev == "cpu"
    check(cpu_lines, img.width, img.height, "CPU inference")

    # 2. GPU path (only when CUDA is present) — must broadly agree with CPU
    if torch.cuda.is_available():
        gpu_lines, gpu_dev = read_text(img, device="cuda")
        assert gpu_dev == "cuda"
        check(gpu_lines, img.width, img.height, "CUDA inference")
        for expected in EXACT_STRINGS:  # exact strings on both devices
            assert expected in [ln["text"] for ln in gpu_lines], \
                f"CUDA: expected {expected!r} in OCR output"
        iou = box_iou(cpu_lines[0]["bbox"], gpu_lines[0]["bbox"])
        assert iou > 0.8, f"CPU/CUDA first box disagrees: IoU={iou:.3f}"
        print(f"  PASS CPU/CUDA agreement (first-box IoU={iou:.3f} > 0.8)")
    else:
        print("  SKIP CUDA inference (no CUDA available — CPU fallback verified)")

    print("ALL CHECKS PASSED")


if __name__ == "__main__":
    main()
