"""Deterministic synthetic text fixture generator (ML-2).

Draws fake text lines with PIL. No randomness, no real person, no real PII —
the same code always produces the same image. Values are the ones requested
by the ML-2 spec (and only those).

Usage:
    python ml/scripts/make_synthetic_text.py [out.png]
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BG = (255, 255, 255)
FG = (25, 30, 40)

# Fake test strings — synthetic, never real data.
LINES = [
    "TEST USER",
    "test@example.com",
    "+91 90000 00000",
    "₹12,345",
]

# Windows ships these; first one that loads wins. Needed because PIL's
# built-in bitmap font has no ₹ glyph.
FONT_CANDIDATES = ["arial.ttf", "segoeui.ttf", "DejaVuSans.ttf"]


def load_font(size: int = 32) -> ImageFont.FreeTypeFont:
    for name in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def draw_text_page() -> Image.Image:
    """Return the deterministic 800x480 synthetic text image."""
    img = Image.new("RGB", (800, 480), BG)
    d = ImageDraw.Draw(img)
    font = load_font()
    y = 60
    for line in LINES:
        d.text((80, y), line, fill=FG, font=font)
        y += 90
    return img


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "dataset/images/synthetic_text.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    draw_text_page().save(out)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
