"""Local pretrained OCR text reading — ML-2.

Runs EasyOCR (Apache-2.0) fully locally. GPU (CUDA) when available, CPU
otherwise. The only network traffic is the one-time pip install and the
one-time model-weight download to ~/.EasyOCR; inference itself never touches
the network and no image leaves this machine.

OCR is ONLY perception: this module reports *where* text is and *what
characters* it contains (text, pixel-space bbox, confidence). It does NOT
classify text as EMAIL / PHONE / PAN / AADHAAR / AMOUNT / NAME — that is
ML-3. It does not assign element_id — that is later fusion work.

Library use:
    from ocr_reader import read_text, annotate
    lines, device = read_text(pil_image)            # device="auto"
    annotated = annotate(pil_image, lines)

CLI use:
    python ml/inference/ocr_reader.py ml/dataset/images/synthetic_text.png
    python ml/inference/ocr_reader.py shot.png --device cpu --annotate out.png

Output shape (per recognized text line):
    {"text": "TEST USER", "bbox": [x, y, w, h], "confidence": 0.99}
bbox is in image pixel coordinates, top-left origin, axis-aligned
(EasyOCR's rotated quad reduced to its covering rectangle — screenshots
are axis-aligned, so nothing is lost). Pixel space stays separate from the
contract's CSS-pixel BoundingBox; that conversion belongs to fusion.
"""

import argparse
import json

from PIL import Image, ImageDraw

from face_detector import VALID_DEVICES, pick_device


def read_text(
    image: Image.Image,
    device: str = "auto",
    min_confidence: float = 0.3,
    languages: tuple[str, ...] = ("en",),
) -> tuple[list[dict], str]:
    """OCR a PIL image. Returns (lines, resolved_device)."""
    from easyocr import Reader

    dev = pick_device(device)
    reader = Reader(list(languages), gpu=(dev == "cuda"), verbose=False)
    import numpy as np
    result = reader.readtext(np.asarray(image))

    lines = []
    for quad, text, conf in result:
        if conf is None or conf < min_confidence:
            continue
        xs = [p[0] for p in quad]
        ys = [p[1] for p in quad]
        x1, y1, x2, y2 = min(xs), min(ys), max(xs), max(ys)
        lines.append({
            "text": text,
            "bbox": [round(x1), round(y1), round(x2 - x1), round(y2 - y1)],
            "confidence": round(float(conf), 4),
        })
    return lines, dev


def annotate(image: Image.Image, lines: list[dict]) -> Image.Image:
    """Return a copy of the image with text boxes + strings drawn on it."""
    img = image.copy()
    d = ImageDraw.Draw(img)
    for ln in lines:
        x, y, w, h = ln["bbox"]
        d.rectangle([x, y, x + w, y + h], outline=(20, 90, 200), width=3)
        d.text((x, max(0, y - 14)), f"{ln['text']} {ln['confidence']:.2f}", fill=(20, 90, 200))
    return img


def main() -> None:
    ap = argparse.ArgumentParser(description="Local pretrained OCR (ML-2)")
    ap.add_argument("image", help="path to a local image, e.g. ml/dataset/images/synthetic_text.png")
    ap.add_argument("--device", choices=VALID_DEVICES, default="auto",
                    help="auto = CUDA if available, else CPU (default)")
    ap.add_argument("--annotate", metavar="OUT", help="write an annotated copy of the image to OUT")
    ap.add_argument("--min-confidence", type=float, default=0.3)
    args = ap.parse_args()

    image = Image.open(args.image).convert("RGB")
    lines, device = read_text(image, args.device, args.min_confidence)
    if args.annotate:
        annotate(image, lines).save(args.annotate)

    print(json.dumps({"image": args.image, "device": device, "lines": lines}, indent=2))


if __name__ == "__main__":
    main()
