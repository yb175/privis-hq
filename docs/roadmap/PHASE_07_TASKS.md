# PRIVIS — PHASE 07 TASKS

## Evaluation, Adversarial Testing, Reliability, and Benchmarking

**Branch:** `round2/phase-07-evaluation-reliability`

**Status:** PLANNED

---

# Objective

Build a repeatable evaluation system proving that Privis:

* detects sensitive information
* avoids false positives
* redacts correctly
* preserves non-sensitive content
* executes browser tasks reliably
* does not leak data
* remains deterministic

---

# Mandatory reference reuse

Port/adapt the actual evaluation infrastructure from the approved reference where compatible:

* `eval/corpus/`
* `eval/metrics.py`
* `eval/sabotage.py`
* Playwright/CDP evaluation harness
* deterministic rendering methodology
* ground-truth representation
* pixel-identity assertions
* relevant evaluation tests

Do not replace the methodology with an unrelated home-grown benchmark.

---

# Tasks

### P07-01 — Evaluation Architecture

Define:

* corpus
* ground truth
* execution harness
* metrics
* reports

### P07-02 — Port Evaluation Corpus

Port/adapt the reference synthetic corpus methodology.

No document corpus.

### P07-03 — Ground Truth

Represent:

* sensitive regions
* categories
* expected detections
* expected non-detections

### P07-04 — Detection Metrics

Measure separately:

* precision
* recall
* F1
* false-positive rate
* false-negative rate

### P07-05 — Redaction Metrics

Measure:

* missed sensitive pixels
* unnecessary redaction
* region overlap
* pixel preservation

### P07-06 — Agent Metrics

Measure:

* task success
* target accuracy
* planning failures
* execution failures
* completion failures
* retries

### P07-07 — Privacy Metrics

Measure:

* outbound raw-value violations
* raw-pixel violations
* gate bypasses
* planner leakage
* logging leakage

### P07-08 — Determinism

Repeated runs must produce stable results.

### P07-09 — Hard Negatives

Create adversarial non-sensitive values resembling:

* phone numbers
* cards
* IDs
* emails
* names
* amounts

### P07-10 — Caption Tests

Verify caption/context disqualification.

### P07-11 — Checksum Sabotage

Port/adapt reference sabotage methodology.

Disable validators temporarily and prove evaluation metrics degrade.

Restore validators automatically.

### P07-12 — Privacy Gate Sabotage

Attempt to bypass:

* normalization
* redaction
* receipt verification
* planner validation

Every bypass attempt must fail.

### P07-13 — Browser Adversarial Corpus

Test:

* deceptive labels
* overlays
* dynamic DOM
* fake controls
* hidden elements
* stale elements

### P07-14 — Vision Adversarial Corpus

Test:

* partial faces
* overlapping faces
* tiny text
* rotated text
* low contrast
* noisy screenshots

### P07-15 — Regression Baseline

Record baseline metrics.

### P07-16 — Benchmark Harness

Provide repeatable evaluation command.

### P07-17 — Report Generation

Produce machine-readable and human-readable results.

### P07-18 — Performance Benchmark

Measure:

* detection
* vision
* OCR
* planning
* execution

### P07-19 — Full Regression

All unit/integration/evaluation suites.

### P07-20 — Security Audit

Attempt intentional bypasses.

### P07-21 — Reference Provenance Audit

Document actual reference ports.

### P07-22 — Phase Handoff

No commit/push/PR/merge.

---

# Completion

Phase 07 is complete only when the project has reproducible measurements proving detection, redaction, agent execution, and privacy properties.
