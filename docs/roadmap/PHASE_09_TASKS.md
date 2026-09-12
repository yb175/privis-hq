# PRIVIS — PHASE 09 TASKS

## Real Chrome Validation & End-to-End Verification

**Branch:** `round2/phase-09-chrome-e2e`

## Objective

Move Privis from primarily synthetic/headless verification to genuine Chrome extension validation.

The goal is to verify that the complete Phase 00–08 architecture operates correctly inside the real MV3 browser runtime, including service worker, content scripts, offscreen processing, extension messaging, browser interaction, privacy boundaries, and end-to-end execution.

This phase is validation and targeted correction, not an opportunity to invent unrelated features.

---

## Mandatory Rules

1. Read `GEMINI.md` before modifying anything.
2. Read this entire task file before starting.
3. Inspect the current repository and preserve all previous Phase 00–08 work.
4. Create/use branch `round2/phase-09-chrome-e2e`.
5. Do not reset, revert, clean, stash, discard, or overwrite existing work.
6. Do not commit.
7. Do not push.
8. Do not create PRs.
9. Do not merge.
10. Do not tag or publish.
11. Do not weaken privacy/security guarantees to make E2E tests pass.
12. Do not add document/PDF ingestion or document-specific processing.
13. Reuse the existing/reference implementation where an explicitly mapped browser-runtime component exists. Port actual substantive logic; do not independently recreate it merely because an equivalent implementation is easier.
14. Adapt only interfaces, types, imports, and runtime contracts where necessary.
15. If a mandatory reference implementation is technically incompatible, stop and report the exact incompatibility rather than silently replacing it.

---

# Tasks

## P09-01 — Chrome E2E Inventory and Baseline

Inspect:

* existing browser tests
* Playwright/CDP harness
* MV3 manifest
* service worker
* content scripts
* offscreen document
* extension messaging
* build output

Record what is already genuinely tested in Chrome versus Node/headless/synthetic environments.

Do not modify code merely for inventory.

---

## P09-02 — Real Extension Installation Harness

Establish a reproducible method for loading the built extension into Chrome.

Verify:

* manifest loads
* service worker starts
* content scripts inject
* offscreen functionality initializes
* required assets/models resolve
* no unexpected console/runtime errors occur

---

## P09-03 — MV3 Service Worker Lifecycle

Test:

* startup
* suspension
* restart
* message handling after restart
* state reconstruction
* failure handling

Ensure sensitive state is not accidentally persisted merely because the service worker lifecycle changes.

---

## P09-04 — Content Script Runtime Validation

Validate the real content script against representative webpages.

Test:

* DOM capture
* interactive element detection
* occlusion
* scrolling
* form controls
* dynamic DOM
* navigation
* target re-resolution

---

## P09-05 — Offscreen Runtime Validation

Validate:

* offscreen document lifecycle
* ONNX runtime loading
* face model loading
* OCR execution
* coordinate conversion
* bitmap/canvas lifecycle
* model integrity checks

Confirm no unexpected remote model/network dependency is introduced.

---

## P09-06 — Real DOM Detection

Exercise real webpage DOM content containing:

* valid PII
* invalid PII-like strings
* hard negatives
* contextual labels
* multiple sensitive categories

Verify canonical `Detection` objects are produced.

---

## P09-07 — Real Vision/OCR Pipeline

Run genuine browser capture through:

```text
capture
→ vision/OCR
→ Detection
→ normalization
→ deduplication
```

Verify coordinates against the actual browser viewport/device scale.

---

## P09-08 — Real Redaction and Privacy Gate

Verify:

* DOM redaction
* visual redaction
* placeholder allocation
* Vault interaction
* receipt generation
* receipt verification
* sanitized package generation

Attempt to detect raw sensitive values on every outbound boundary.

---

## P09-09 — Real Deterministic Intent Path

Validate zero-LLM tasks in real Chrome.

Examples:

* click a known action
* type into a known field
* deterministic form interaction

Verify no unnecessary network call occurs.

---

## P09-10 — Real Remote Planner Path

Where configured and safe, validate:

```text
sanitized context
→ remote planner
→ structured plan
→ local schema validation
→ security verification
→ target resolution
→ execution
```

Never allow planner output to execute directly.

Use synthetic/test secrets only.

---

## P09-11 — Dynamic SPA Validation

Test:

* DOM mutation
* lazy rendering
* modal insertion
* React/Vue-style rerenders
* target replacement
* scrolling
* delayed elements
* navigation without full page reload

Verify settle-watch and re-resolution behavior.

---

## P09-12 — Multi-Step Form E2E

Run a realistic multi-step browser task involving:

* multiple fields
* sensitive values
* dynamic form state
* navigation or continuation
* final completion verification

Verify secrets remain local.

---

## P09-13 — Failure and Recovery E2E

Intentionally trigger:

* missing target
* hidden target
* occluded target
* stale target
* malformed planner output
* timeout
* navigation
* model failure

Verify safe failure and correct recovery.

---

## P09-14 — Permissions and Origin Validation

Inspect actual Chrome behavior for:

* host permissions
* content-script scope
* cross-origin navigation
* extension pages
* remote planner access
* local model resources

Minimize permissions where practical without breaking the architecture.

---

## P09-15 — Long-Running Chrome Session

Run repeated tasks in one browser session.

Monitor:

* service-worker behavior
* observers
* listeners
* memory
* canvas/ImageBitmap lifecycle
* Vault lifecycle
* placeholder lifecycle
* retries

Look for cumulative state leakage.

---

## P09-16 — Chrome Security Regression

Run the existing security/privacy suite inside the closest available real-browser environment.

Verify that browser runtime differences do not bypass:

* normalization
* redaction
* gate
* receipt
* planner verification
* Vault
* executor safety

---

## P09-17 — Full Chrome E2E Regression

Run all available browser tests plus the complete existing regression suite.

Record actual:

* commands
* suites
* tests
* failures
* skips
* environment limitations

Do not claim a test passed if it was not actually executed.

---

## P09-18 — Evidence and Reproducibility

Produce reproducible evidence for the important SIH path:

1. user goal
2. detection
3. sanitization
4. redaction
5. planner
6. plan verification
7. execution
8. completion

Record any Chrome-specific limitation.

---

## P09-19 — Targeted Fixes

Fix only genuine Chrome/runtime blockers discovered during the phase.

Every fix must:

* preserve privacy
* preserve existing architecture
* have regression coverage where appropriate
* avoid duplicate implementations
* remain within Phase 09 scope

---

## P09-20 — Full Regression

Run:

```text
npm run typecheck
npm run build
npm test
python ml/evaluation/test_evaluate.py
python ml/fusion/test_fuse.py
```

Also run all relevant browser/E2E commands.

---

## P09-21 — Security Audit

Perform a final Phase 09 browser-runtime security audit.

Focus on:

* extension privilege boundaries
* content-script isolation
* service-worker messaging
* offscreen messaging
* network paths
* raw PII
* raw pixels
* Vault secrets
* planner output
* browser navigation

---

## P09-22 — Reference Provenance Audit

Verify that all Phase 09 reuse of mapped reference browser components contains actual substantive reference logic.

Record:

* source
* destination
* logic ported
* adaptations
* tests

Preserve legally required notices.

Do not expose reference identity/URL in user-facing Privis code or documentation unless legally required.

---

## P09-23 — Scope Audit

Confirm no:

* document/PDF pipeline
* unrelated feature
* duplicate architecture
* unnecessary dependency
* privacy weakening
* speculative refactor

was introduced.

---

## P09-24 — Phase Handoff

Provide a concise but complete final report containing:

* every task status
* exact files changed
* exact tests
* Chrome tests actually run
* environment limitations
* security findings
* privacy findings
* performance findings
* reference provenance
* unresolved issues
* final Phase 09 verdict

STOP after the report.

No commit, push, PR, merge, tag, or release.
