# PRIVIS ML QA Report — Local Privacy Vision Engine

- **Product box:** Local Privacy Vision Engine
- **Scope:** ML slice only, issue #21 (`privacy/engine/`)
- **Reviewed:** repository at current checkout
- **Evidence run:** `npm run typecheck`, `npm run test:vision`, `npm run test:face`, `npm run test:face-pipeline`, `npm run test:privacy` — all passed.

## 1. Scope

**In:** browser-local ORT/WASM runtime, YuNet FACE inference, screenshot decode, DOM/vision fusion, `Detection[]` contract, no-network behavior, failure behavior, latency/resource evidence, Sanitizer interface.

**Out:** Capture Layer internals, Sanitizer implementation except consumption of boxes, Policy Gate, Remote Agent, Local Executor, training, production/generalization claims, and OCR quality except whether the engine documents that it is not in the current browser path.

## 2. Inventory

| Path | Status | Notes / real exports and functions |
|---|---|---|
| `privacy/engine/README.md` | implemented, stale sections | Documents the box, categories, coordinates, fusion, fail-closed flow. It also contradicts itself: says M6-A has no model and FACE is “unwired”, while later says M6-D is wired. |
| `privacy/engine/fuse.ts` | implemented | Exports `IOU_THRESHOLD`, `iou()`, `fuseDetections()`. Scales screenshot pixels to CSS viewport pixels, matches IoU >= 0.3, keeps unmatched FACE, skips unmatched non-FACE vision detections. |
| `privacy/engine/vision/ort-runtime.ts` | implemented | Exports `VisionRuntime` and `getVisionRuntime()`. WASM-only ORT, one thread, packaged `chrome.runtime.getURL()` assets, explicit retryable failures. |
| `privacy/engine/vision/face-detector.ts` | implemented | Exports `FaceDetectorInput`, `FaceDetector`, `SCORE_THRESHOLD`, `loadFaceDetector()`. Real YuNet ONNX model, SHA-256/size gate, preprocessing/decode/NMS, FACE-only `Detection[]`. |
| `privacy/engine/vision/face-pipeline.ts` | implemented | Exports `VisionPathOptions`, `runVisionPath()`. Accepts in-memory data URL plus optional DOM elements/detections, decodes to RGBA, runs detector, returns fused `Detection[]`; failures reject. |
| `privacy/engine/vision/test-ort-runtime.ts` | implemented test | Runtime initialization, packaged assets, invalid model failures, no-network/static checks. |
| `privacy/engine/vision/test-face-detector.ts` | implemented test | Real model, F1–F12 parity, determinism, latency gates, tamper rejection, fetch disabled. |
| `privacy/engine/vision/test-face-pipeline.ts` | implemented test | Real model pipeline scenarios A–F, fail-closed behavior, fusion, service-worker ordering, latency, static audit. |
| `privacy/engine/vision/test-privacy-boundary.ts` | implemented test | Real pipeline + real `redactVisual` with a Node-only canvas shim; privacy-boundary and failure checks. |
| `privacy/engine/vision/test-canvas-shim.ts` | test-only support | Node codec/canvas shim; not production inference. |
| `privacy/engine/vision/test-png.ts` | test fixture utility | Synthetic PNG/test image support. |
| `privacy/engine/index.ts` | missing | No single package-level engine index; callers use `vision/face-pipeline.ts` directly. This is not a runtime failure, but is an API discoverability gap. |
| `types/index.ts` | implemented | `SensitiveCategory`, `DetectionSource`, `BoundingBox`, `Detection`. Allowlist exactly matches the requested categories; source type permits `dom` and `vision`. |
| `background/service-worker.ts` | implemented integration | `runStep()` calls `runVisionPath()` after `capturePackage()` and before placeholders, `redactVisual()`, gate, or remote. |
| `privacy/sanitizer/visual-redact.ts` | implemented interface | Exports `redactVisual(dataUrl, detections, viewport)`. Consumes `Detection.bbox` without renaming categories; FACE pixelates and other listed PII categories black out. |
| `ml/models/face_detection_yunet/face_detection_yunet_2023mar.onnx` | implemented artifact | Real 232,589-byte artifact; build and runtime hash-check it. |
| `ml/models/face_detection_yunet/validation_report_b2.json` | implemented evidence | Synthetic F1–F12 evidence; selected threshold 0.35. It is not production accuracy evidence. |
| `scripts/copy-ort-assets.mjs` | implemented build step | Copies and verifies ORT WASM and the model into `dist/`. |
| `ml/inference/ocr_reader.py`, `pii_classifier.py` | implemented but out of browser path | Offline/dev OCR and regex classification exist, but are not called by `runVisionPath()`. No browser OCR `Detection[]` path is present. |
| `fixtures/detections.json` | fixture only | Mock `Detection[]`; not evidence of vision quality. |

## 3. Contract compliance

- **Input:** `runVisionPath()` accepts an in-memory screenshot data URL, `elements`, `domDetections`, and viewport. The detector itself accepts RGBA `FaceDetectorInput`. There is no public API accepting `ImageBitmap` or canvas directly; those are decoded internally.
- **Output:** `runVisionPath(): Promise<Detection[]>`; detector output is metadata only.
- **Categories:** Type-level allowlist is exact. The live browser vision detector currently emits only `FACE`. OCR-like categories are not emitted by this browser path.
- **Source:** detector-generated records always use `source: "vision"`. The fused result may also contain pre-existing DOM records with `source: "dom"`; this is intentional fusion behavior, not a vision-source violation.
- **Bounding boxes:** detector boxes are image/screenshot pixels before fusion. `fuseDetections()` converts them to CSS viewport pixels using screenshot and viewport dimensions. `CONTRACT.md` documents final `[x, y, w, h]`, top-left viewport coordinates.
- **Confidence:** detector clamps/scales model scores and emits values in `[0,1]`; docs and tests state this. There is no independent runtime schema validator for arbitrary injected detector output, so malformed test injections are not rejected before fusion.
- **No outbound raw screenshot:** production engine code uses `fetch(dataUrl)` only for an in-memory `data:` URL decode. Model/runtime bytes resolve to packaged extension assets. Tests disable fetch during model inference and static-audit network APIs.

## 4. Scenario matrix

| ID | Result | Evidence / limitation |
|---|---|---|
| ML-P0-1 | **PASS** | Real YuNet on synthetic visible-face F1 returns FACE, positive box, `source:"vision"`; pipeline test reaches redaction/remote with sanitized output. No-network proof also passes. |
| ML-P0-2 | **PASS** | Invalid/tampered model, decode, and inference failures reject explicitly; shared failure is not cached; service-worker order prevents gate/remote after failure. |
| ML-P0-3 | **PASS** | Runtime/face/pipeline/privacy tests pass with fetch disabled/static audits. Only `data:` decode and packaged extension asset reads are present. |
| ML-P0-4 | **PASS with caveat** | Real detector parity checks category/source/box/confidence and malformed model output fails. No general runtime validator checks arbitrary `Detection[]` for `NaN`/unknown values. |
| ML-P1-1 | **PASS (honest v0)** | Browser engine claims and implements FACE only. OCR/PII classification exists only in offline `ml/inference/`; it is not silently presented as live browser vision. |
| ML-P1-2 | **PASS** | PASSWORD remains DOM-owned; pipeline tests verify password is not invented by vision and remains redacted structurally. |
| ML-P1-3 | **BLOCKED** | Negative/hard-negative fixtures return no faces, but there is no exact blank screenshot fixture/run in the checked suite. |
| ML-P1-4 | **PASS** | F2 contains three synthetic faces; all three are detected, fused, and redaction receives all three boxes. |
| ML-P1-5 | **PASS, evidence-limited** | Test output recorded model load/inference/path timing on the current Node/WASM run. Example observed: face test load 306 ms, first inference 153 ms, steady median 76 ms; pipeline observed first 75 ms, median 64 ms. These are not browser or universal laptop guarantees. |
| ML-P1-6 | **PASS, evidence-limited** | Model is 232,589 bytes; ORT is WASM-only and single-threaded. CPU spike and real browser memory utilization were not measured. |
| ML-P2-1 | **PASS** | `fuseDetections()` documents DOM + vision merge, IoU matching, scaling, tie behavior, and synthetic IDs for unmatched FACE. |
| ML-P2-2 | **PASS / not claimed** | No QR detector claim found in the engine docs/code. Text/PAN/Aadhaar/email live browser vision is not implemented and should not be demoed as implemented. |

## 5. Live-vision score

**10/12 — PASS under the requested rubric, with synthetic-fixture limitations.**

| Dimension | Score | Basis |
|---|---:|---|
| Schema | 2/2 | Real detector parity and contract-shaped output. |
| Face hit-rate on fixtures | 2/2 | F1–F7: 7/7 synthetic faces at selected threshold 0.35; not a population accuracy claim. |
| False positives on blank UI | 1/2 | Hard negatives F8–F12 are clean in the selected evidence, but an exact blank-UI screenshot was not run. |
| Latency honesty | 2/2 | Timings are recorded and explicitly labeled Node/WASM; no invented browser number. |
| Resource honesty | 1/2 | Model size and WASM/single-thread configuration documented; CPU/memory utilization not measured. |
| No-network discipline | 2/2 | Fetch-disabled inference plus static audits pass. |

This score does **not** justify 99% accuracy, general PII recall, or production readiness. The fixture evidence is synthetic and FACE-only.

## 6. Interface to the rest of PRIVIS

- **Exact service-worker call:** `runVisionPath({...})` in `background/service-worker.ts:110`; the public orchestrator entry point is `runStep(tabId, goal)`.
- **Sanitizer compatibility:** `pkg.detections` is passed unchanged to `applyPlaceholders()` and `redactVisual()`. `redactVisual()` consumes `[x,y,w,h]` CSS viewport boxes and preserves category names.
- **Integration status:** repository-level integration is implemented and covered by the Node harness. A real Chrome extension/manual live-tab run was not performed in this QA pass, so that environment remains unverified, not silently passed.
- **Fusion detail:** final `Detection[]` can contain both `source:"dom"` and `source:"vision"`. Matched vision FACE keeps the DOM `element_id`; unmatched FACE uses `vision-<i>` and remains redactable.

## 7. Honesty findings / priorities

### P0

- **No P0 defect found in executed evidence.** Network and raw-image boundary tests passed.
- Maintain fail-closed behavior in `privacy/engine/vision/face-pipeline.ts` and the call order in `background/service-worker.ts`.

### P1

1. **Stale contradictory engine README:** `privacy/engine/README.md` says “M6-A contains no model” and FACE is “unwired”, while the same file later says M6-D is wired and the code is wired. Correct the document before demo/review.
2. **Scope overclaim risk:** `README.md` and `ml/README.md` mention “ONNX/WebGPU vision later” / WebGPU availability, but this path is currently ORT WASM-only; no WebGPU execution is implemented.
3. **FACE-only live browser scope:** OCR/PAN/Aadhaar/email-like image text is not live in `runVisionPath()`. Keep the demo wording explicit: text-in-image is not in this v0 browser path.
4. Add an exact blank screenshot regression fixture and a small runtime output validator if arbitrary detector injection remains part of the public test seam.

### P2

- Add a package-level `privacy/engine/index.ts` or document `runVisionPath()` as the canonical API.
- Measure browser memory/CPU and a real laptop Chrome latency run before making resource or performance claims.
- Add separate live OCR/text-in-image work only if the product requires it; do not treat offline OCR files or `fixtures/detections.json` as live vision evidence.

## 8. Ten-minute replay

1. `npm install`
2. `npm run typecheck`
3. `npm run test:face` — confirms real YuNet model, F1–F12 parity, deterministic boxes, latency, and no-network inference.
4. `npm run test:face-pipeline` — confirms `runVisionPath()`, fusion, three-face case, explicit failures, and service-worker ordering.
5. `npm run test:privacy` — confirms real redaction boundary, no raw screenshot in payload, placeholders, and static persistence/network audits.
6. Inspect `privacy/engine/vision/face-pipeline.ts`, `privacy/engine/vision/face-detector.ts`, and `background/service-worker.ts` to verify the exact call path.
7. Optional manual extension smoke: run `npm run build`, load the repo as an unpacked Chrome extension, open the demo page, and use the extension toolbar. Treat this as a manual environment check; it does not replace the automated evidence above.

## 9. Verdict

**SIH-stageable for FACE.**

The real on-device YuNet path runs, is wired into `runStep()`, returns contract-shaped FACE detections, and has fail-closed/no-network evidence. It is **not production-capable**: evidence is synthetic FACE fixtures, exact blank UI is untested, browser resource usage is unmeasured, and live image-text PII categories are not implemented in this path.
