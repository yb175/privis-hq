# Local Privacy Vision Engine

Architecture box 2 of 6. Name is locked: **Local Privacy Vision Engine**.

## Responsibility

Fuse DOM-rule detections with (later) visual model detections into one detections list. Each detection:

```json
{ "element_id": "f3", "category": "PAN", "bbox": [x, y, w, h], "confidence": 0.92, "source": "dom" | "vision" }
```

Overlapping boxes from both sources are merged (union), keeping the highest confidence. Output goes to the Sanitizer only.

## Categories

`FACE`, `PAN`, `AADHAAR`, `EMAIL`, `PHONE`, `AMOUNT`, `PASSWORD`, `NAME`

## DOM path (now)

Implemented in `privacy/engine/detect-dom.js` (`detectSensitive`): regex matchers for PAN / Aadhaar / email / phone / amount patterns, `input[type=password]` fields, and name-labelled fields to assign categories. Detection lives in the engine; placeholder replacement stays in the Sanitizer (`privacy/sanitizer/structural-redact.js`).

## Canonical finding contract (Phase 01)

`privacy/engine/normalize.ts` is the validation layer every finding crosses
before any consumer uses it — DOM, vision, fused, or a future OCR path:

- `normalizeDetection(s)` validates and **rebuilds** a clean 5-field
  `Detection` (drops any smuggled extra fields).
- `assertValidBBox` rejects non-finite coordinates and zero/negative width or
  height. Negative x/y is allowed (legitimate off-viewport elements).
- Violations throw `PrivacyError` with a stable code (`PRIVIS_INVALID_GEOMETRY`,
  `PRIVIS_INVALID_DETECTION`, ...) — messages never contain raw values — and
  abort the step (fail closed). Findings are never silently dropped.

## Vision path (M6-A: runtime foundation landed)

ONNX Runtime Web running **inside the extension** — not a local Python process, not a
localhost service, never a network call. `privacy/engine/vision/ort-runtime.ts` is the
M6-A foundation:

- **Runtime**: `onnxruntime-web@1.29.0` (MIT), imported via the wasm-only build
  (`onnxruntime-web/wasm`), pinned to the **WASM execution provider**.
- **Bundled assets, zero runtime fetching**: the build
  (`scripts/copy-ort-assets.mjs`) packages `ort-wasm-simd-threaded.mjs` and
  `ort-wasm-simd-threaded.wasm` into `dist/ort/`; the runtime locates them only
  through `chrome.runtime.getURL("dist/ort/")`. No CDN URL is ever configured —
  there is no code path that could fetch a model or runtime from the network.
- **Single-threaded by design**: MV3 service workers have no cross-origin
  isolation (no `SharedArrayBuffer`), so `numThreads` is pinned to 1 and ORT
  never spawns worker threads. SIMD stays on.
- **API**: `getVisionRuntime()` (idempotent, concurrency-safe, failures never
  cached and never swallowed) → `runtime.createSession(modelUrl | bytes)` →
  `ort.InferenceSession`. Model-specific preprocessing/postprocessing starts in
  M6-B; this module knows nothing about faces, categories, DOM, or `Detection[]`.
- **M6-A contains no model.** No `.onnx` file exists yet (also per Forbidden
  below — model artifacts land via `ml/models/` + a build copy step in a later
  milestone). M6-A proves the runtime can host one: tests exercise real WASM
  loading, session creation, and explicit failure on invalid models.
- **No GPU acceleration is claimed.** WebGPU execution (RTX-class GPUs) and an
  offscreen-document execution host are future work, behind the same
  `getVisionRuntime()`/`createSession` interface.
- Tested by `npm run test:vision` (Node harness with a deterministic
  `chrome.runtime.getURL` stub — no browser test framework).

## FACE detector (M6-C: unwired YuNet port landed)

`privacy/engine/vision/face-detector.ts` is a faithful TypeScript port of the
validated offline reference (`ml/inference/yunet_detector.py`, which
reproduces OpenCV's own `cv2.FaceDetectorYN` exactly). Same artifact, same
letterbox preprocessing, same decode, same NMS, same operating point:

- **Model**: the M6-B2-approved YuNet 2023mar artifact (232,589 bytes,
  SHA-256 `8f2383e4…52fa4`, MIT © 2020 Shiqi Yu, opencv_zoo). The build copies
  it to `dist/models/` with a build-time hash check; the detector re-verifies
  size + SHA-256 via `crypto.subtle` before creating the session — a tampered
  or wrong model fails explicitly, never silently returns no faces.
- **Operating point**: score threshold **0.35** (`SCORE_THRESHOLD`) — the
  M6-B2 evidence-backed value (upstream default 0.60 failed recall; 0.30
  failed the hard-negative FP gate; see
  `ml/models/face_detection_yunet/README.md`). NMS IoU 0.3, top-k 5000,
  640×640 letterbox — all identical to the validated reference.
- **Input**: in-memory RGBA pixels (`FaceDetectorInput`, ImageData-shaped).
  Nothing is written to disk; the model never receives or emits image
  content — output is `Detection[]` metadata only.
- **Output**: `Detection[]` with `category: "FACE"`, `source: "vision"`, and
  `element_id: "vision-<i>"` — the fusion contract's convention for
  unmatched vision detections. Final DOM alignment belongs to fusion (M4),
  not the detector.
- **Wired as of M6-D** (via `privacy/engine/vision/face-pipeline.ts`, above);
  the detector itself still knows nothing about capture, fusion, sanitizer,
  policy gate, remote agent, or executor — those couplings live in the
  pipeline module and `runStep()`.
- **Parity**: `npm run test:face` runs the same F1–F12 fixtures as the
  offline validation on the same artifact and compares against
  `ml/models/face_detection_yunet/reference_outputs_m6c.json`: identical
  counts, boxes ≤ 1 px (measured: **0 px** max error), confidence ≤ 0.01
  (measured: 0.0007), plus WASM latency gates and determinism — with
  `fetch` disabled throughout (no-network proof).
- Documented numerical deviation: the bilinear resize computes Pillow's
  triangle filter in float instead of Pillow's fixed-point weights; residual
  sub-LSB intensity differences are covered by the parity tolerances (and
  measured at zero for boxes).

## Fusion (M6-D: DOM + vision fusion runtime landed)

`privacy/engine/fuse.ts` (`fuseDetections`) is the browser runtime port of the
validated Python M4 reference `ml/fusion/fuse.py`, which owns the semantics:
do not change one without the other. Verified byte-identical output against
the Python module on a covering input (matching, ties, duplicates, scaling,
unmatched FACE, skipped non-FACE, insertion order).

- **Coordinates**: vision bboxes (screenshot pixels) are scaled to CSS
  viewport pixels before matching (`viewport / screenshot` per axis,
  round-half-even — Python `round` semantics).
- **Matching**: IoU ≥ 0.3, highest IoU wins, ties break to the earlier
  element. Matched vision detections receive the DOM element's `element_id`
  (source stays `"vision"`).
- **Merge**: keyed by `(element_id, category)`; DOM first; a matched vision
  detection replaces an existing entry only on strictly higher confidence
  (tie → DOM wins). DOM-only PASSWORD always survives.
- **Unmatched FACE**: kept with the synthetic id `vision-<i>`;
  unmatched non-FACE vision detections are skipped (M4 design — the
  placeholder machinery works on real DOM ids).
- Reads only `element_id` + `bbox` from elements; text/label values are
  never accessed (no text leakage).

## Pipeline wiring (M6-D)

`privacy/engine/vision/face-pipeline.ts` (`runVisionPath`) wires the detector
into the end-to-end flow:

    capturePackage() screenshot (in-memory PNG data URL)
      → decode to RGBA (fetch(data:) + createImageBitmap + OffscreenCanvas,
        in memory only — same decode pattern as the sanitizer's redactVisual)
      → YuNet FACE inference (threshold 0.35, shared cached session per
        M6-A runtime design; failures never cached)
      → fuseDetections() (M4 rules)
      → one Detection[] list for the existing sanitizer path

`background/service-worker.ts` calls it in `runStep()` right after
`capturePackage()` — a ~10-line wiring change; no other pipeline stage was
touched. **FAIL-CLOSED (critical)**: any decode/model/inference error rejects
`runVisionPath`, which rejects `runStep()` — the policy gate is never
evaluated and no remote request is made. A failed detector never degrades to
`detections = []` (which would ship an unsanitized screenshot to the remote
agent); zero faces (a valid outcome) is a successful inference returning an
empty list, which is different from failure.

Sanitizer behavior is unchanged: `redactVisual()` pixelates FACE bboxes by
`bbox+category` (it never resolves `element_id`), `applyPlaceholders()` never
invents FACE placeholder text and safely ignores `vision-*` ids, and
PASSWORD/EMAIL/PAN handling is untouched.

Tested by `npm run test:face-pipeline`: scenarios A–F (face page, no-face
page, detector failure fail-closed, DOM+FACE overlap, multiple faces,
non-FACE PII unchanged) against the real model and real modules, plus the
remote privacy boundary (redacted screenshot only, placeholders only, labels
stripped, map and detections never in the payload), the fail-closed ordering
pinned in `service-worker.ts`, latency gates, determinism, and static source
audits. Canvas redaction and the network client themselves are stubbed with
recorders in the Node harness (they cannot run outside the browser); the
real `redactVisual` is unchanged pre-existing code.

## Privacy-boundary validation (M6-E)

`npm run test:privacy` (`test-privacy-boundary.ts`) runs the pipeline with
the REAL `redactVisual` — a test-only canvas shim
(`test-canvas-shim.ts`) supplies the codec layer (OffscreenCanvas /
createImageBitmap / FileReader / data:-URL fetch), so the actual blackout +
pixelate logic executes under Node. The REAL `sendSanitized` last-line
defense also runs on every allowed payload. 123 checks cover the A–H matrix,
raw-vs-sanitized screenshot hash separation, pixel-exact pixelation geometry,
placeholder coverage, PASSWORD handling, policy source ordering, fail-closed
(model/inference/decode/sanitizer), and persistence/network source audits
across all runtime files. Outcome: **no privacy defects found — zero runtime
code changed in M6-E**. Documented shim deviations: the shim canvas encodes
raw RGBA (not PNG) and uses nearest-neighbor sampling where a browser might
average (only affects the smoothing-enabled downscale inside pixelate; block
geometry, blackouts, and unchanged regions are exact).

## Inputs

Capture package from the Capture Layer:

- Screenshot (in memory only — never written to disk)
- Elements + bounding boxes + labels
- Browser state

## Outputs

Detections list for the Sanitizer (shape above).

## Forbidden

- Training scripts, `.py` files, `.onnx` model files in this repo (runtime assets
  under `dist/` are build output, and the ORT wasm library is a npm dependency,
  not a model).
- Raw screenshot upload.
- Runtime network access of any kind (the ORT wasmPaths must always resolve
  inside the extension package).
- Inventing new box names — the engine is one box; the Sanitizer, Policy Gate, etc. are separate.
