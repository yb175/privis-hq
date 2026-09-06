"""Deterministic ML-6B validation fixtures (M6-B offline YuNet validation).

Generates synthetic FACE-detection fixtures F2-F6 and the annotation manifest
for F1-F7. All content is geometric, deterministic, and synthetic — no real
photographs, no real people, no PII. The same code always produces the same
images.

Ground truth is ANALYTIC: every box is derived from the generator parameters
(the drawn head-ellipse rectangle), never hand-labeled, so it can never drift
from the pixels.

Fixtures (see ml/models/face_detection_yunet/README.md for the full table):
  F1  ml/dataset/images/synthetic_face.png  (existing, ML-1)  640x480, 1 face
      GT [220, 120, 200, 260] — head ellipse [220,120,420,380] of
      make_synthetic_face.draw_face().
  F2  f2_multi_scale_faces.png               640x480, 3 faces (scale 1.0/0.5/0.25)
  F3  f3_small_faces.png                   1280x720, 2 small faces (~40x52)
  F4  f4_edge_face.png                       640x480, 1 face clipped by the left
      edge (head at x=-60, scale 1.0 -> 70% visible; GT is the clipped box).
  F5  f5_text_negative.png                   640x480, text-like UI only, 0 faces
  F6  f6_form_negative.png                   640x480, form-rectangle UI only, 0 faces
  F7  ml/dataset/images/synthetic_text.png  (existing, ML-2) 800x480, 0 faces

Usage:
    .venv-ml/Scripts/python.exe ml/scripts/make_m6b_fixtures.py
"""

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

SKIN = (224, 172, 140)
HAIR = (60, 45, 35)
WHITE = (255, 255, 255)
PUPIL = (40, 40, 40)
BG_FACE = (230, 235, 240)

IMAGES_DIR = Path(__file__).resolve().parents[1] / "dataset" / "images"
ANNOTATIONS = Path(__file__).resolve().parents[1] / "dataset" / "annotations" / "m6b_face_fixtures.json"

# Head-ellipse geometry of make_synthetic_face.draw_face, in head-box-relative
# coordinates (head box is 200x260 at the origin; all features scale with s):
#   eyes: centers (65, 100) and (135, 100), white rx 18 ry 15, pupil rx 7 ry 8
#   brows: (45,75)-(85,70) and (115,70)-(155,75), width 5
#   nose: (100,125)-(92,155), width 4
#   mouth arc: [65,140,135,180], 15..165 deg, width 5
#   hair pieslice: [-10,-30, 210,140], 180..360 deg


def draw_face_at(d: ImageDraw.ImageDraw, x: float, y: float, s: float) -> list[float]:
    """Draw one synthetic face with its head box at (x, y), scale s.

    Returns the head bounding box [x, y, 200*s, 260*s] (the analytic GT).
    """
    d.ellipse([x, y, x + 200 * s, y + 260 * s], fill=SKIN)
    d.pieslice([x - 10 * s, y - 30 * s, x + 210 * s, y + 140 * s], 180, 360, fill=HAIR)
    for cx in (x + 65 * s, x + 135 * s):
        d.ellipse([cx - 18 * s, y + 100 * s - 15 * s, cx + 18 * s, y + 100 * s + 15 * s], fill=WHITE)
        d.ellipse([cx - 7 * s, y + 100 * s - 8 * s, cx + 7 * s, y + 100 * s + 8 * s], fill=PUPIL)
    lw = max(1, round(5 * s))
    d.line([x + 45 * s, y + 75 * s, x + 85 * s, y + 70 * s], fill=HAIR, width=lw)
    d.line([x + 115 * s, y + 70 * s, x + 155 * s, y + 75 * s], fill=HAIR, width=lw)
    d.line([x + 100 * s, y + 125 * s, x + 92 * s, y + 155 * s], fill=(190, 130, 100), width=max(1, round(4 * s)))
    d.arc([x + 65 * s, y + 140 * s, x + 135 * s, y + 180 * s], 15, 165, fill=(150, 60, 50), width=max(1, round(5 * s)))
    return [round(x), round(y), round(200 * s), round(260 * s)]


def f2_multi_scale() -> tuple[Image.Image, list[list[int]]]:
    img = Image.new("RGB", (640, 480), BG_FACE)
    d = ImageDraw.Draw(img)
    boxes = [
        draw_face_at(d, 30, 100, 1.0),    # large
        draw_face_at(d, 300, 40, 0.5),    # medium
        draw_face_at(d, 480, 300, 0.25),  # small
    ]
    return img, boxes


def f3_small_faces() -> tuple[Image.Image, list[list[int]]]:
    img = Image.new("RGB", (1280, 720), BG_FACE)
    d = ImageDraw.Draw(img)
    boxes = [
        draw_face_at(d, 200, 200, 0.2),   # ~40x52 head box
        draw_face_at(d, 800, 400, 0.2),
    ]
    return img, boxes


def f4_edge_face() -> tuple[Image.Image, list[list[int]]]:
    # Head box at x=-60: only 140 of 200 px visible (70%). GT is the clipped
    # visible box — the analytic intersection of [x, y, 200, 260] with the image.
    img = Image.new("RGB", (640, 480), BG_FACE)
    d = ImageDraw.Draw(img)
    draw_face_at(d, -60, 140, 1.0)
    return img, [[0, 140, 140, 260]]


def f5_text_negative() -> Image.Image:
    """Pure text-like UI: header bar + rows of word-rectangles. No faces.

    Text is drawn as geometric blocks (not fonts) so the fixture is bit-stable
    across machines and font availability.
    """
    img = Image.new("RGB", (640, 480), (255, 255, 255))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 640, 56], fill=(38, 50, 76))                    # header bar
    d.rectangle([16, 18, 150, 38], fill=(240, 240, 245))               # logo block
    ink = (25, 30, 40)
    y = 90
    for _ in range(7):                                                  # 7 "paragraph" lines
        x = 40
        while x < 560:
            w = 34 if (x // 34) % 4 == 3 else 58                        # word gaps
            d.rectangle([x, y, x + w, y + 14], fill=ink)
            x += w + 12
        y += 32
    d.rectangle([40, 380, 240, 402], fill=(200, 205, 215))              # long field line
    return img


def f6_form_negative() -> Image.Image:
    """Pure form UI: labeled input rectangles, checkbox, button. No faces."""
    img = Image.new("RGB", (640, 480), (245, 246, 248))
    d = ImageDraw.Draw(img)
    border = (150, 155, 165)
    ink = (60, 65, 75)
    y = 80
    for label_h in range(3):                                            # 3 input fields
        d.rectangle([60, y, 560, y + 30], outline=border, width=2)
        d.rectangle([70, y + 10, 150, y + 20], fill=(210, 212, 218))    # placeholder line
        y += 70
    d.rectangle([60, y, 78, y + 18], outline=border, width=2)           # checkbox
    d.rectangle([90, y + 4, 180, y + 14], fill=ink)                     # checkbox label
    d.rectangle([380, y - 8, 560, y + 26], fill=(30, 108, 212))         # button
    d.rectangle([430, y + 2, 510, y + 14], fill=(255, 255, 255))        # button label
    return img


def main() -> None:
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    ANNOTATIONS.parent.mkdir(parents=True, exist_ok=True)

    f2, f2_boxes = f2_multi_scale()
    f2.save(IMAGES_DIR / "f2_multi_scale_faces.png")
    f3, f3_boxes = f3_small_faces()
    f3.save(IMAGES_DIR / "f3_small_faces.png")
    f4, f4_boxes = f4_edge_face()
    f4.save(IMAGES_DIR / "f4_edge_face.png")
    f5_text_negative().save(IMAGES_DIR / "f5_text_negative.png")
    f6_form_negative().save(IMAGES_DIR / "f6_form_negative.png")

    manifest = {
        "F1": {"image": "ml/dataset/images/synthetic_face.png", "width": 640, "height": 480,
               "faces": [[220, 120, 200, 260]],
               "gt_source": "analytic: head ellipse [220,120,420,380] of make_synthetic_face.draw_face"},
        "F2": {"image": "ml/dataset/images/f2_multi_scale_faces.png", "width": 640, "height": 480,
               "faces": f2_boxes, "gt_source": "analytic: draw_face_at(x, y, s) head boxes"},
        "F3": {"image": "ml/dataset/images/f3_small_faces.png", "width": 1280, "height": 720,
               "faces": f3_boxes, "gt_source": "analytic: draw_face_at(x, y, 0.2) head boxes"},
        "F4": {"image": "ml/dataset/images/f4_edge_face.png", "width": 640, "height": 480,
               "faces": f4_boxes, "gt_source": "analytic: draw_face_at(-60, 140, 1.0) head box clipped to image bounds"},
        "F5": {"image": "ml/dataset/images/f5_text_negative.png", "width": 640, "height": 480,
               "faces": [], "gt_source": "negative fixture: geometric text-like UI, no faces drawn"},
        "F6": {"image": "ml/dataset/images/f6_form_negative.png", "width": 640, "height": 480,
               "faces": [], "gt_source": "negative fixture: geometric form UI, no faces drawn"},
        "F7": {"image": "ml/dataset/images/synthetic_text.png", "width": 800, "height": 480,
               "faces": [], "gt_source": "negative fixture: existing ML-2 synthetic text page, no faces"},
    }
    ANNOTATIONS.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"wrote fixtures to {IMAGES_DIR}")
    print(f"wrote annotations to {ANNOTATIONS}")


if __name__ == "__main__":
    main()
