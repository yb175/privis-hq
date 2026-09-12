# PRIVIS — PHASE 10 TASKS

## Security & Threat Hardening

**Branch:** `round2/phase-10-security-hardening`

## Objective

Attack the completed Privis system from the perspective of a hostile webpage, malicious planner, compromised input, malformed model response, and hostile runtime state.

This phase is adversarial security hardening.

Do not add unrelated product functionality.

---

## Mandatory Rules

1. Read `GEMINI.md` and this complete task file first.
2. Preserve all Phase 00–09 work.
3. Do not reset, revert, clean, stash, discard, or overwrite existing work.
4. No commits.
5. No pushes.
6. No PRs.
7. No merges.
8. No tags/releases.
9. Never weaken a security assertion to obtain PASS.
10. Never delete a security test because it exposes a defect.
11. Document/PDF processing remains out of scope.
12. Mandatory reference components must use substantive reference logic where mapped.
13. Preserve legally required licenses/notices.
14. Stop and report incompatible reference/security architecture rather than silently substituting.

---

# Tasks

## P10-01 — Threat Model Inventory

Document the actual trust boundaries:

* webpage
* content script
* service worker
* offscreen runtime
* local models
* Vault
* sanitizer
* privacy gate
* remote planner
* executor

Identify attacker-controlled inputs at every boundary.

---

## P10-02 — Message Boundary Audit

Audit every extension message.

Verify:

* schema validation
* origin/source validation
* action validation
* malformed message handling
* unexpected fields
* replay behavior
* privilege escalation

---

## P10-03 — Prompt Injection Attacks

Create adversarial webpage content attempting to make the agent:

* reveal secrets
* ignore privacy rules
* transmit raw PII
* execute arbitrary actions
* navigate to malicious destinations
* alter planner behavior

Verify webpage content is treated as untrusted data.

---

## P10-04 — Malicious DOM Attacks

Test:

* fake labels
* misleading aria-labels
* hidden elements
* invisible inputs
* deceptive buttons
* duplicate targets
* hostile selectors
* injected form controls

Verify resolver and executor remain safe.

---

## P10-05 — Malicious Planner Output

Generate planner responses containing:

* unknown actions
* unknown fields
* malformed JSON
* arbitrary selectors
* JavaScript
* shell commands
* raw PII
* placeholder confusion
* label echoes
* smeared placeholders
* navigation abuse

All must fail closed.

---

## P10-06 — Navigation Security

Test malicious:

* URLs
* redirects
* javascript-like schemes
* data URLs
* cross-origin navigation
* unexpected navigation during task execution

Verify navigation remains within policy.

---

## P10-07 — Cross-Origin Security

Audit:

* content scripts
* planner endpoints
* extension pages
* host permissions
* iframe interactions
* cross-origin DOM access

Identify privilege expansion.

---

## P10-08 — Vault Attack Surface

Attempt:

* cross-origin reads
* unauthorized reads
* stale reads
* serialization
* exception leakage
* logging leakage
* placeholder-to-secret confusion
* lifecycle bypass

---

## P10-09 — Placeholder Security

Test:

* collisions
* ordering manipulation
* duplicate values
* category confusion
* session reuse
* stale tokens
* user-provided token spoofing

---

## P10-10 — Receipt Security

Test:

* modified pixels
* modified manifests
* modified hashes
* stale receipts
* replayed receipts
* missing receipts
* malformed receipts
* mismatched session data

All must fail closed.

---

## P10-11 — Network Boundary Fuzzing

Enumerate every production network path.

Attempt to pass:

* raw DOM
* raw OCR
* raw screenshot
* raw face pixels
* Vault secrets
* unredacted goal text

Verify every route rejects unsanitized data.

---

## P10-12 — Model Output Fuzzing

Fuzz local/remote model output with:

* malformed structures
* huge values
* unexpected Unicode
* recursive objects
* invalid actions
* prompt-injection payloads
* unexpected selectors

Verify bounded and safe handling.

---

## P10-13 — Permission Audit

Inspect manifest permissions and host permissions.

Remove only genuinely unnecessary permissions.

Do not break required architecture.

---

## P10-14 — Dependency/Supply-Chain Audit

Inspect:

* dependencies
* versions
* model assets
* hashes
* build scripts
* generated assets
* remote downloads

Verify no unexpected runtime dependency or unpinned model path exists.

---

## P10-15 — Secret Exposure Audit

Search source and build artifacts for:

* API keys
* tokens
* passwords
* test secrets
* credentials
* raw PII

Do not include discovered secrets in the report.

---

## P10-16 — Error/Logging Security

Inspect all:

* console logging
* thrown errors
* serialized errors
* telemetry
* network errors
* planner errors

Ensure sensitive values do not appear.

---

## P10-17 — Fuzz and Adversarial Regression Corpus

Create focused regression cases for every confirmed vulnerability.

Do not create enormous meaningless test suites.

Tests must prove the security mechanism.

---

## P10-18 — Fix Confirmed Vulnerabilities

Fix P0/P1/P2 security issues and release-blocking P3 issues.

Do not fix by weakening controls.

---

## P10-19 — Full Security Regression

Run all existing security/privacy tests plus new adversarial tests.

---

## P10-20 — Full Project Regression

Run:

```text
npm run typecheck
npm run build
npm test
python ml/evaluation/test_evaluate.py
python ml/fusion/test_fuse.py
```

plus relevant Chrome/E2E/security commands.

---

## P10-21 — Reference Provenance Audit

Verify substantive reuse of mandatory reference security components.

---

## P10-22 — Scope Audit

Confirm only security/threat-hardening work was introduced.

---

## P10-23 — Final Security Classification

Classify:

* P0
* P1
* P2
* P3
* P4
* P5

State whether any release blocker remains.

---

## P10-24 — Phase Handoff

Report:

* task-by-task status
* vulnerabilities discovered
* vulnerabilities fixed
* exact files changed
* security tests
* regression results
* remaining risks
* provenance
* final verdict

STOP.

No commit/push/merge/tag/release.
