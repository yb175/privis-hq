# PRIVIS — PHASE 03 TASKS

## Vision, OCR, Pixel Privacy, and Approved Reference Implementation Integration

**Branch:** `round2/phase-03-vision-ocr`

**Status:** PLANNED

**Phase owner:** Antigravity / Gemini implementation
**Architecture + security review:** GLM
**Human approval required:** commits, pushes, PRs, merges

---

# 1. Phase Objective

Phase 03 integrates the vision/privacy pipeline into Privis.

The objective is to make Privis capable of detecting and sanitizing privacy-sensitive information that cannot reliably be identified from DOM/structural analysis alone, while preserving the privacy guarantees established in Phases 00–02.

Phase 03 covers:

* face detection
* face decoding
* NMS
* inverse letterbox/coordinate recovery
* OCR
* OCR region handling
* vision coordinate normalization
* vision/DOM detection merging
* pixel-level redaction
* local model execution
* model integrity
* deterministic vision fixtures
* privacy-boundary tests
* performance/memory validation

---

# 2. MANDATORY APPROVED-REFERENCE REUSE POLICY

The approved reference implementation contains components that must be **ported/adapted into Privis**, not independently reimplemented.

The permission to reuse the reference implementation is explicit.

For every mapped component below:

1. Locate the reference implementation.
2. Port the substantive implementation into Privis.
3. Preserve the original algorithmic logic unless adaptation is technically necessary.
4. Adapt imports, types, interfaces, paths, runtime APIs, and Privis-specific contracts as necessary.
5. Do NOT replace the implementation with an independently written equivalent.
6. Do NOT merely imitate the behavior.
7. Do NOT summarize the reference implementation and then write a new implementation.
8. Preserve legally required copyright/license notices.
9. Do not mention the reference repository's identity or URL in Privis user-facing documentation, comments, or runtime output unless legally required.
10. Maintain an internal implementation/provenance mapping in the phase audit.

### Mandatory mapping

| Approved reference implementation                | Required Privis integration                                                                         |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `extension/src/offscreen/tasks/face.ts`          | Face decode, NMS, tensor preparation, letterbox/inverse-letterbox logic                             |
| `extension/src/shared/coords.ts`                 | Coordinate utilities, IoU, containment, capture/device scaling, clamping, area calculations         |
| `extension/src/offscreen/tasks/ocr.ts`           | OCR-region processing, opaque-region handling, OCR caching and coordinate handling where compatible |
| `extension/src/offscreen/runtime-ort.ts`         | ONNX Runtime execution/runtime discipline                                                           |
| `extension/src/offscreen/tasks/face.golden.json` | Golden face fixtures where compatible                                                               |
| Reference face tests                             | Port/adapt corresponding deterministic face regression coverage                                     |
| Reference model manifest/hash verification       | Model integrity and weight verification                                                             |
| Reference OCR region/caching logic               | Integrate where compatible with Privis's existing EasyOCR implementation                            |

### Important

**EasyOCR remains the Privis OCR engine unless the phase discovers a concrete, tested reason to change it.**

The goal is to port the reference architecture and strongest surrounding implementation, not blindly replace a stronger existing Privis component.

If a mandatory reference component cannot be ported, STOP and report:

* why it is incompatible
* what portion can be ported
* what Privis-specific adaptation is required
* why an independent implementation would otherwise be necessary

Do not silently substitute a new implementation.

---

# 3. HARD SCOPE BOUNDARIES

## In scope

* browser screenshots/capture
* face detection
* OCR
* visual privacy detection
* pixel redaction
* vision coordinate transforms
* detection merging
* local model execution
* model integrity
* deterministic fixtures
* privacy-boundary testing
* performance testing

## Out of scope

* PDF ingestion
* document ingestion
* document layout analysis
* document OCR
* document-specific redaction
* document corpora
* document evaluation pipelines
* remote vision models
* Phase 04+ features
* new agent capabilities unrelated to vision/privacy

No Phase 03 task may introduce a document-processing subsystem.

---

# 4. ARCHITECTURAL INVARIANTS

The following must remain true:

### 4.1 Canonical detection model

The existing Privis `Detection` type remains authoritative.

Do not introduce a competing finding model unless an explicit adapter is required at a boundary.

### 4.2 Detection sources

`DetectionSource` remains:

```text
dom
vision
ocr
```

### 4.3 Privacy boundary

Raw pixels must never cross the sanitization boundary.

The pipeline must remain conceptually:

```text
capture
  ↓
vision / OCR detection
  ↓
Detection[]
  ↓
normalize
  ↓
deduplicate / merge
  ↓
pixel redaction
  ↓
sanitized capture
  ↓
receipt / integrity verification
  ↓
outbound request
```

### 4.4 Fail closed

Malformed or invalid vision detections must not silently bypass sanitization.

### 4.5 Determinism

Identical input must produce identical:

* detection geometry
* detection category
* confidence
* merge/dedup results
* redaction geometry
* sanitized output

unless nondeterminism is explicitly required by the underlying runtime and is controlled by the implementation.

### 4.6 No network dependency

Vision/OCR processing in Phase 03 must remain local.

No raw screenshot/pixel data may be sent to an external vision API.

---

# 5. TASKS

## P03-01 — Vision/OCR Inventory and Baseline

Audit the current Privis implementation.

Identify:

* existing face detector
* face preprocessing
* face decoding
* NMS
* OCR implementation
* OCR preprocessing
* screenshot capture
* coordinate conversion
* visual redaction
* model loading
* existing tests
* existing fixtures

Compare each relevant subsystem with the mandatory reference mappings.

**Deliverable:**

A baseline report identifying:

* existing Privis implementation
* reference implementation
* reuse status
* required integration work

Do not modify architecture unnecessarily.

---

## P03-02 — Establish Vision Module Boundary

Define the Phase 03 vision boundary.

Separate responsibilities for:

```text
capture
face detection
face decoding
OCR
coordinate conversion
vision normalization
vision/DOM/OCR merge
pixel redaction
model runtime
```

Avoid creating unnecessary abstractions.

Existing Privis modules should be reused where appropriate.

---

## P03-03 — Port Face Detection Implementation

Port/adapt the reference face implementation.

Mandatory areas:

* tensor preparation
* image preprocessing
* letterbox
* model output decoding
* bounding-box conversion
* confidence handling
* NMS
* inverse-letterbox conversion

Preserve substantive reference implementation logic.

Integrate with Privis's existing face detector interface.

Do not independently rewrite these algorithms.

---

## P03-04 — Face Model Runtime Integration

Integrate the approved reference runtime approach with Privis's local model architecture.

Requirements:

* local execution only
* no remote image transmission
* deterministic initialization
* graceful runtime failure
* CPU fallback where appropriate
* no silent privacy bypass

Use the existing Privis runtime where it is compatible.

---

## P03-05 — Face Model Integrity

Port/adapt the reference model manifest/hash discipline.

Verify:

* model existence
* expected model identity
* integrity/hash
* loading failures
* version mismatch behavior

Invalid model state must fail safely.

---

## P03-06 — Port Coordinate Utilities

Port/adapt the strongest relevant portions of the reference coordinate implementation.

Audit against the Phase 00 `utils/coords.ts`.

Do not create duplicate coordinate systems.

Merge functionality into the canonical Privis coordinate utilities.

Required coverage includes where applicable:

* IoU
* containment
* capture scale
* device scale
* viewport conversion
* clamping
* union area
* outside-area calculation

Preserve Privis's documented rounding requirements where they differ for compatibility.

---

## P03-07 — Face Golden Fixtures

Port/adapt the reference face golden fixtures.

Create deterministic tests for:

* face decode
* NMS
* letterbox
* inverse letterbox
* coordinate recovery
* multiple faces
* overlapping faces
* boundary faces
* offscreen/partially visible faces

---

## P03-08 — Face Detection → Detection Adapter

Convert face detections into the canonical Privis `Detection` model.

Requirements:

```text
source = "vision"
category = "FACE"
bbox = validated visual coordinates
confidence = bounded deterministic value
```

Run through the Phase 01 normalization contract.

No raw model-specific object may escape the vision boundary.

---

## P03-09 — OCR Pipeline Audit

Audit Privis EasyOCR against the reference OCR architecture.

Identify which reference components can be integrated without replacing EasyOCR.

Mandatory areas:

* OCR region extraction
* opaque-region handling
* crop generation
* OCR caching
* pixel-hash cache keys
* coordinate recovery
* OCR → Detection conversion

---

## P03-10 — Port OCR Region and Cache Logic

Port/adapt the applicable reference OCR region/caching implementation.

Requirements:

* deterministic cache key
* pixel-based cache identity
* no stale result reuse after pixel changes
* correct crop coordinates
* viewport/capture conversion
* invalid-region rejection

Do not independently recreate the reference cache algorithm when it is technically compatible.

---

## P03-11 — OCR → Detection Adapter

Convert OCR results into the canonical `Detection` model.

Requirements:

* source = `ocr`
* validated bbox
* normalized category
* bounded confidence
* deterministic output
* no raw OCR object crossing the privacy boundary

OCR must not automatically classify every recognized string as sensitive.

Use Phase 02 validators/context qualification where applicable.

---

## P03-12 — Vision/DOM/OCR Coordinate Unification

Establish one canonical coordinate space for merging detections.

Test:

* screenshot → viewport
* viewport → screenshot
* device pixel ratio
* browser zoom
* letterboxed model input
* OCR crop coordinates
* face model coordinates

All merged detections must occupy the same coordinate system before overlap calculations.

---

## P03-13 — Cross-Source Deduplication

Integrate visual detections with Phase 02 DOM/OCR detections.

Handle:

* exact duplicates
* contained boxes
* overlapping boxes
* face overlap
* OCR/DOM overlap
* OCR/face non-overlap
* confidence conflicts

Do not duplicate Phase 02 deduplication logic.

Extend the canonical merge policy.

---

## P03-14 — Pixel Redaction Integration

Integrate face/OCR detections into the existing visual redaction pipeline.

Requirements:

* validate geometry before redaction
* clamp valid offscreen geometry
* reject malformed geometry
* preserve fail-closed behavior
* prevent raw pixels from escaping before redaction
* preserve existing placeholder/redaction contracts

FACE remains pixel-only unless an explicit secure DOM representation exists.

---

## P03-15 — Privacy Boundary Tests

Add adversarial tests proving:

1. raw screenshot is never sent before redaction
2. malformed vision findings fail closed
3. invalid OCR geometry cannot reach outbound payloads
4. face findings always produce pixel sanitization
5. receipt verification still protects sanitized output
6. no remote vision call occurs
7. model failure cannot bypass redaction
8. OCR failure cannot bypass other privacy layers
9. duplicate detections do not cause unsafe behavior

Use network/fetch spies where appropriate.

---

## P03-16 — Determinism Tests

Run identical input through the complete vision pipeline multiple times.

Verify identical:

* detections
* categories
* confidence
* coordinates
* dedup results
* redaction regions
* serialized sanitized output

Seed any controllable randomness.

---

## P03-17 — Performance and Memory Review

Measure:

* face inference latency
* OCR latency
* screenshot memory
* crop memory
* model initialization
* cache effectiveness
* large-page behavior
* multiple-face behavior
* multiple OCR regions

Ensure the pipeline does not retain raw screenshots longer than necessary.

Close/release raw pixel buffers when the privacy boundary allows.

---

## P03-18 — Full Phase Verification

Run all relevant verification.

At minimum:

```text
npm run typecheck
npm run build
npm test
npm run test:privacy
npm run test:privacy-contract
npm run test:gate
```

Run relevant Python tests.

Run all Phase 03 vision/OCR tests.

Verify existing Phase 00–02 tests remain green.

---

## P03-19 — Reference-Reuse Provenance Audit

Produce a technical provenance table.

For every mandatory reference component:

| Reference component | Privis destination | Ported? | Adaptations | Tests |
| ------------------- | ------------------ | ------- | ----------- | ----- |

The audit must distinguish:

* directly ported code
* adapted code
* existing Privis code retained
* code intentionally not ported due to incompatibility

“No need to port” is not acceptable without technical justification.

---

## P03-20 — Final Privacy/Security Audit

Verify:

* no raw pixel leakage
* no network vision calls
* no raw OCR leakage
* no model-data leakage
* fail-closed behavior
* receipt verification
* coordinate safety
* geometry validation
* deterministic behavior
* no privacy weakening
* no duplicate validation bypass
* no document-processing scope creep

---

## P03-21 — Scope Audit

Verify that Phase 03 did NOT introduce:

* agent planning
* new remote providers
* document ingestion
* document OCR
* document layouts
* new user-facing unrelated features
* Phase 04+ functionality

---

## P03-22 — Phase Handoff

Prepare final phase report containing:

1. P03-01 → P03-22 status
2. files modified
3. files added
4. files deleted
5. reference implementations ported
6. exact adaptations
7. tests executed
8. test results
9. performance findings
10. privacy/security findings
11. unresolved issues
12. recommended GLM review points

Do not commit.

Do not push.

Do not create a PR.

Stop after the handoff.

---

# 6. GIT RULES

The following are mandatory:

* Create/use branch `round2/phase-03-vision-ocr`.
* Do NOT commit.
* Do NOT push.
* Do NOT create PRs.
* Do NOT merge.
* Do NOT reset.
* Do NOT revert.
* Do NOT clean.
* Do NOT stash.
* Do NOT discard existing work.
* Preserve all Phase 00–02 changes.

---

# 7. COMPLETION CRITERIA

Phase 03 is complete only when:

* P03-01 through P03-22 are PASS.
* Mandatory reference implementations were actually ported/adapted.
* Reference implementation provenance is documented in the audit.
* Face detection works.
* OCR works.
* Coordinate transformations are correct.
* Vision findings conform to canonical `Detection`.
* DOM/vision/OCR detections merge deterministically.
* Pixel redaction works.
* Privacy boundary tests pass.
* Model integrity checks pass.
* Existing regression suites remain green.
* No document-processing functionality was introduced.
* No raw pixels leave the local sanitization pipeline.
* No commits/pushes/PRs/merges were made.

A behaviorally equivalent independent reimplementation does **not** satisfy the mandatory reference-reuse requirement when the corresponding reference component is technically compatible.
