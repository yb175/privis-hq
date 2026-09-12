# PRIVIS — PHASE 11 TASKS

## Performance & Reliability

**Branch:** `round2/phase-11-performance-reliability`

## Objective

Make Privis stable under repeated browser tasks, long sessions, large webpages, dynamic DOM changes, vision/OCR processing, retries, and constrained CPU/memory conditions.

Performance improvements must never weaken privacy or correctness.

---

## Mandatory Rules

1. Read `GEMINI.md` and this entire task file.
2. Preserve all previous work.
3. No reset/revert/clean/stash/discard.
4. No commits/pushes/PRs/merges/tags/releases.
5. Measure before changing performance-sensitive code.
6. Do not optimize by bypassing privacy gates.
7. Do not remove validation merely for speed.
8. Do not introduce duplicate implementations.
9. Document/PDF processing remains out of scope.
10. Preserve required reference implementations and licenses.

---

# Tasks

## P11-01 — Performance Baseline

Establish reproducible baselines for:

* DOM detection
* normalization
* redaction
* face inference
* OCR
* fusion
* planner
* browser actions
* completion verification

---

## P11-02 — DOM Detection Benchmark

Measure:

* small DOM
* medium DOM
* large DOM
* repeated detection

Identify unnecessary traversal or repeated computation.

---

## P11-03 — Vision Benchmark

Measure:

* model load
* first inference
* steady-state inference
* repeated inference
* multiple faces

Verify model integrity remains enforced.

---

## P11-04 — OCR Benchmark

Measure:

* region extraction
* inference
* caching
* repeated identical regions
* multiple regions

Verify caches do not retain sensitive data indefinitely.

---

## P11-05 — Fusion / Deduplication Benchmark

Measure multi-source detection merge performance.

Verify optimization does not alter deterministic output.

---

## P11-06 — Redaction Benchmark

Measure:

* structural redaction
* visual redaction
* placeholder allocation
* receipt generation

---

## P11-07 — Agent Latency Benchmark

Measure:

* intent parsing
* resolution
* local model
* planner transport
* plan verification
* execution
* settle
* completion

---

## P11-08 — Browser Interaction Benchmark

Measure:

* target resolution
* scrolling
* form interaction
* action verification
* navigation
* re-resolution
* settling

---

## P11-09 — Memory Baseline

Measure memory behavior across repeated tasks.

Identify:

* DOM retention
* canvas retention
* ImageBitmap retention
* observer retention
* Vault retention
* cache growth
* placeholder growth

---

## P11-10 — ImageBitmap / Canvas Lifecycle

Audit and optimize visual-resource cleanup.

Do not retain raw pixels beyond the necessary privacy lifecycle.

---

## P11-11 — ONNX Runtime Lifecycle

Audit:

* session reuse
* model lifecycle
* tensors
* buffers
* repeated inference

Ensure memory cleanup without compromising model integrity.

---

## P11-12 — Observer / Listener Lifecycle

Inspect:

* MutationObserver
* ResizeObserver
* event listeners
* settle watchers

Verify cleanup after task/session completion.

---

## P11-13 — Cache Bounds

Audit all caches.

For every cache determine:

* key
* value
* maximum lifetime
* maximum size
* invalidation
* sensitive-data exposure

Add bounds where genuinely required.

---

## P11-14 — Vault / Placeholder Memory Lifecycle

Verify:

* TTL
* explicit deletion
* session completion
* failure
* cancellation
* `forgetAll`

No optimization may extend secret lifetime.

---

## P11-15 — Retry and Timeout Analysis

Verify:

* bounded retries
* timeout budget
* no retry storm
* no duplicate actions
* no privacy-boundary bypass during retry

---

## P11-16 — Long-Running Session Test

Run repeated tasks for an extended period.

Monitor:

* memory
* CPU
* observers
* network
* Vault
* caches
* model state

---

## P11-17 — Stress Test

Test:

* large DOM
* many fields
* many detections
* multiple faces
* multiple OCR regions
* repeated navigation
* repeated planner failures

---

## P11-18 — Constrained Environment

Test behavior under:

* CPU pressure
* slow network
* unavailable remote planner
* model load failure
* memory pressure where practical

Verify graceful failure.

---

## P11-19 — Performance Regression Thresholds

Establish realistic thresholds from measured baselines.

Do not invent arbitrary performance numbers.

---

## P11-20 — Targeted Performance Fixes

Fix only measurable problems.

For each fix record before/after measurement.

---

## P11-21 — Reliability Regression

Run all relevant:

* browser
* agent
* detection
* vision
* privacy
* evaluation

tests.

---

## P11-22 — Full Regression

Run:

```text
npm run typecheck
npm run build
npm test
python ml/evaluation/test_evaluate.py
python ml/fusion/test_fuse.py
```

plus relevant E2E/performance tests.

---

## P11-23 — Security / Privacy Audit

Verify optimizations did not:

* bypass sanitization
* retain secrets
* retain raw pixels
* bypass receipt checks
* bypass plan verification

---

## P11-24 — Reference Provenance Audit

Verify no optimization replaced substantive mapped reference algorithms without justification.

---

## P11-25 — Scope Audit

No unrelated features.

No document pipeline.

No speculative optimization.

---

## P11-26 — Phase Handoff

Report:

* baselines
* measurements
* fixes
* before/after results
* memory findings
* reliability findings
* security/privacy verification
* tests
* provenance
* unresolved issues
* final verdict

STOP without commit/push/release.
