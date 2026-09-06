"""Pretrained local FACE detection — ML-1.

Runs the pretrained MTCNN face detector (facenet-pytorch, MIT license)
fully locally. GPU (CUDA) when available, CPU otherwise. No network calls
after install; no images leave this machine.

Library use:
    from face_detector import detect_faces, annotate
    detections, device = detect_faces(pil_image)          # device="auto"
    annotated = annotate(pil_image, detections)

CLI use:
    python ml/inference/face_detector.py ml/dataset/images/synthetic_face.png
    python ml/inference/face_detector.py photo.png --device cpu --annotate out.png

Output shape (conceptual Detection from CONTRACT.md; element_id is added
later by DOM fusion, not here):
    {"category": "FACE", "bbox": [x, y, w, h], "confidence": 0..1, "source": "vision"}
bbox is in image pixel coordinates, top-left origin.
"""

import argparse
import json

from PIL import Image, ImageDraw

VALID_DEVICES = ("auto", "cpu", "cuda")


def pick_device(requested: str = "auto") -> str:
    """Resolve the requested device: 'auto' -> cuda if available, else cpu."""
    if requested not in VALID_DEVICES:
        raise ValueError(f"device must be one of {VALID_DEVICES}, got {requested!r}")
    if requested != "auto":
        return requested
    import torch

    return "cuda" if torch.cuda.is_available() else "cpu"


def detect_faces(
    image: Image.Image,
    device: str = "auto",
    min_confidence: float = 0.5,
) -> tuple[list[dict], str]:
    """Detect faces in a PIL image. Returns (detections, resolved_device)."""
    from facenet_pytorch import MTCNN

    dev = pick_device(device)
    mtcnn = MTCNN(device=dev, keep_all=True, select_largest=False)
    boxes, probs = mtcnn.detect(image)

    detections = []
    if boxes is not None:
        for (x1, y1, x2, y2), p in zip(boxes, probs):
            if p is None or p < min_confidence:
                continue
            detections.append({
                "category": "FACE",
                "bbox": [round(x1), round(y1), round(x2 - x1), round(y2 - y1)],
                "confidence": round(float(p), 4),
                "source": "vision",
            })
    return detections, dev


def annotate(image: Image.Image, detections: list[dict]) -> Image.Image:
    """Return a copy of the image with detection boxes drawn on it."""
    img = image.copy()
    d = ImageDraw.Draw(img)
    for det in detections:
        x, y, w, h = det["bbox"]
        d.rectangle([x, y, x + w, y + h], outline=(220, 30, 30), width=3)
        d.text((x, max(0, y - 14)), f"FACE {det['confidence']:.2f}", fill=(220, 30, 30))
    return img


def main() -> None:
    ap = argparse.ArgumentParser(description="Local pretrained FACE detection (ML-1)")
    ap.add_argument("image", help="path to a local image, e.g. ml/dataset/images/synthetic_face.png")
    ap.add_argument("--device", choices=VALID_DEVICES, default="auto",
                    help="auto = CUDA if available, else CPU (default)")
    ap.add_argument("--annotate", metavar="OUT", help="write an annotated copy of the image to OUT")
    ap.add_argument("--min-confidence", type=float, default=0.5)
    args = ap.parse_args()

    image = Image.open(args.image).convert("RGB")
    detections, device = detect_faces(image, args.device, args.min_confidence)
    if args.annotate:
        annotate(image, detections).save(args.annotate)

    print(json.dumps({"image": args.image, "device": device, "detections": detections}, indent=2))


if __name__ == "__main__":
    main()
