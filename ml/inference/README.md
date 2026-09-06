# ml/inference/ — pretrained local inference (ML-1 FACE, ML-2 OCR)

Working local ML milestones that run entirely on this machine:

- **ML-1 — FACE detection** (pretrained MTCNN): the dev-side precursor to
  milestone M2 (trained + exported detector) in [`ml/README.md`](../README.md).
  It proves the model choice, the device handling (GPU/CPU), and the output
  shape before any training or ONNX export happens.
- **ML-2 — OCR text reading** (pretrained EasyOCR): perception only — where
  text is and what characters it contains. No PII classification (that is
  ML-3), no element_id (that is later fusion).

Neither is wired into the browser extension and neither is a runtime
  dependency of it (M5 keeps that path ONNX Runtime Web / WebGPU inside the
  extension).

## ML-1: FACE detection (MTCNN)

### Model

| | |
|---|---|
| **Model** | MTCNN (Multi-task Cascaded Convolutional Networks) — joint face detection + landmark localization |
| **Implementation** | [`facenet-pytorch`](https://github.com/timesler/facenet-pytorch) (pip package, v2.6.0) |
| **Weights** | P-Net / R-Net / O-Net shipped inside the pip package (`data/pnet.npy`, `rnet.npy`, `onet.npy`, ~4 MB total). Downloaded once by pip, installed into `.venv-ml/`, **never committed to this repo** |
| **License** | MIT (code and weights — https://github.com/timesler/facenet-pytorch/blob/master/LICENSE) |
| **Why this model** | Well-maintained, widely used, MIT-licensed, trivial GPU/CPU switching via PyTorch. Alternatives rejected: OpenCV Zoo YuNet (Apache-2.0, excellent, but pip OpenCV DNN is CPU-only on Windows — no GPU path); InsightFace SCRFD (weights are non-commercial licensed); Ultralytics YOLO-face (AGPL-3.0, viral) |

## Installation

Python 3.11 virtual environment at the repo root (already created in this
repo as `.venv-ml/`; it is git-ignored).

```bash
# 1. Create the venv (skip if .venv-ml already exists)
python -m venv .venv-ml

# 2. GPU build (NVIDIA, CUDA 12.1 wheels — works with any driver >= 525)
.venv-ml/Scripts/pip install torch==2.2.2 torchvision==0.17.2 --index-url https://download.pytorch.org/whl/cu121
.venv-ml/Scripts/pip install facenet-pytorch==2.6.0 opencv-python-headless "numpy<2"

# 3. OCR (ML-2)
.venv-ml/Scripts/pip install easyocr==1.7.2 "numpy<2"

#    CPU-only machine? Skip the torch CUDA-index line and let pip pull the
#    CPU build of torch automatically; everything else is identical.
```

Notes:
- `facenet-pytorch` pins `torch==2.2.2` exactly; installing torch first from
  the CUDA index (as above) is what gets you the GPU build.
- `numpy<2` is required: torch 2.2.2 wheels are compiled against NumPy 1.x
  (and easyocr's resolver may try to upgrade it — the explicit `"numpy<2"`
  in step 3 pins it back).
- `easyocr` reuses the same torch install; no second torch.
- Nothing in the install or inference path uploads images anywhere. The only
  network traffic is pip downloading packages and easyocr's one-time model
  weight download (see ML-2 below).

### Inference command (ML-1)

```bash
# Regenerate the deterministic synthetic fixture (optional — it is committed):
.venv-ml/Scripts/python.exe ml/scripts/make_synthetic_face.py

# Run detection on a local image:
.venv-ml/Scripts/python.exe ml/inference/face_detector.py ml/dataset/images/synthetic_face.png

# Options:
#   --device auto|cpu|cuda   auto = CUDA if available, else CPU (default: auto)
#   --annotate OUT.png       write a copy with boxes drawn for visual verification
#   --min-confidence 0.5     drop detections below this confidence
.venv-ml/Scripts/python.exe ml/inference/face_detector.py some/photo.png --device cpu --annotate annotated.png
```

## CPU / GPU behavior

- `--device auto` (default) uses CUDA whenever `torch.cuda.is_available()`
  is true, and silently falls back to CPU otherwise — same code path, same
  output shape, same accuracy (only speed differs).
- `--device cpu` / `--device cuda` force a device. Forcing `cuda` on a
  machine without it fails loudly (PyTorch assertion) — that is intentional.
- The resolved device is printed in every result (`"device"` field) and by
  the smoke test.

### Expected output (ML-1)

```json
{
  "image": "ml/dataset/images/synthetic_face.png",
  "device": "cuda",
  "detections": [
    {
      "category": "FACE",
      "bbox": [244, 153, 170, 188],
      "confidence": 0.7553,
      "source": "vision"
    }
  ]
}
```

- `category` is always the contract string `"FACE"` (see `CONTRACT.md`).
- `bbox` is `[x, y, width, height]` in **image pixel coordinates**,
  top-left origin (matches the contract's `BoundingBox` shape; the
  screenshot-to-CSS-pixel conversion happens later in fusion, not here).
- `confidence` is 0..1.
- `source` is always `"vision"` — model output never claims to be DOM.
- `element_id` is deliberately absent: it is assigned later by DOM fusion
  (element matching by IoU/containment), per `ml/README.md`.

### Smoke test (ML-1)

```bash
.venv-ml/Scripts/python.exe ml/inference/test_face_detector.py
```

Verifies: model loads on auto device; synthetic face is detected; bbox has
4 values, positive width/height, inside image bounds; confidence in 0..1 and
above threshold; CPU fallback runs; CUDA path runs and agrees with CPU
(IoU > 0.9) when a GPU is present. Exits non-zero on any failure.

## ML-2: OCR text reading (EasyOCR)

OCR is **only perception**: it reports where text is and what characters it
contains (`text`, pixel-space `bbox`, `confidence`). It does **not** classify
text as EMAIL / PHONE / PAN / AADHAAR / AMOUNT / NAME — that is ML-3 — and it
does not assign `element_id` — that is later fusion work. It never special-
cases or extracts password values; it reads whatever characters are visible,
nothing more.

### Model

| | |
|---|---|
| **Model** | EasyOCR (CRAFT text detection + CRNN text recognition, English model) |
| **Implementation** | [`easyocr`](https://github.com/JaidedAI/EasyOCR) (pip package, v1.7.2), built on the same PyTorch install as ML-1 |
| **Weights** | Detection (~76 MB) + recognition (~15 MB) `.pth` files, downloaded **once** on first run into `~/.EasyOCR/` (user profile, outside this repo). Never committed. Inference after that is fully offline |
| **License** | Apache-2.0 (code and pre-trained models — https://github.com/JaidedAI/EasyOCR/blob/master/LICENSE) |
| **Why this library** | Permissive license; torch-based so GPU/CPU switching is the same `--device` mechanism as ML-1 (reuses torch 2.2.2+cu121, no extra framework); returns text + quad + confidence per line; works well on Windows/Python 3.11. Alternatives rejected: PaddleOCR (Apache-2.0 but Windows GPU builds are CUDA-version-fragile and pull in the whole Paddle framework); Tesseract/pytesseract (Apache-2.0 but CPU-only — spec requires GPU when supported); TrOCR (MIT, but encoder-decoder single-line — needs a separate detector for boxes); MMOCR (heavy, several models carry restricted licenses) |

### Inference command (ML-2)

```bash
# Regenerate the deterministic synthetic fixture (optional — it is committed):
.venv-ml/Scripts/python.exe ml/scripts/make_synthetic_text.py

# Run OCR on a local image:
.venv-ml/Scripts/python.exe ml/inference/ocr_reader.py ml/dataset/images/synthetic_text.png

# Options: --device auto|cpu|cuda, --annotate OUT.png, --min-confidence 0.3
```

### Expected output (ML-2)

```json
{
  "image": "ml/dataset/images/synthetic_text.png",
  "device": "cuda",
  "lines": [
    {
      "text": "TEST USER",
      "bbox": [77, 61, 186, 36],
      "confidence": 0.9938
    },
    {
      "text": "test@example.com",
      "bbox": [75, 151, 284, 40],
      "confidence": 0.6541
    }
  ]
}
```

- `bbox` is `[x, y, width, height]` in **image pixel coordinates**, top-left
  origin, axis-aligned (EasyOCR's rotated quad reduced to its covering
  rectangle — screenshots are axis-aligned, so nothing is lost). This is
  **pixel space, deliberately separate** from the contract's CSS-pixel
  `BoundingBox`; the devicePixelRatio/scroll conversion happens later in
  fusion, not here.
- `confidence` is 0..1.
- There is **no `category` and no `element_id`**: OCR output is not a
  `Detection`. Categorizing text is ML-3; element alignment is fusion.
- Known limitation: the English recognition model has no rupee glyph — `₹`
  reads as `{` (digits and separators are correct). Fine for ML-2; ML-3
  classifies the amount by pattern on the recognized digits anyway.

### Smoke test (ML-2)

```bash
.venv-ml/Scripts/python.exe ml/inference/test_ocr_reader.py
```

Verifies: model loads; the fixture's strings (`TEST USER`,
`test@example.com`, `+91 90000 00000` verbatim, `12,345` by digits — rupee
glyph aside) are recognized; every bbox has 4 values, positive width/height,
inside image bounds; confidence in 0..1; CPU fallback runs; CUDA path runs
and agrees with CPU (exact strings + first-box IoU > 0.8) when a GPU is
present. Exits non-zero on any failure.

## Files

| File | Purpose |
|------|---------|
| `face_detector.py` | ML-1 detector library (`detect_faces`, `annotate`, `pick_device`) + CLI |
| `test_face_detector.py` | ML-1 smoke test (see above) |
| `ocr_reader.py` | ML-2 OCR library (`read_text`, `annotate`) + CLI |
| `test_ocr_reader.py` | ML-2 smoke test (see above) |
| `../scripts/make_synthetic_face.py` | Deterministic synthetic fixture generator (no real faces) |
| `../scripts/make_synthetic_text.py` | Deterministic synthetic text fixture generator (fake strings only) |
| `../dataset/images/synthetic_face.png` | Committed fixture — synthetic drawing, not a real person |
| `../dataset/images/synthetic_text.png` | Committed fixture — synthetic fake strings, no real PII |

## Privacy

- 100% local: no image or OCR result is ever sent to a cloud API.
- The fixtures are procedurally drawn cartoons/fake strings — no real person's data.
- Model weights stay outside this repo (venv and `~/.EasyOCR/`); no large binaries in git.
- During normal runtime, screenshots and OCR output stay in memory; nothing
  is persisted. The CLI is a dev tool: it reads a path you give it and, with
  `--annotate`, writes an annotated copy of that same local image.
- OCR reads visible characters only; it never extracts password values
  (passwords are handled by DOM semantics per `CONTRACT.md`).
