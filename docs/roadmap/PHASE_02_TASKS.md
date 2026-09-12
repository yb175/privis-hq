# Phase 02 — Detection Engine

## Status

**PLANNED — NOT STARTED**

Phase 00–01 established the foundation and privacy boundary.

Phase 02 builds the deterministic detection engine on top of that foundation.

This phase must improve Privis detection quality without weakening the privacy boundary established in Phase 00–01.

---

# 1. Mission

Build a strong, deterministic, privacy-preserving detection engine capable of identifying sensitive values from browser-visible content using:

1. DOM/structural evidence
2. lexical/contextual evidence
3. deterministic format/checksum validation
4. confidence scoring
5. category classification
6. provenance/source tracking
7. deterministic deduplication and merging
8. negative-context suppression
9. hard-negative resistance

The resulting detections must feed the existing canonical `Detection` contract and existing privacy normalization/redaction pipeline.

The engine must remain deterministic for identical inputs.

---

# 2. Primary Architectural Goal

The detection pipeline should conceptually become:

```text
Browser-visible content
        ↓
DOM / structural observations
        ↓
Lexical candidate extraction
        ↓
Format / checksum validation
        ↓
Context qualification
        ↓
Category classification
        ↓
Confidence calculation
        ↓
Detection normalization
        ↓
Deterministic deduplication / merging
        ↓
Canonical Detection[]
        ↓
Existing privacy sanitizer
```

Phase 02 does NOT replace the sanitizer.

The sanitizer remains the final privacy boundary.

Detection code must never assume that a detection is safe merely because it was produced internally.

All detections entering the sanitizer must continue to pass the Phase 00–01 validation/normalization contract.

---

# 3. Mandatory Rules

## 3.1 No commits

Antigravity must not:

* commit
* push
* create PRs
* merge
* reset
* revert
* discard
* clean
* stash existing work

Human approval is required before any commit.

---

## 3.2 Preserve existing work

Phase 00–01 contains intentional uncommitted changes.

Never overwrite or discard them.

Before modifying a file:

1. inspect it
2. understand existing behavior
3. preserve compatible behavior
4. make the smallest required change

If an existing change conflicts with Phase 02 requirements, stop and report the conflict rather than reverting it.

---

## 3.3 One branch per phase

Phase 02 branch:

```text
round2/phase-02-detection-engine
```

Do not create additional phase branches unless explicitly instructed.

---

## 3.4 Reference implementation

`SIH26171` / PravAI is the highest-priority reference implementation for Phase 02.

Use it to identify stronger implementations of:

* deterministic PII validators
* checksum validation
* lexical candidate detection
* negative context
* caption disqualification
* confidence handling
* hard-negative resistance
* detection categorization
* deterministic merging
* detection testing

Where the reference implementation is suitable:

* reuse/adapt behavior directly where legally permitted
* preserve its license/copyright requirements
* prefer proven implementations over inventing weaker replacements
* avoid unnecessary rewrites
* avoid unnecessary dependencies

Do not mention the reference repository name, URL, or source provenance in Privis user-facing documentation, comments, UI, logs, or error messages unless legally required.

Do not copy unrelated reference architecture merely because it exists.

---

# 4. Scope

## IN SCOPE

* DOM/structural detection improvements
* lexical candidate extraction
* deterministic PII format validators
* checksum validators
* contextual qualification
* negative context
* caption disqualification
* confidence scoring
* category classification
* source/provenance handling
* deterministic deduplication
* overlapping detection merging
* detection priority
* hard-negative handling
* deterministic tests
* detection benchmarks/fixtures where useful
* integration with the existing canonical Detection model

## OUT OF SCOPE

Do NOT implement:

* PDF ingestion
* document ingestion
* document OCR
* document layout analysis
* document redaction
* document corpus processing
* document-specific evaluation
* secret vault
* Tier 0/1/2 agent architecture
* local Ollama
* remote VLM planner
* browser execution changes
* new remote APIs
* provider replacement
* UI redesign
* release packaging
* unrelated refactoring

Vision/face/OCR implementation belongs to Phase 03.

---

# 5. Canonical Detection Contract

The existing canonical `Detection` type remains authoritative.

Do not create a competing detection interface.

The detection contract must retain explicit:

* category
* value
* bounding box/geometry
* confidence
* source

`DetectionSource` remains the closed set:

```text
dom
vision
ocr
```

Phase 02 primarily produces DOM/lexical detections.

Do not introduce arbitrary new source values.

Any proposed source-model change requires escalation.

---

# 6. Task Execution Rules

Execute tasks sequentially.

Do not implement future tasks early.

For every task:

1. inspect relevant existing implementation
2. inspect relevant reference implementation where applicable
3. identify the smallest coherent change
4. implement it
5. add/update focused tests
6. run focused verification
7. inspect the diff
8. report concise completion
9. proceed to the next pending task

If a task reveals an architecture decision that affects privacy, outbound data, the canonical detection contract, or another phase, stop and escalate.

---

# P02-01 — Detection Engine Inventory and Baseline

## Objective

Establish the exact current detection architecture before modifying it.

## Requirements

Inspect:

* `types/index.ts`
* `privacy/engine/detect-dom.ts`
* `privacy/engine/normalize.ts`
* `privacy/sanitizer/structural-redact.ts`
* all current detection-related tests
* all importers of detection utilities
* package scripts relevant to tests/build
* existing lexical/PII detection implementation, if any

Also inspect the corresponding Phase 02-relevant parts of SIH26171 / PravAI.

Document internally:

* current detection flow
* current categories
* current patterns
* current confidence behavior
* current duplicate handling
* current structural detection limitations
* reusable reference implementations
* likely integration points

## Acceptance

* No behavior changes.
* No new dependencies.
* No duplicate detection model introduced.
* Baseline test suite remains green.
* A concise baseline report identifies exactly where Phase 02 work belongs.

---

# P02-02 — Detection Module Boundary

## Objective

Establish a clean detection-engine boundary without changing observable behavior unnecessarily.

## Requirements

Create or consolidate a canonical detection-engine module structure under:

```text
privacy/engine/
```

Keep responsibilities separated:

```text
candidate extraction
→ validation
→ contextual qualification
→ classification
→ confidence
→ merge/dedupe
```

Do not duplicate normalization logic.

`normalize.ts` remains responsible for canonical detection validation/normalization.

The detection engine must produce objects compatible with the existing canonical `Detection` contract.

## Acceptance

* No competing Detection interface.
* Existing callers continue to work.
* No sanitizer behavior regression.
* Typecheck passes.
* Focused detection tests pass.

---

# P02-03 — Deterministic Candidate Extraction

## Objective

Create deterministic lexical candidate extraction from browser-visible textual content.

## Requirements

Support candidate extraction for relevant sensitive categories already represented by Privis.

Candidate extraction must:

* be deterministic
* preserve candidate location where available
* avoid sending content externally
* avoid model calls
* avoid network access
* not depend on random state
* not mutate input content

Candidates should retain enough local context for later qualification.

Do not classify every regex match as sensitive automatically.

## Acceptance

* Identical input produces identical candidates.
* Candidate positions are deterministic.
* No network access occurs.
* Hard-coded test fixtures cover positive and negative candidates.
* Existing privacy tests remain green.

---

# P02-04 — Deterministic PII Validators

## Objective

Strengthen detection using deterministic format and checksum validation.

## Requirements

Inspect and, where appropriate, adapt the strongest applicable validators from SIH26171 / PravAI.

Priority categories include applicable formats such as:

* Aadhaar
* payment-card numbers
* PAN
* GSTIN
* IFSC
* UPI identifiers
* Indian mobile numbers
* passport identifiers
* driving-license identifiers
* PIN/postal codes
* dates/birthdates where context makes them sensitive

Only implement validators for formats relevant to Privis.

Validators must:

* be deterministic
* be dependency-light
* operate locally
* reject malformed candidates
* distinguish format validity from contextual sensitivity
* avoid treating a valid-looking random number as automatically sensitive

Where checksum algorithms exist, use them.

Do not weaken an existing stronger validator merely to unify implementation.

## Acceptance

* Positive fixtures validate.
* Invalid/checksum-failing fixtures reject.
* Hard negatives are included.
* Validators have focused unit tests.
* No external service/API is required.
* No raw candidate values appear in errors/logs.

---

# P02-05 — Contextual Qualification

## Objective

Use surrounding textual context to distinguish real sensitive data from harmless numeric/string matches.

## Requirements

Implement deterministic contextual qualification.

Examples of useful context include:

* field labels
* nearby text
* headings
* aria-labels
* placeholders
* semantic attributes
* known category terms
* surrounding words

Context must influence confidence/classification rather than blindly forcing detection.

Implement both:

### Positive context

Examples:

```text
Aadhaar
PAN
GSTIN
IFSC
account number
card number
UPI
passport
driving licence
mobile
date of birth
```

### Negative context

Examples should include contexts where numeric/string values are likely harmless:

* product identifiers
* order numbers
* tracking IDs
* inventory numbers
* page numbers
* timestamps
* measurements
* prices
* generic counters

The exact negative vocabulary should be evidence-based and tested.

## Acceptance

* Positive contextual examples improve detection.
* Negative contextual examples suppress false positives.
* Context scoring is deterministic.
* Context does not bypass checksum/format validation where a validator is required.
* Tests cover conflicting positive and negative context.

---

# P02-06 — Caption / Disqualification Rules

## Objective

Adopt the proven negative-caption behavior from the reference implementation where applicable.

## Requirements

Implement deterministic caption/label disqualification.

A candidate should be suppressible when surrounding context strongly indicates that the value is not a sensitive personal identifier.

Use the SIH26171 / PravAI `disqualifiedByCaption` behavior as the primary reference.

Adapt it to Privis's existing detection data structures.

Do not copy unrelated lexical architecture.

## Acceptance

* Caption-disqualified candidates do not become detections.
* Positive sensitive captions continue to detect valid candidates.
* Hard-negative fixtures cover common false-positive contexts.
* Regression test demonstrates that disabling the disqualification rule increases false positives.

---

# P02-07 — Category Classification

## Objective

Provide deterministic category classification for validated candidates.

## Requirements

Classification must consider:

1. format
2. checksum result where applicable
3. positive context
4. negative context
5. structural semantics
6. candidate specificity

Categories must map only to categories supported by the canonical detection model.

Do not create arbitrary category strings.

If multiple categories are plausible:

* use deterministic priority
* prefer the more specific validated category
* do not randomly select
* preserve provenance needed for later merging

## Acceptance

* Classification is deterministic.
* Ambiguous fixtures have documented priority behavior.
* Unsupported categories are rejected before normalization.
* Existing privacy category tests remain green.

---

# P02-08 — Confidence Scoring

## Objective

Make confidence meaningful, deterministic, and evidence-based.

## Requirements

Confidence must be derived from detection evidence.

Possible evidence:

* exact format match
* checksum validation
* positive context
* semantic DOM evidence
* negative context
* caption disqualification
* candidate ambiguity

Do not use arbitrary random or unstable confidence.

Confidence must remain within the canonical allowed range.

Confidence scoring must not bypass the Phase 00–01 normalization boundary.

## Acceptance

* Same input/evidence produces identical confidence.
* Strong validated/contextual detections score higher than weak matches.
* Negative context reduces confidence or disqualifies where appropriate.
* Boundary values are tested.
* Invalid confidence cannot reach the sanitizer.

---

# P02-09 — Structural DOM Detection Improvements

## Objective

Strengthen the existing DOM detector using semantic browser information.

## Requirements

Inspect the existing `detect-dom.ts` implementation first.

Improve it where evidence supports doing so.

Potential inputs:

* input type
* autocomplete
* name
* id
* aria-label
* placeholder
* label text
* nearby text
* contenteditable state
* semantic roles
* field metadata

Do not collect unnecessary page content.

Do not broaden DOM extraction merely to increase detection volume.

Preserve the existing FACE-specific behavior from Phase 00–01.

## Acceptance

* Sensitive form fields are detected reliably.
* Irrelevant fields remain undetected.
* Detection includes valid geometry when required.
* Missing backing-element behavior remains fail-closed.
* Existing DOM privacy tests remain green.

---

# P02-10 — Detection Provenance

## Objective

Make it possible to determine why a detection exists.

## Requirements

Preserve source provenance through the engine.

At minimum distinguish:

```text
dom
vision
ocr
```

For Phase 02, DOM/lexical evidence may have internal reason metadata if needed, but do not expand the canonical public `DetectionSource` enum.

Internal reason/provenance may include concepts such as:

* semantic field
* lexical pattern
* checksum
* contextual match
* combined evidence

Do not expose raw sensitive values in provenance.

## Acceptance

* Source remains valid under the canonical contract.
* Internal provenance is deterministic.
* Provenance contains no raw secret/PII value.
* Tests verify provenance survives detection merging where appropriate.

---

# P02-11 — Deterministic Deduplication

## Objective

Eliminate duplicate detections without losing stronger evidence.

## Requirements

Implement deterministic deduplication.

Duplicates may arise from:

* DOM + lexical detection
* multiple matching patterns
* overlapping semantic signals
* repeated extraction paths

Deduplication must consider appropriate combinations of:

* category
* normalized geometry
* candidate identity
* source/evidence
* overlap

Do not deduplicate solely by array position.

When duplicate evidence exists:

* retain the strongest valid evidence
* merge compatible provenance
* retain the highest justified confidence
* preserve deterministic ordering

Do not allow duplicate placeholders downstream.

## Acceptance

* Duplicate inputs collapse deterministically.
* Stronger evidence wins deterministically.
* Input ordering does not change the resulting logical detections.
* Existing placeholder determinism remains intact.

---

# P02-12 — Overlap and Detection Merge Policy

## Objective

Define deterministic behavior for partially overlapping detections.

## Requirements

Handle:

* exact duplicates
* contained boxes
* partial overlap
* adjacent but distinct findings
* same value with different geometry
* different values in overlapping geometry

Use a deterministic policy.

Do not merge distinct sensitive values merely because their boxes overlap.

Use IoU/containment or equivalent geometry logic where appropriate.

Reuse the existing `utils/coords.ts` behavior rather than creating a second coordinate utility.

## Acceptance

* Exact duplicates merge.
* Contained duplicate findings merge where appropriate.
* Distinct adjacent findings remain distinct.
* Overlapping distinct values are not incorrectly collapsed.
* Geometry behavior is covered by focused tests.

---

# P02-13 — Hard-Negative Test Corpus

## Objective

Build a meaningful deterministic test corpus for false-positive resistance.

## Requirements

Add fixtures representing realistic hard negatives.

Examples:

* order IDs
* invoice numbers
* product IDs
* tracking numbers
* timestamps
* dates without sensitive context
* prices
* phone-like random strings
* random 10/12/16 digit values
* hexadecimal identifiers
* UUIDs
* account-like but invalid values
* checksum-invalid values
* visually similar decoys

Include both:

```text
positive
negative
ambiguous
```

cases.

Do not use real people's sensitive information.

All fixtures must be synthetic.

## Acceptance

* Corpus is deterministic.
* Each category has positive and negative cases.
* Checksum failures are represented.
* Contextual false positives are represented.
* Tests fail meaningfully if validation or disqualification is disabled.

---

# P02-14 — Detection Quality Regression Tests

## Objective

Protect detection quality from future regressions.

## Requirements

Add focused tests covering:

* candidate extraction
* validators
* context
* caption disqualification
* classification
* confidence
* provenance
* deduplication
* overlap merging
* DOM detection

Where useful, add property-style/deterministic tests such as:

* same input → same output
* shuffled candidate order → same logical result
* invalid geometry → rejected
* invalid category → rejected
* invalid source → rejected
* invalid confidence → rejected

Do not weaken privacy validation to make tests pass.

## Acceptance

* Focused detection test suite passes.
* Existing Phase 00–01 privacy suite passes.
* Determinism tests pass.
* Hard-negative regression tests pass.

---

# P02-15 — Detection-to-Sanitizer Integration

## Objective

Prove that the enhanced detection engine integrates safely with the existing privacy boundary.

## Requirements

Test:

```text
detection engine
→ canonical Detection[]
→ normalizeDetection(s)
→ structural/visual sanitizer
→ outbound boundary
```

Verify that:

* valid detections survive normalization
* malformed detections are rejected
* extra properties are stripped
* unsupported categories are rejected
* unsupported sources are rejected
* invalid geometry is rejected
* invalid confidence is rejected

Detection improvements must never create an alternate path around normalization.

## Acceptance

* Integration tests pass.
* Privacy contract remains green.
* Fetch-spy/outbound tests remain green.
* No raw unsanitized detection reaches network code.

---

# P02-16 — Performance and Determinism Review

## Objective

Ensure the detection engine is appropriate for a browser hot path.

## Requirements

Inspect:

* repeated regex compilation
* unnecessary DOM traversal
* repeated text extraction
* expensive allocations
* duplicate candidate processing
* unnecessary serialization
* repeated checksum work

Optimize only where evidence supports it.

Do not prematurely optimize by weakening detection quality.

Avoid dependencies where native TypeScript/JavaScript is sufficient.

## Acceptance

* Detection remains deterministic.
* No unnecessary network/model dependency is introduced.
* No obvious O(N²) behavior is introduced for normal page sizes without justification.
* Focused tests remain green.

---

# P02-17 — Full Phase Verification

## Objective

Run the complete Phase 02 verification gate.

## Required checks

Run:

```text
npm run typecheck
npm run build
npm test
```

Run the relevant Python test suite that exists in the repository, including applicable:

```text
python ml/fusion/test_fuse.py
python ml/evaluation/test_evaluate.py
python ml/.../test_pii_classifier.py
```

Use the actual repository paths/scripts if they differ.

Also run all Phase 02-specific detection tests.

## Acceptance

Everything passes.

No test may be skipped merely because it is inconvenient.

If an existing test is obsolete because Phase 02 intentionally changes behavior, stop and report the conflict before changing the test.

---

# P02-18 — Final Scope and Privacy Audit

## Objective

Perform a final human-reviewable audit of Phase 02.

## Check

Review:

* `git status`
* complete Phase 02 diff
* changed files
* dependency changes
* privacy boundary
* detection contract
* source provenance
* logging
* error messages
* network paths
* duplicate logic
* accidental refactors
* unrelated changes
* reference-code license requirements

Confirm:

* no document pipeline was introduced
* no remote model was introduced
* no new network path was introduced
* no raw PII/secrets were added to logs/errors
* no sanitizer boundary was weakened
* no alternate Detection type was created
* no Phase 03+ work was implemented
* no user changes were discarded
* no commit was created

## Acceptance

A clean Phase 02 audit report exists.

---

# P02-19 — Phase Handoff

## Objective

Stop cleanly at the Phase 02 boundary.

## Requirements

Do not begin Phase 03.

Do not commit.

Do not push.

Do not create a PR.

Do not merge.

Produce a final report containing:

### Phase

```text
Phase 02 — Detection Engine
```

### Status

PASS / BLOCKED

### Completed

List each completed P02 task.

### Verification

List:

* typecheck
* build
* npm test
* Python tests
* Phase 02 detection tests

with results.

### Files changed

List all modified/created files.

### Privacy audit

State whether the sanitizer/outbound privacy boundary remains intact.

### Reference implementation

State which implementation patterns were adopted, without adding source-repository references to Privis code/docs unless legally required.

### Known limitations

List only genuine remaining limitations.

### Git

State:

* branch
* commit status
* push status
* PR status
* working-tree status

Then STOP.

---

# 7. Phase 02 Definition of Done

Phase 02 is complete only when all of the following are true:

* [ ] Candidate extraction is deterministic.
* [ ] Deterministic format validators exist for applicable sensitive categories.
* [ ] Checksum validation is used where applicable.
* [ ] Positive contextual evidence is supported.
* [ ] Negative contextual evidence is supported.
* [ ] Caption disqualification is implemented where applicable.
* [ ] Classification is deterministic.
* [ ] Confidence is deterministic and bounded.
* [ ] Detection provenance is preserved without raw PII.
* [ ] Duplicate detections merge deterministically.
* [ ] Overlapping detections follow a deterministic policy.
* [ ] Hard-negative synthetic fixtures exist.
* [ ] DOM detection is improved without weakening privacy.
* [ ] Canonical `Detection` remains authoritative.
* [ ] `DetectionSource` remains a closed set.
* [ ] All detections pass the existing normalization boundary.
* [ ] No unsanitized detection can reach network code.
* [ ] No new external network/model dependency was introduced.
* [ ] No document-processing functionality was introduced.
* [ ] No Phase 03+ functionality was implemented.
* [ ] Typecheck passes.
* [ ] Build passes.
* [ ] Full npm test suite passes.
* [ ] Relevant Python tests pass.
* [ ] Phase 02 detection tests pass.
* [ ] Final scope/privacy audit passes.
* [ ] No commit was created.
* [ ] No push/PR/merge was performed.
* [ ] Human approval is still required before commit.

---

# 8. Escalation Conditions

Stop and ask for human review if any task requires:

* changing the canonical `Detection` contract
* changing `DetectionSource`
* weakening normalization
* weakening sanitizer behavior
* bypassing redaction
* sending raw data externally
* introducing a new remote API
* changing OpenAI/Gemini privacy boundaries
* changing secret handling
* changing authority/agent execution behavior
* adding a large dependency
* copying code with unclear licensing
* modifying unrelated architecture
* changing Phase 03+ scope
* touching document-processing functionality
* discarding or rewriting existing Phase 00–01 work

Do not silently make these decisions.

---

# 9. Task Reporting

Normal successful task completion should be concise.

Preferred format:

```text
Done — P02-XX. Focused tests pass. Continuing.
```

Do not produce a large report after every task.

Detailed reporting is required only when:

* blocked
* escalated
* a privacy/security issue is discovered
* a task materially changes architecture
* Phase 02 is complete

---

# 10. Human Approval Gate

At the end of Phase 02:

**STOP.**

Do not commit.

Do not push.

Do not merge.

Do not create a PR.

Wait for explicit human approval.
