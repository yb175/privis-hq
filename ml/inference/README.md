# ml/inference/ — pretrained FACE detection (ML-1)

First working local ML milestone: a **pretrained** face detector that runs
entirely on this machine. This is the dev-side precursor to milestone M2
(trained + exported detector) in [`ml/README.md`](../README.md) — it proves
the model choice, the device handling (GPU/CPU), and the output shape before
any training or ONNX export happens. It is **not** wired into the browser
extension and is not a runtime dependency of it (M5 keeps that path ONNX
Runtime Web / WebGPU inside the extension).

## Model

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

#    CPU-only machine? Skip the first line and just run the second —
#    pip then pulls the CPU build of torch automatically.
```

Notes:
- `facenet-pytorch` pins `torch==2.2.2` exactly; installing torch first from
  the CUDA index (as above) is what gets you the GPU build.
- `numpy<2` is required: torch 2.2.2 wheels are compiled against NumPy 1.x.
- Nothing in the install or inference path uploads images anywhere. The only
  network traffic is pip downloading packages.

## Inference command

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

## Expected output

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

## Smoke test

```bash
.venv-ml/Scripts/python.exe ml/inference/test_face_detector.py
```

Verifies: model loads on auto device; synthetic face is detected; bbox has
4 values, positive width/height, inside image bounds; confidence in 0..1 and
above threshold; CPU fallback runs; CUDA path runs and agrees with CPU
(IoU > 0.9) when a GPU is present. Exits non-zero on any failure.

## Files

| File | Purpose |
|------|---------|
| `face_detector.py` | Detector library (`detect_faces`, `annotate`, `pick_device`) + CLI |
| `test_face_detector.py` | Smoke test (see above) |
| `../scripts/make_synthetic_face.py` | Deterministic synthetic fixture generator (no real faces) |
| `../dataset/images/synthetic_face.png` | Committed fixture — synthetic drawing, not a real person |

## Privacy

- 100% local: no image or result is ever sent to a cloud API.
- The fixture is a procedurally drawn cartoon — no real person's data.
- Model weights stay inside the git-ignored venv; no large binaries in the repo.
- This folder never writes screenshots to disk; the CLI reads a path you give
  it and, with `--annotate`, writes an annotated copy of that same local image.
