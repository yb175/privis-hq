"""Offline YuNet FACE detection — ML-6B validation reference (NOT browser-wired).

Model: face_detection_yunet_2023mar.onnx from opencv/opencv_zoo
(models/face_detection_yunet/), MIT licensed (c) 2020 Shiqi Yu, trained by
ShiqiYu/libfacedetection.train (export pinned at commit a61a428).
SHA-256 8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4 —
verified at download and re-verified on every load (supply-chain gate).

Runs fully locally via Python onnxruntime (CPUExecutionProvider) — the same
ONNX Runtime family as the browser runtime (ORT Web, M6-A) — so this module
is the offline reference for the later browser parity test. No network calls,
no persistence, synthetic fixtures only.

Artifact I/O contract (INSPECTED from the model, not assumed):
    input  "input"  [1, 3, 640, 640] float32.
    NOTE: the ML-6B spec suggested a 320x320 target, but the 2023mar artifact
    declares a FIXED 640x640 input and ONNX Runtime enforces it (OpenCV DNN
    did not enforce it, which is why upstream demos run 320x320). We therefore
    letterbox to 640x640. Documented in ml/models/face_detection_yunet/README.md.
    12 outputs, flattened cell-major [1, N, C] with N = 6400/1600/400:
    cls_8/16/32 [1,N,1], obj_8/16/32 [1,N,1], bbox_8/16/32 [1,N,4],
    kps_8/16/32 [1,N,10] (landmarks unused by PRIVIS).

Preprocessing (ported from opencv 4.x face_detect.cpp + zoo yunet.py):
    letterbox: scale = 640 / max(w, h) (aspect ratio preserved), bilinear
    resize, anchored top-left, zero-pad right/bottom up to 640x640
    (640 is a multiple of 32); BGR, float32, NCHW, scale factor 1,
    no mean subtraction, no swapRB.

Decode (per stride s in {8, 16, 32}; cols = 640/s; cell idx = r*cols + c):
    score = sqrt(clamp(cls, 0, 1) * clamp(obj, 0, 1))
    cx = (c + dx) * s ; cy = (r + dy) * s ; w = exp(dw) * s ; h = exp(dh) * s
    box = (cx - w/2, cy - h/2, w, h) in 640-input space
NMS: greedy, score-descending (ties by cell order), IoU > 0.3 suppresses,
top_k 5000 — matching OpenCV NMSBoxes behavior in face_detect.cpp.
Default score threshold 0.6 (upstream default).

Output shape (ML-1-compatible; element_id is NOT assigned here — that is
fusion's job):
    {"category": "FACE", "bbox": [x, y, w, h], "confidence": 0..1, "source": "vision"}
    bbox is pixel-space, top-left origin, integer-rounded, clipped to image
    bounds; decoded from 640-space by dividing by the letterbox scale.

Failure semantics (fail-closed):
    missing model / checksum mismatch / corrupt model -> error, never []
    invalid image -> error
    malformed output tensor shape -> explicit error
    completed pass with zero faces (or all scores below threshold) -> []

Library use:
    from yunet_detector import YuNetDetector
    dets = YuNetDetector().detect(pil_image)

CLI use:
    python ml/inference/yunet_detector.py ml/dataset/images/synthetic_face.png
    python ml/inference/yunet_detector.py shot.png --min-confidence 0.45 --annotate out.png
"""

import argparse
import hashlib
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw

MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "face_detection_yunet" / "face_detection_yunet_2023mar.onnx"
EXPECTED_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
EXPECTED_SIZE = 232589

INPUT_SIZE = 640          # the artifact's declared fixed input (see module docstring)
STRIDES = (8, 16, 32)
DEFAULT_SCORE_THRESHOLD = 0.6
DEFAULT_NMS_THRESHOLD = 0.3
DEFAULT_TOP_K = 5000


def verify_model(path: Path = MODEL_PATH) -> None:
    """Supply-chain gate: exact size + SHA-256. Raises; never returns False."""
    if not path.is_file():
        raise FileNotFoundError(f"YuNet model not found: {path}")
    size = path.stat().st_size
    if size != EXPECTED_SIZE:
        raise ValueError(f"YuNet model size mismatch: expected {EXPECTED_SIZE} bytes, got {size}")
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    if sha != EXPECTED_SHA256:
        raise ValueError(f"YuNet model SHA-256 mismatch: expected {EXPECTED_SHA256}, got {sha}")


def _iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    """IoU of two (x, y, w, h) boxes. Mirrors ml/evaluation/evaluate.py:iou."""
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    x1, y1 = max(ax, bx), max(ay, by)
    x2, y2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    inter = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def preprocess(image: Image.Image) -> tuple["object", float]:
    """Letterbox to the fixed 640x640 BGR float32 NCHW input.

    Returns (blob, scale): decode-space coordinates map back to original
    pixels by dividing by `scale`. Aspect ratio preserved, image anchored
    top-left, zero-pad right/bottom.
    """
    w, h = image.size
    scale = INPUT_SIZE / max(w, h)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    resized = image.convert("RGB").resize((nw, nh), Image.BILINEAR)
    import numpy as np
    arr = np.asarray(resized, dtype=np.float32)[:, :, ::-1]  # RGB -> BGR
    canvas = np.zeros((INPUT_SIZE, INPUT_SIZE, 3), dtype=np.float32)
    canvas[:nh, :nw] = arr
    return canvas.transpose(2, 0, 1)[None], scale


def decode_stride(cls, obj, bbox, stride: int, input_size: int = INPUT_SIZE,
                  score_threshold: float = DEFAULT_SCORE_THRESHOLD) -> list[tuple[float, float, float, float, float]]:
    """Decode one stride level of YuNet outputs into input-space candidates.

    cls/obj: arrays of shape (N, 1) or (N,) — flattened [1, N, 1] cell-major.
    bbox: (N, 4). Returns [(x, y, w, h, score), ...] in input (640) space.
    Raises ValueError if shapes are inconsistent with the grid.
    """
    import numpy as np
    cols = input_size // stride
    rows = input_size // stride
    cls = np.asarray(cls, dtype=np.float32).reshape(-1)
    obj = np.asarray(obj, dtype=np.float32).reshape(-1)
    bbox = np.asarray(bbox, dtype=np.float32).reshape(-1, 4)
    n = rows * cols
    if cls.shape[0] != n or obj.shape[0] != n or bbox.shape[0] != n:
        raise ValueError(
            f"malformed YuNet output at stride {stride}: expected {n} cells "
            f"({rows}x{rows}), got cls={cls.shape[0]}, obj={obj.shape[0]}, bbox={bbox.shape[0]}"
        )
    out = []
    for idx in range(n):
        c_score = min(1.0, max(0.0, float(cls[idx])))
        o_score = min(1.0, max(0.0, float(obj[idx])))
        score = math.sqrt(c_score * o_score)
        if score < score_threshold:
            continue
        r, c = divmod(idx, cols)
        dx, dy, dw, dh = (float(v) for v in bbox[idx])
        cx = (c + dx) * stride
        cy = (r + dy) * stride
        w = math.exp(dw) * stride
        h = math.exp(dh) * stride
        out.append((cx - w / 2.0, cy - h / 2.0, w, h, score))
    return out


def nms(candidates: list[tuple[float, float, float, float, float]],
        iou_threshold: float = DEFAULT_NMS_THRESHOLD,
        top_k: int = DEFAULT_TOP_K) -> list[tuple[float, float, float, float, float]]:
    """Greedy NMS, score-descending, ties by candidate order (deterministic).

    A candidate is suppressed when IoU > iou_threshold with an already-kept,
    higher-scoring box — matching OpenCV NMSBoxes. At most top_k kept.
    """
    order = sorted(range(len(candidates)), key=lambda i: (-candidates[i][4], i))
    kept: list[int] = []
    suppressed = [False] * len(candidates)
    for i in order:
        if suppressed[i]:
            continue
        kept.append(i)
        if len(kept) >= top_k:
            break
        for j in order:
            if j != i and not suppressed[j]:
                if _iou(candidates[i][:4], candidates[j][:4]) > iou_threshold:
                    suppressed[j] = True
    return [candidates[i] for i in kept]


class YuNetDetector:
    """Offline YuNet FACE detector (onnxruntime, CPU). See module docstring."""

    def __init__(self, model_path: Path | str = MODEL_PATH,
                 score_threshold: float = DEFAULT_SCORE_THRESHOLD,
                 nms_threshold: float = DEFAULT_NMS_THRESHOLD,
                 top_k: int = DEFAULT_TOP_K,
                 verify: bool = True):
        self.model_path = Path(model_path)
        self.score_threshold = score_threshold
        self.nms_threshold = nms_threshold
        self.top_k = top_k
        if verify:
            verify_model(self.model_path)
        import onnxruntime as ort
        try:
            self.session = ort.InferenceSession(
                str(self.model_path), providers=["CPUExecutionProvider"]
            )
        except Exception as e:  # corrupt/unloadable model -> explicit failure
            raise ValueError(f"YuNetDetector: failed to create ORT session: {e}") from e
        self.input_name = self.session.get_inputs()[0].name
        declared = self.session.get_inputs()[0].shape
        if declared != [1, 3, INPUT_SIZE, INPUT_SIZE]:
            raise ValueError(
                f"YuNetDetector: unexpected input shape {declared}, expected [1,3,{INPUT_SIZE},{INPUT_SIZE}]"
            )

    def infer_raw(self, blob) -> dict:
        """Run the session; return {output_name: ndarray}. Malformed tensors
        are caught in decode; missing names raise here via ORT."""
        outputs = self.session.run(None, {self.input_name: blob})
        return {o.name: v for o, v in zip(self.session.get_outputs(), outputs)}

    def detect(self, image: Image.Image,
               score_threshold: float | None = None) -> list[dict]:
        """Detect faces in a PIL image. Returns ML-1-shaped detections:
        pixel-space, integer-rounded, clipped to image bounds, score-desc.
        Zero faces (completed pass) -> []; any failure -> exception."""
        threshold = self.score_threshold if score_threshold is None else score_threshold
        blob, scale = preprocess(image)
        raw = self.infer_raw(blob)

        candidates: list = []
        for stride in STRIDES:
            candidates += decode_stride(
                raw[f"cls_{stride}"], raw[f"obj_{stride}"], raw[f"bbox_{stride}"],
                stride, INPUT_SIZE, threshold,
            )
        picked = nms(candidates, self.nms_threshold, self.top_k)

        w_img, h_img = image.size
        detections = []
        for x, y, w, h, score in picked:
            # Map back from 640-input space to original pixels, clip to bounds.
            x0 = max(0.0, x / scale)
            y0 = max(0.0, y / scale)
            x1 = min(float(w_img), (x + w) / scale)
            y1 = min(float(h_img), (y + h) / scale)
            if x1 - x0 < 1.0 or y1 - y0 < 1.0:
                continue  # degenerate after clipping
            detections.append({
                "category": "FACE",
                "bbox": [round(x0), round(y0), round(x1 - x0), round(y1 - y0)],
                "confidence": round(score, 4),
                "source": "vision",
            })
        return detections  # already score-desc (NMS order), deterministic


def annotate(image: Image.Image, detections: list[dict]) -> Image.Image:
    """Return a copy of the image with detection boxes drawn (debug only;
    never written by default, never committed)."""
    img = image.copy()
    d = ImageDraw.Draw(img)
    for det in detections:
        x, y, w, h = det["bbox"]
        d.rectangle([x, y, x + w, y + h], outline=(220, 30, 30), width=3)
        d.text((x, max(0, y - 14)), f"FACE {det['confidence']:.2f}", fill=(220, 30, 30))
    return img


def main() -> None:
    ap = argparse.ArgumentParser(description="Offline YuNet FACE detection (ML-6B validation)")
    ap.add_argument("image", help="path to a local image, e.g. ml/dataset/images/synthetic_face.png")
    ap.add_argument("--model", default=str(MODEL_PATH))
    ap.add_argument("--min-confidence", type=float, default=DEFAULT_SCORE_THRESHOLD)
    ap.add_argument("--annotate", metavar="OUT", help="write an annotated copy to OUT (debug only)")
    args = ap.parse_args()

    image = Image.open(args.image).convert("RGB")  # invalid image -> PIL raises
    detector = YuNetDetector(args.model, score_threshold=args.min_confidence)
    detections = detector.detect(image)
    if args.annotate:
        annotate(image, detections).save(args.annotate)
    print(json.dumps({"image": args.image, "detections": detections}, indent=2))


if __name__ == "__main__":
    main()
