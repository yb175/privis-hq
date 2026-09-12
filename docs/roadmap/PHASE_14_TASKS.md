# PRIVIS — PHASE 13 TASKS

## Advanced Agent Capabilities

**Branch:** `round2/phase-13-advanced-agent`

## Objective

Extend Privis from reliable single/multi-step browser automation toward more capable task execution while preserving every privacy, validation, and execution boundary established in Phases 00–12.

This is the first major post-hardening capability phase.

---

## Mandatory Rules

1. Read `GEMINI.md` and this entire task file.
2. Preserve all previous phases.
3. No reset/revert/clean/stash/discard.
4. No commits/pushes/PRs/merges/tags/releases.
5. Planner output never directly executes.
6. Never bypass detection, sanitization, Vault, receipt, plan verification, or safe execution.
7. No document/PDF processing.
8. Reuse mapped reference implementations where applicable.
9. Do not independently recreate mandatory reference algorithms.
10. Stop on incompatible architecture rather than silently substituting.
11. Preserve licenses/notices.

---

# Tasks

## P13-01 — Advanced Agent Inventory

Inspect existing capabilities and identify concrete limitations.

Do not implement speculative features.

---

## P13-02 — Multi-Step Intent Representation

Extend deterministic task representation where required for legitimate multi-step browser workflows.

Preserve deterministic behavior for simple tasks.

---

## P13-03 — Task Decomposition

Improve decomposition of complex tasks into verified substeps.

Every substep must remain policy-bound.

---

## P13-04 — Planner Context Optimization

Improve sanitized context selection for complex tasks.

Never send raw PII or raw pixels merely to improve planner quality.

---

## P13-05 — Multi-Action Plan Verification

Extend plan verification to safely validate sequences of actions.

Validate:

* action type
* target
* arguments
* dependencies
* sensitive operations
* navigation

---

## P13-06 — Conditional Plans

Support safe conditional execution where justified.

Conditions must be based on approved/sanitized state.

---

## P13-07 — State-Aware Execution

Track verified browser state between actions.

Do not trust stale assumptions.

---

## P13-08 — Backtracking

Implement safe backtracking when a verified task step fails.

Do not repeat irreversible/sensitive actions without explicit safety proof.

---

## P13-09 — Recovery Planning

Improve recovery from:

* missing targets
* changed DOM
* navigation
* failed actions
* planner failures
* dynamic state changes

---

## P13-10 — Dynamic Target Chains

Support multi-step target resolution while preserving:

* interactivity
* occlusion
* re-resolution
* action verification

---

## P13-11 — Cross-Page State

Support only the minimum sanitized state required across navigation.

Never persist raw secrets unnecessarily.

---

## P13-12 — Authentication Boundaries

Handle authentication-sensitive states safely.

Secrets remain local and Vault-controlled.

Never transmit credentials to the planner.

---

## P13-13 — Sensitive Action Confirmation

Ensure advanced plans cannot silently execute sensitive operations requiring confirmation.

---

## P13-14 — Completion Criteria Expansion

Support richer completion verification.

Prefer deterministic browser state over model-generated claims.

---

## P13-15 — Agent Failure Taxonomy

Expand failure classification where required.

Every new failure mode must have deterministic handling.

---

## P13-16 — Adversarial Planner Testing

Test:

* malicious plans
* partial plans
* contradictory plans
* hallucinated targets
* raw PII
* unsafe navigation
* repeated actions
* impossible conditions

---

## P13-17 — Multi-Step Browser E2E

Test realistic complex workflows in Chrome where available.

---

## P13-18 — Privacy Regression

Verify advanced capabilities preserve:

```text
Detection
→ Sanitization
→ Privacy Gate
→ Receipt
→ Plan Validation
→ Security Verification
→ Safe Execution
```

---

## P13-19 — Performance Regression

Measure the impact of advanced planning/execution.

No unbounded loops or retries.

---

## P13-20 — Security Audit

Audit new capabilities for:

* privilege escalation
* prompt injection
* action injection
* navigation abuse
* stale state
* sensitive-action bypass

---

## P13-21 — Full Regression

Run:

```text
npm run typecheck
npm run build
npm test
python ml/evaluation/test_evaluate.py
python ml/fusion/test_fuse.py
```

plus relevant Chrome/E2E/evaluation tests.

---

## P13-22 — Reference Provenance Audit

Verify substantive reference reuse for mapped advanced-agent components.

---

## P13-23 — Scope Audit

Reject:

* unrelated features
* document processing
* privacy weakening
* unnecessary dependency growth
* duplicate agent architecture

---

## P13-24 — Phase Handoff

Report:

* capabilities added
* exact files
* tests
* E2E results
* security/privacy findings
* performance
* provenance
* unresolved issues
* final verdict

STOP without commit/push/release.
