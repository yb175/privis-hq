# ML Subsystem

This folder is the **offline machine-learning side of the Local Privacy Vision
Engine** (architecture box 2, name locked in `CONTRACT.md`). Until now the repo
was TS/DOM-only by contract rule 4; this folder is where the vision path is
built before any of it is wired into the extension.

The runtime contract is unchanged: inference runs **inside the extension**
(ONNX Runtime Web / Transformers.js, WebGPU when available) — never as a local
Python process and never as a network call. This folder produces the datasets,
training code, evaluation harness, and exported models that feed that runtime.

## Directory layout

| Directory | Contents (when populated) |
|-----------|---------------------------|
| `dataset/images/` | Synthetic screenshots / crops for training and evaluation. |
| `dataset/annotations/` | Ground-truth labels (bbox + category) matching the images. |
| `generation/` | Synthetic data generators (portals, documents, faces) — no real PII. |
| `training/` | Training scripts and configs for the detector models. |
| `inference/` | Export + on-device inference glue (ONNX export, preprocessing, postprocessing). Currently: pretrained raw-perception entrypoints — MTCNN FACE detection (ML-1) and EasyOCR text reading (ML-2) — plus deterministic PII classification (ML-3). Both pretrained entrypoints are dev-side baselines only: OCR output (text + pixel-space bbox + confidence) is not a `Detection`; ML-3 classification and fusion are required before anything reaches the Sanitizer. See `inference/README.md`. |
| `fusion/` | DOM + vision detection merging — the `source:"vision"` half of the engine. |
| `evaluation/` | Metrics: precision/recall per category, plus latency budgets. |
| `models/` | Exported ONNX artifacts (committed only as release artifacts, never fabricated). |
| `scripts/` | One-off utilities (dataset stats, format converters, sanity checks). |

The skeleton is populated: pretrained inference baselines (ML-1..ML-3),
fusion, evaluation, and the browser-side port (ML-6*) exist as working code —
see the milestone table below for the current state. No fabricated
placeholder `.onnx` files: `models/` holds only real artifacts.

## Vision inference ↔ `Detection[]`

The ML models never talk to the Sanitizer directly. Everything they see must
be expressed as the contract's `Detection` shape:

```ts
interface Detection {
  element_id: string;
  category: SensitiveCategory;   // exactly the 8 contract strings
  bbox: BoundingBox;             // [x, y, w, h] CSS px, viewport top-left origin
  confidence: number;            // 0..1
  source: "dom" | "vision";      // model output is always "vision"
}
```

The pipeline for a model output:

1. **Screenshot in → boxes out.** The model runs on the in-memory screenshot
   (never a copy on disk) and produces raw pixel-space boxes + category +
   confidence.
2. **Pixel → CSS coordinates.** Screenshots are device-pixel space; `bbox` is
   CSS pixels. Conversion must account for `devicePixelRatio` and scroll offset.
3. **`element_id` alignment.** `dom-extractor` emits `ElementMeta` with real
   `element_id`s. Vision boxes are matched onto those elements (IoU + containment).
   A detection with no backing element keeps the model's own stable id — the
   Sanitizer routes pixel-only PII (e.g. `FACE`) to `redactVisual` by `bbox`,
   per `privacy/sanitizer/README.md`.
4. **Fusion.** DOM and vision detections are merged: overlapping boxes of the
   same category are unioned, keeping the highest confidence
   (`privacy/engine/README.md`). The fused list — one `Detection[]` — is the
   only thing handed to the Sanitizer.

Rule of thumb: the Sanitizer never learns that a model exists. It consumes
`Detection[]`; `source` tells provenance, nothing more.

## Initial categories

The model's output vocabulary is exactly `SensitiveCategory` — no new strings:

- **`FACE`** — first vision target. Pixel-only redaction (blur), no text
  placeholder, no DOM regex can see a face inside arbitrary pixels.
- **`PAN`, `AADHAAR`, `EMAIL`, `PHONE`, `AMOUNT`, `NAME`** — text-PII regions.
  DOM heuristics remain the primary detector (regex on `ElementMeta.text`);
  vision is the fallback for values rendered outside the DOM text layer
  (canvas, images, scanned-document views) and a second opinion for recall.
- **`PASSWORD`** — not a vision category initially. See below.

## Why `PASSWORD` stays on DOM semantics

- `input[type=password]` is a **deterministic, lossless signal** the browser
  itself provides. A vision model is probabilistic; for a privacy boundary you
  use the deterministic signal whenever it exists. A missed password box is a
  contract breach, not a metrics dip.
- The field renders masked (dots/bullets), so there are no password *pixels*
  to learn from — vision could at best re-detect the field shape the DOM
  already identifies for free.
- The contract forbids extracting the value at all: PASSWORD is redacted by
  type, no placeholder, value never read (`CONTRACT.md` → Placeholders).
  A model that sees anything beyond the masked field adds zero information
  and non-zero risk.

Vision may later catch password-like fields in non-standard UI (canvas-rendered
forms); that is a later milestone, not the baseline.

## Milestones

| # | Milestone | Exit criteria |
|---|-----------|---------------|
| M0 | Structure + dataset baseline | `ml/` skeleton + this README; no code, no models. |
| M1 | Synthetic data generation | Generator emits images + annotations covering all 8 categories; zero real PII. |
| ML-1 | **Pretrained FACE inference (done)** | Dev-side baseline before M2: pretrained MTCNN runs locally via `ml/inference/` — GPU when available, CPU fallback, contract-shaped output. No training, no extension wiring. See `inference/README.md`. |
| ML-2 | **Pretrained OCR text reading (done)** | Dev-side baseline before M3: pretrained EasyOCR runs locally — returns text + pixel-space `[x,y,w,h]` bboxes + confidence per line. Perception only: no PII classification (ML-3), no element_id (fusion). See `inference/README.md`. |
| ML-3 | **Deterministic PII classification (done)** | Consumes ML-2 OCR lines, classifies EMAIL/PHONE/PAN/AADHAAR/AMOUNT locally via regex with bbox/confidence preserved, `source:"vision"`, no element_id. Pattern classification only — no validity verification. See `inference/README.md`. |
| M2 | Face detection | Trained + exported `FACE` detector; precision/recall targets met on the synthetic eval split. |
| M3 | Text-PII region detection | Vision fallback for the 6 text categories on DOM-invisible values. |
| ML-4 | **DOM + vision fusion (done)** | `ml/fusion/fuse.py` merges existing DOM detections with ML-1/ML-3 vision detections into `Detection[]`: pixel→CSS scaling, IoU matching (threshold 0.3, deterministic tie-breaks), (element, category) duplicate merge (higher confidence wins, tie→DOM), unmatched FACE kept as `vision-<i>`, unmatched text skipped. See `fusion/README.md`. |
| ML-5 | **Detection evaluation + metrics (done)** | `ml/evaluation/evaluate.py` scores predicted `Detection[]` vs ground truth: one-to-one matching (DOM by element identity, vision by IoU ≥ 0.5), TP/FP/FN/precision/recall/F1 aggregate + per-category, JSON CLI, synthetic fixtures only. See `evaluation/README.md`. |
| M5 | In-extension inference | ONNX Runtime Web / WebGPU inference inside the Local Privacy Vision Engine; no Python process, no network. |
| ML-6A | **ONNX Runtime Web foundation (done)** | ORT Web (WASM-only) session factory in `privacy/engine/vision/ort-runtime.ts` with fail-explicit loading, no-network proof, Node test harness — no model, no pipeline wiring. |
| ML-6B | **YuNet model validation (done: rejected @0.60)** | Offline validation of official YuNet 2023mar (checksum-verified, ML-5-scored vs MTCNN, latency, determinism, 20 tests). All gates pass except recall/F1 at the mandated 0.60 threshold — see `models/face_detection_yunet/README.md`. Not browser-wired. |
| ML-6B2 | **YuNet operating-point justification (done: APPROVED @ 0.35)** | Hard negatives F8–F12 + threshold sweep 0.25–0.65 with unchanged gates. 0.25/0.30 falsified by real FPs (F11 texture); 0.40+ loses a small face; **0.35 passes every gate** (P/R/F1 = 1.000, IoU 0.843, zero FP F5–F12, deterministic, latency green). Thin margin [0.3482, 0.3550] documented. Not browser-wired. |
| ML-6C | **Browser TS port + parity (done: PASS)** | `privacy/engine/vision/face-detector.ts`: faithful port of `ml/inference/yunet_detector.py` (checksum gate, letterbox, decode, NMS, threshold 0.35). Parity on F1–F12 vs `reference_outputs_m6c.json`: identical counts, max box error 0 px, max confidence error 0.0007; latency + determinism green; tampered-model rejection. Unwired. |
| ML-6D | **Pipeline wiring (done: PASS)** | `privacy/engine/vision/face-pipeline.ts` + `privacy/engine/fuse.ts` (M4 rules ported, byte-identical vs Python) wired into `runStep()`: screenshot → RGBA → YuNet → fusion → existing sanitizer/gate/remote. **Fail-closed**: any vision-path error rejects the step before the gate — never `detections = []`. Scenarios A–F + privacy boundary + latency green via `npm run test:face-pipeline`. |
| ML-6E | **Privacy-boundary validation (done: PASS)** | `npm run test:privacy`: 123 checks running the REAL pipeline (real redactVisual via a test-only canvas shim, real sendSanitized last-line defense) over matrix A–H. Verified: FACE pixelated (exact block geometry) before any payload, no FACE text placeholder, PII placeholders unchanged, PASSWORD never extracted, overlap fusion correct, raw-vs-sanitized screenshot hashes differ, fail-closed on model/inference/decode/sanitizer failure, persistence + network audits clean. **No privacy defects found; zero runtime code changed.** |
| M6 | Evaluation + latency budget | Per-category precision/recall and end-to-end step latency measured on device; accuracy/latency trade-off documented (ISRO PS requirement). |

Each milestone is its own issue/branch; nothing here jumps ahead.

## Privacy requirements (non-negotiable)

Mirrors the hard rules in `CONTRACT.md`:

1. **Training data is 100% synthetic.** No real user screenshots, no scraped
   identity documents, no real faces — generated or openly-licensed synthetic
   data only, same philosophy as `fixtures/` and `demo-portal/`.
2. **Screenshots stay in memory.** Inference input is the in-memory
   `dataUrl`; nothing in `ml/` may add a code path that writes raw or
   sanitized screenshots to disk or storage.
3. **No values, only boxes.** Models detect *where* and *what category* —
   never *what value*. The `element_id → real value` mapping table stays
   on-device and out of this folder's scope entirely.
4. **The Remote Agent never sees model output before sanitization.** Vision
   detections flow to the Sanitizer, exactly like DOM detections.
5. **No fabricated models.** `models/` holds only real exported artifacts
   from a real training run; no fake `.onnx` files to satisfy a directory
   listing.
6. **On-device only at runtime.** Once wired in, inference happens in the
   extension (WASM/WebGPU). The Python side of this folder exists only to
   produce datasets and models, and is never a runtime dependency.
