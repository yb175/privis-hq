"""M6-B2 deterministic hard-negative fixtures F8-F12 (YuNet operating-point study).

All five images are adversarial-but-clearly-non-face synthetic content: each is
a geometric drawing that a human annotator would unambiguously label "no human
face". Ground truth is ZERO faces by construction — nothing face-complete is
ever drawn. The point is to falsify (or certify) low YuNet score thresholds:
if a low threshold fires here, it is a genuine false positive.

Deterministic: pure PIL primitives plus seeded random.Random instances (fixed
seeds); rerunning always produces byte-identical PNGs.

Fixtures (640x480 unless noted):
  F8  f8_skin_blobs.png        skin-tone ellipses/blobs, NO features at all
  F9  f9_partial_primitives.png skin ellipses with a SINGLE facial primitive
                                  each (one eye dot / one mouth arc) —
                                  incomplete structures, never a full face
  F10 f10_hand_like.png        fist-like blobs with finger capsules
  F11 f11_lowfreq_texture.png  smooth gradients + low-frequency noise
  F12 f12_circles_animals.png  grouped circle clusters + cartoon cat head
                                  (triangle ears + whiskers — not human)

Annotations go to ml/dataset/annotations/m6b2_face_fixtures.json (separate from
the F1-F7 M6-B manifest, which stays byte-identical).

Usage:
    .venv-ml/Scripts/python.exe ml/scripts/make_m6b2_fixtures.py
"""

import json
import random
from pathlib import Path

from PIL import Image, ImageDraw

IMAGES_DIR = Path(__file__).resolve().parents[1] / "dataset" / "images"
ANNOTATIONS = Path(__file__).resolve().parents[1] / "dataset" / "annotations" / "m6b2_face_fixtures.json"

W, H = 640, 480
SKIN = (224, 172, 140)
SKIN2 = (198, 148, 120)
BG = (228, 232, 238)


def f8_skin_blobs() -> Image.Image:
    """Skin-tone ellipses of varied size/aspect. No eyes/nose/mouth anywhere."""
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    rng = random.Random(8)
    specs = [(40, 60, 90, 120, SKIN), (200, 80, 60, 160, SKIN2),
             (400, 40, 140, 100, SKIN), (450, 260, 110, 130, SKIN2),
             (120, 300, 80, 90, SKIN), (300, 320, 130, 80, SKIN2)]
    for x, y, w, h, c in specs:
        d.ellipse([x, y, x + w, y + h], fill=c)
        if rng.random() > 0.5:  # secondary lobe, still featureless
            d.ellipse([x + w // 2, y + h // 2, x + w + 30, y + h + 30], fill=c)
    return img


def f9_partial_primitives() -> Image.Image:
    """Skin ellipses, each carrying exactly ONE facial primitive.

    One eye-like white+pupil dot; one mouth arc; one brow line. No ellipse
    ever gets two or more primitives — no coherent face exists in the image.
    """
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    # ellipse A: single eye
    d.ellipse([50, 60, 250, 320], fill=SKIN)
    d.ellipse([120, 140, 156, 176], fill=(255, 255, 255))
    d.ellipse([132, 152, 148, 168], fill=(40, 40, 40))
    # ellipse B: single mouth arc
    d.ellipse([350, 80, 560, 330], fill=SKIN2)
    d.arc([410, 200, 500, 250], 15, 165, fill=(150, 60, 50), width=5)
    # ellipse C: single brow line
    d.ellipse([180, 340, 380, 460], fill=SKIN)
    d.line([230, 390, 330, 385], fill=(60, 45, 35), width=5)
    return img


def f10_hand_like() -> Image.Image:
    """Fist-like blobs: rounded palm + four finger capsules on top."""
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    for px, py, s in [(60, 200, 1.0), (330, 180, 1.1)]:
        palm_w, palm_h = int(150 * s), int(130 * s)
        d.rounded_rectangle([px, py, px + palm_w, py + palm_h], radius=int(30 * s), fill=SKIN)
        fw, fh = int(34 * s), int(80 * s)
        for i in range(4):  # fingers
            fx = px + int(10 * s) + i * int(38 * s)
            d.rounded_rectangle([fx, py - fh, fx + fw, py + int(10 * s)], radius=int(16 * s), fill=SKIN)
        d.rounded_rectangle([px + palm_w - int(36 * s), py + int(30 * s),
                             px + palm_w + int(6 * s), py + palm_h + int(10 * s)], radius=int(18 * s), fill=SKIN)  # thumb
    return img


def f11_lowfreq_texture() -> Image.Image:
    """Smooth horizontal gradient + soft large blobs + seeded low-frequency noise."""
    img = Image.new("RGB", (W, H))
    px = img.load()
    rng = random.Random(11)
    # base horizontal gradient
    for x in range(W):
        v = int(60 + 160 * x / W)
        for y in range(H):
            px[x, y] = (v, int(50 + 100 * y / H), int(240 - 120 * x / W))
    d = ImageDraw.Draw(img)
    for _ in range(12):  # soft translucent blobs (no facial arrangement)
        r = rng.randint(30, 90)
        cx, cy = rng.randint(r, W - r), rng.randint(r, H - r)
        d.ellipse([cx - r, cy - r, cx + r, cy + r],
                  fill=(rng.randint(80, 180), rng.randint(60, 160), rng.randint(120, 220)))
    # low-frequency noise: coarse grid of deterministic offsets, smoothed by drawing 2x2
    for gy in range(0, H - 2, 4):
        for gx in range(0, W - 2, 4):
            n = rng.randint(-14, 14)
            d.point([(gx, gy), (gx + 1, gy), (gx, gy + 1), (gx + 1, gy + 1)],
                    fill=(max(0, min(255, px[gx, gy][0] + n)),) * 1)
    return img


def f12_circles_animals() -> Image.Image:
    """Grouped circle clusters (polka patterns) + one cartoon cat head
    (triangle ears, whiskers) — clearly not a human face."""
    img = Image.new("RGB", (W, H), (250, 248, 244))
    d = ImageDraw.Draw(img)
    rng = random.Random(12)
    # circle clusters
    for cx, cy in [(110, 110), (110, 260), (480, 90)]:
        for _ in range(9):
            r = rng.randint(10, 34)
            dx, dy = rng.randint(-50, 50), rng.randint(-50, 50)
            col = (rng.randint(60, 200), rng.randint(60, 200), rng.randint(60, 200))
            d.ellipse([cx + dx - r, cy + dy - r, cx + dx + r, cy + dy + r], outline=col, width=4)
    # cartoon cat head
    hx, hy, hr = 400, 300, 80
    d.ellipse([hx - hr, hy - hr, hx + hr, hy + hr], fill=(210, 200, 190))          # head circle
    d.polygon([(hx - 80, hy - 60), (hx - 55, hy - 140), (hx - 25, hy - 70)], fill=(210, 200, 190))  # left ear
    d.polygon([(hx + 25, hy - 70), (hx + 55, hy - 140), (hx + 80, hy - 60)], fill=(210, 200, 190))  # right ear
    d.line([hx - 60, hy + 10, hx - 100, hy], fill=(120, 110, 100), width=3)        # whiskers
    d.line([hx - 60, hy + 25, hx - 100, hy + 35], fill=(120, 110, 100), width=3)
    d.line([hx + 60, hy + 10, hx + 100, hy], fill=(120, 110, 100), width=3)
    d.line([hx + 60, hy + 25, hx + 100, hy + 35], fill=(120, 110, 100), width=3)
    d.polygon([(hx - 14, hy - 15), (hx, hy + 5), (hx + 14, hy - 15)], fill=(180, 90, 80))  # nose
    return img


FIXTURES = {
    "F8": ("f8_skin_blobs.png", f8_skin_blobs,
           "featureless skin-tone ellipses/blobs of varied size and aspect"),
    "F9": ("f9_partial_primitives.png", f9_partial_primitives,
           "skin ellipses each carrying exactly ONE facial primitive (one eye / one mouth / one brow)"),
    "F10": ("f10_hand_like.png", f10_hand_like,
            "fist-like blobs: rounded palm + four finger capsules + thumb"),
    "F11": ("f11_lowfreq_texture.png", f11_lowfreq_texture,
            "smooth gradients + soft blobs + seeded low-frequency noise"),
    "F12": ("f12_circles_animals.png", f12_circles_animals,
            "grouped circle clusters + cartoon cat head (triangle ears, whiskers)"),
}


def main() -> None:
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    ANNOTATIONS.parent.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for fid, (name, fn, desc) in FIXTURES.items():
        fn().save(IMAGES_DIR / name)
        manifest[fid] = {"image": f"ml/dataset/images/{name}", "width": W, "height": H,
                         "faces": [], "gt_source": f"hard negative (M6-B2): {desc} — zero faces by construction"}
    ANNOTATIONS.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"wrote F8-F12 to {IMAGES_DIR}")
    print(f"wrote annotations to {ANNOTATIONS}")


if __name__ == "__main__":
    main()
