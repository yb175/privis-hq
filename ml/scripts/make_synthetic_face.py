"""Deterministic synthetic face fixture generator (ML-1).

Draws a simple cartoon face with PIL. No randomness, no real person, no PII —
the same code always produces the same image. The MTCNN detector reliably
finds this face (confidence ~0.75), which makes it a stable smoke-test target.

Usage:
    python ml/scripts/make_synthetic_face.py [out.png]
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw

SKIN = (224, 172, 140)
HAIR = (60, 45, 35)
BG = (230, 235, 240)


def draw_face() -> Image.Image:
    """Return the synthetic 640x480 face image (deterministic)."""
    img = Image.new("RGB", (640, 480), BG)
    d = ImageDraw.Draw(img)
    d.ellipse([220, 120, 420, 380], fill=SKIN)              # head
    d.pieslice([210, 90, 430, 260], 180, 360, fill=HAIR)    # hair
    for cx in (285, 355):                                    # eyes
        d.ellipse([cx - 18, 205, cx + 18, 235], fill=(255, 255, 255))
        d.ellipse([cx - 7, 212, cx + 7, 228], fill=(40, 40, 40))
    d.line([265, 195, 305, 190], fill=HAIR, width=5)         # brows
    d.line([335, 190, 375, 195], fill=HAIR, width=5)
    d.line([320, 245, 312, 275], fill=(190, 130, 100), width=4)  # nose
    d.arc([285, 260, 355, 300], 15, 165, fill=(150, 60, 50), width=5)  # mouth
    return img


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "dataset/images/synthetic_face.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    draw_face().save(out)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
