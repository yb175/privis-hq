# Privis — Phase 00 + 01 Atomic Task Specifications

## Execution rules

Execute tasks strictly in order.

Before each task:

* Read `GEMINI.md`.
* Inspect the current implementation.
* Preserve correct existing work.
* Do not redo completed work.
* Do not implement later tasks early.

A task is complete only when its acceptance criteria are satisfied.

Do not commit, push, merge, or create PRs.

At the end of P00-14, stop for human review.

---

# P00-01 — Establish Baseline

### Objective

Determine the actual current state of Phase 00 and Phase 01 without modifying the repository.

### Inspect

* current Git branch
* `git status`
* recent commit history
* Phase 00/01 changed files
* existing test/build configuration

### Requirements

* Do not modify files.
* Do not reset/revert anything.
* Do not assume the earlier Phase 00/01 reports are complete.
* Identify already-completed work versus genuinely missing work.

### Acceptance

* Current branch identified.
* Existing uncommitted work identified.
* Phase 00/01 implementation state understood.
* No files modified.

---

# P00-02 — Verify Shared Foundation

### Objective

Verify the Phase 00 shared foundation without redesigning it.

### Inspect

* `shared/settings.ts`
* `utils/coords.ts`
* related imports
* TypeScript configuration

### Requirements

Verify:

1. `shared/settings.ts` contains the intended settings implementation.
2. The dependency direction is correct:

   * shared code must not depend on remote-agent code.
3. `utils/coords.ts` contains the required coordinate conversions.
4. Python-fusion rounding behavior remains round-half-even.
5. Canvas coordinate behavior remains Math.round + clamping.
6. Importers resolve through the intended shared modules.
7. No duplicate coordinate implementation has been introduced.

### Acceptance

* Existing implementation is correct, OR minimal corrections are made.
* Focused TypeScript tests/typecheck pass.
* No unrelated files changed.

---

# P00-03 — Verify DOM Detection Extraction

### Objective

Verify that DOM-sensitive detection has been separated from the redaction implementation.

### Inspect

* `privacy/engine/detect-dom.ts`
* structural redaction code
* all importers
* runtime/build file lists
* relevant documentation only if required by implementation

### Requirements

* `detectSensitive` and its detection patterns/constants live in the intended detection module.
* Redaction code consumes detection rather than owning duplicate detection logic.
* All importers use the canonical module.
* No stale duplicate implementation remains active.
* Runtime/build file lists do not reference deleted modules.

### Acceptance

* One active DOM detection implementation exists.
* Relevant tests pass.
* Build succeeds.
* No unrelated cleanup.

---

# P00-04 — Verify runStep Split

### Objective

Verify that `runStep.ts` has been decomposed without changing execution sequencing.

### Inspect

* `runStep.ts`
* `capture.ts`
* `hud.ts`
* `outbound.ts`
* related tests

### Requirements

The following operations must remain in their original logical order:

1. `capturePackage`
2. `runVisionPath`
3. `applyPlaceholders`
4. `redactVisual`
5. `decide`
6. `queryServer`

Verify:

* `queryServer` is still called the intended number of times.
* no fetch/network call occurs before sanitization.
* helper extraction did not alter control flow.
* deleted `hud/` implementation is not still referenced.

### Acceptance

* Sequencing tests pass.
* Relevant regression tests pass.
* No duplicate execution path exists.

---

# P00-05 — Verify Legacy and Manifest Cleanup

### Objective

Verify that obsolete implementation artifacts are actually removed from the active extension.

### Inspect

* `manifest.json`
* `dist/`
* deleted legacy modules
* build configuration

### Requirements

Confirm there are no active references to:

* legacy HUD implementation;
* old remote client;
* old remote README/module;
* dead background entrypoint;
* stale structural-redact bundle;
* stale DOM extractor bundle.

Do not remove anything merely because it looks old. Confirm it is unused first.

### Acceptance

* Production build contains only intended runtime modules.
* Manifest has no stale script entries.
* No active importer references deleted modules.
* Build passes.

---

# P01-06 — Verify Canonical Detection Contract

### Objective

Establish one canonical representation for privacy findings.

### Inspect

* `types/index.ts`
* detection consumers
* `DetectionSource`
* normalization code

### Requirements

Canonical detection must contain the intended fields and use the closed source set:

* `dom`
* `vision`
* `ocr`

Verify:

* no competing detection interface is used for the same purpose;
* callers can safely consume normalized detections;
* source values cannot silently expand;
* confidence and geometry have explicit validation.

### Acceptance

* One canonical `Detection` type is used.
* `DetectionSource` remains closed.
* Typecheck passes.

---

# P01-07 — Complete Privacy Normalization Contract

### Objective

Verify and complete the detection validation/normalization boundary.

### Inspect

* `privacy/engine/normalize.ts`
* detection types
* existing privacy tests

### Requirements

Implement/verify stable validation for:

1. invalid detection;
2. invalid geometry;
3. invalid category;
4. invalid source;
5. invalid confidence.

`normalizeDetection()` must:

* validate required fields;
* validate bbox geometry;
* validate category;
* validate source;
* validate confidence;
* rebuild a clean detection object;
* discard unexpected/smuggled properties.

`normalizeDetections()` must apply the same contract consistently.

### Acceptance

* malformed detections are rejected;
* valid detections normalize successfully;
* extra properties cannot cross the boundary;
* error codes/messages remain stable;
* focused privacy tests pass.

---

# P01-08 — Complete Deterministic Redaction

### Objective

Verify deterministic structural/visual redaction and placeholder behavior.

### Inspect

* structural redaction
* visual redaction
* placeholder logic
* coordinate utilities

### Requirements

#### Structural redaction

* normalize detections before use;
* duplicate findings must not produce duplicate redactions;
* identical values must receive deterministic placeholder identity;
* input ordering must not change placeholder allocation/output.

#### Visual redaction

* validate bbox before coordinate conversion;
* malformed geometry must throw a stable privacy error;
* valid offscreen geometry must clamp safely;
* no unsafe coordinate values may reach canvas operations.

### Acceptance

Tests prove:

* duplicate collapse;
* deterministic output;
* order independence;
* malformed geometry rejection;
* valid offscreen handling.

---

# P01-09 — Enforce DOM Privacy Boundary

### Objective

Prevent DOM-sensitive findings from being fabricated or used without their required backing element.

### Inspect

* DOM redaction
* detection normalization
* FACE handling
* relevant tests

### Requirements

* Non-FACE DOM findings require their backing element.
* Missing backing element must fail closed.
* FACE findings may use synthetic IDs only for the explicitly supported pixel-only path.
* Do not generalize the FACE exception to other categories.

### Acceptance

* missing non-FACE element is rejected;
* FACE synthetic path still works;
* tests cover both cases.

---

# P01-10 — Enforce Outbound Privacy Boundary

### Objective

Guarantee that unsanitized data cannot reach remote providers.

### Inspect

* remote-agent assertion
* router
* OpenAI provider
* Gemini provider
* server transport
* fetch-spy tests

### Requirements

At every outbound provider entry:

* assert the package has passed the sanitizer boundary;
* reject unsanitized input before network access;
* preserve the existing provider interfaces;
* do not introduce an alternate bypass path.

Test both OpenAI and Gemini.

### Acceptance

* unsanitized package causes rejection;
* fetch is not called for rejected input;
* sanitized package reaches the provider normally;
* focused boundary tests pass.

---

# P01-11 — Privacy Contract + Logging Verification

### Objective

Verify the complete Phase 01 privacy contract.

### Inspect

* privacy contract tests
* server logging
* sanitizer/engine logging
* privacy error handling

### Requirements

Verify:

* raw PII is never included in privacy errors;
* raw goals are not logged;
* raw sensitive values are not logged;
* sanitizer/engine has no unsafe console logging;
* server logs use redacted representations;
* adversarial malformed inputs fail safely;
* stable privacy error codes remain intact.

Run the existing seeded adversarial contract suite.

### Acceptance

* privacy contract suite passes;
* logging audit passes;
* no sensitive values appear in generated errors/logs.

---

# P01-12 — Full Phase 00 + 01 Verification

### Objective

Run the complete regression gate after the implementation work.

### Run

```text
npm run typecheck
npm run build
npm test
```

Also run the relevant Python suites, including:

```text
ml/fusion/test_fuse.py
ml/.../test_pii_classifier.py
```

Use the actual repository commands if filenames/scripts differ.

### Requirements

* Do not change implementation merely to hide failures.
* If a failure is caused by existing unrelated work, report it.
* If caused by a current task, fix minimally.
* Verify the pinned runStep invariants.

### Acceptance

All applicable checks pass.

---

# P01-13 — Final Diff and Scope Audit

### Objective

Ensure Phase 00 + 01 contains only intended changes.

### Inspect

* `git diff`
* `git status`
* changed files
* deleted files
* package/dependency changes
* manifest
* tests

### Requirements

Look specifically for:

* accidental refactors;
* unrelated formatting;
* duplicated implementations;
* unnecessary dependencies;
* stale imports;
* debug logging;
* weakened privacy checks;
* modifications outside Phase 00/01 scope.

Do not automatically revert unexpected user changes.

If an unrelated change belongs to existing work, preserve it and report it.

### Acceptance

* No unexplained agent-created changes.
* No privacy boundary regression.
* No accidental dependency additions.
* Scope is ready for human review.

---

# P01-14 — Phase Handoff

### Objective

Prepare the completed Phase 00 + 01 work for human review.

### Requirements

Do not:

* commit;
* push;
* merge;
* create PR;
* start Phase 02.

Provide only:

### Phase

00 + 01

### Completed

14/14 tasks

### Verification

* Typecheck
* Build
* JavaScript tests
* Python tests
* Privacy contract
* Security boundary

### Changes

Short summary of substantive changes.

### Issues

Only actual blockers or known limitations.

### Commit

NOT CREATED — awaiting human approval.

Then STOP.
