# PRIVIS — PHASE 04 TASKS

## Agent Intelligence, Planning, Execution, Verification, and Tiered Automation

**Branch:** `round2/phase-04-agent-execution`

**Status:** PLANNED

**Primary implementation:** Antigravity / Gemini
**Architecture + security review:** GLM
**Human approval:** Required for commits/pushes/PRs/merges

---

# 1. OBJECTIVE

Phase 04 turns the completed Privis privacy/detection pipeline into a robust browser automation agent.

The phase integrates:

* deterministic intent handling
* task classification
* element resolution
* tiered execution
* local model execution where required
* remote planning where required
* structured plan validation
* plan security verification
* safe browser execution
* settle/wait behavior
* post-action verification
* deterministic completion
* failure taxonomy
* timeout budgets
* transport security
* privacy-preserving goal handling

The objective is:

```text
user goal
   ↓
goal sanitization
   ↓
intent classification
   ↓
deterministic resolution where possible
   ↓
tier selection
   ↓
planner
   ↓
validated plan
   ↓
security verification
   ↓
browser execution
   ↓
settle
   ↓
re-read / verify
   ↓
completion
```

---

# 2. MANDATORY APPROVED-REFERENCE REUSE

The following approved reference implementations MUST be ported/adapted rather than independently recreated when technically compatible.

## Mandatory components

| Reference component                      | Required Privis integration                        |
| ---------------------------------------- | -------------------------------------------------- |
| `extension/src/worker/intent.ts`         | Deterministic intent grammar/classification        |
| `extension/src/worker/resolve.ts`        | Deterministic element/task resolution              |
| `extension/src/worker/local.ts`          | Local model execution/failure taxonomy             |
| `extension/src/worker/verify-plan.ts`    | Plan validation and semantic security checks       |
| `extension/src/worker/complete.ts`       | Post-action re-read/completion verification        |
| `extension/src/content/format.ts`        | Deterministic browser-field formatting             |
| `extension/src/content/settle-watch.ts`  | Page settle/change detection                       |
| `extension/src/content/occlusion.ts`     | Visibility/occlusion handling                      |
| `extension/src/content/interactivity.ts` | Interactive element validation                     |
| `extension/src/worker/transport.ts`      | Request validation, timeout, retry discipline      |
| `extension/src/worker/receipt.ts`        | Independent receipt verification                   |
| `extension/src/worker/router.ts`         | Goal tokenisation/privacy-preserving routing logic |

Port the actual substantive implementation.

Do not replace it with a newly written equivalent merely because Privis can implement the same behavior another way.

If technically incompatible, stop and document the incompatibility before substituting.

---

# 3. SCOPE

## In scope

* user goal processing
* intent classification
* deterministic task routing
* element resolution
* agent planning
* local model tier
* remote planner integration
* structured plan validation
* plan security verification
* browser action execution
* settle/watch
* post-action verification
* completion detection
* timeout/failure handling
* privacy-safe goal handling
* request/receipt verification

## Out of scope

* document processing
* PDF processing
* document OCR
* new vision models
* replacing Phase 03 vision/OCR
* unrelated UI redesign
* new external providers without approval
* Phase 05+ functionality

---

# 4. ARCHITECTURAL PRINCIPLE

Privis must prefer the cheapest deterministic mechanism capable of completing a task.

Required conceptual tiering:

```text
Tier 0
Deterministic grammar / resolver
        ↓
Tier 1
Local model
        ↓
Tier 2
Remote planner
```

Do not invoke an LLM when deterministic logic can safely resolve the task.

Do not send sensitive user information to a remote planner.

---

# 5. TASKS

## P04-01 — Agent Architecture Inventory

Audit current Privis:

* router
* runGoal
* runStep
* executor
* action model
* remote planner
* local model capability
* completion handling
* settle handling
* transport

Map each against the mandatory reference components.

---

## P04-02 — Port Deterministic Intent Grammar

Port/adapt the reference intent grammar.

Implement deterministic recognition for tasks such as:

* click
* type
* select
* navigate
* submit
* find
* reveal
* inspect

Avoid LLM use for deterministic tasks.

---

## P04-03 — Port Deterministic Resolver

Port/adapt the reference resolver.

It must:

* resolve candidate elements
* use semantic labels
* use accessible names
* use deterministic matching
* reject ambiguous matches
* respect visibility/interactivity
* avoid guessing sensitive values

---

## P04-04 — Tier Selection

Implement deterministic tier selection.

Requirements:

* Tier 0 whenever possible
* Tier 1 when local reasoning is required
* Tier 2 only when necessary
* explicit failure reason when escalating
* no unnecessary remote calls

---

## P04-05 — Local Model Integration

Port/adapt local model execution and failure taxonomy.

Requirements:

* local-only data
* bounded timeout
* predictable failure states
* no silent escalation
* no raw sensitive data leakage

---

## P04-06 — Goal Privacy

Integrate reference goal-tokenisation behavior.

Sensitive values must not be exposed unnecessarily to planners.

Use existing placeholder infrastructure.

Ensure goal residue cannot leak through:

* logs
* errors
* planner prompts
* network requests
* telemetry

---

## P04-07 — Remote Planner Integration

Integrate the existing Privis remote planner architecture.

Preserve provider abstraction.

Remote planner receives only the minimum sanitized information required for planning.

Never transmit raw screenshots or raw sensitive values.

---

## P04-08 — Structured Plan Schema

Define/enforce the canonical action-plan schema.

Validate:

* action type
* target
* parameters
* ordering
* required fields
* allowed values
* malformed actions
* unknown actions

Reject malformed plans.

---

## P04-09 — Port Plan Verification

Port/adapt reference `verify-plan` security logic.

Detect:

* label echo
* leaked sensitive values
* shredded/smeared values
* invalid targets
* unsafe actions
* unexpected fields
* planner hallucinations

Plan verification must happen before execution.

---

## P04-10 — Safe Action Execution

Integrate validated plans with the existing executor.

Require:

```text
plan
→ schema validation
→ security verification
→ target resolution
→ action execution
```

No planner output may directly execute.

---

## P04-11 — Interactivity and Occlusion

Port/adapt reference interactivity and occlusion checks.

Before acting:

* element must exist
* element must be actionable
* element must be sufficiently visible
* element must not be blocked
* target must correspond to the intended action

---

## P04-12 — Settle Watch

Port/adapt settle behavior.

After actions that may mutate the page:

* observe relevant changes
* wait for stabilization
* enforce timeout
* avoid infinite waits
* continue only when the page is sufficiently settled

---

## P04-13 — Completion Verification

Port/adapt reference completion logic.

After value-bearing actions:

* re-read the element
* verify expected state
* use closed-vocabulary verdicts
* detect stale/failed actions
* do not assume success merely because an event fired

---

## P04-14 — Deterministic Field Formatting

Port/adapt deterministic formatting behavior.

Ensure values are inserted according to field semantics.

Do not allow model-generated formatting to alter sensitive values unexpectedly.

---

## P04-15 — Retry and Failure Taxonomy

Implement bounded failure classes.

Examples:

```text
TARGET_NOT_FOUND
TARGET_AMBIGUOUS
TARGET_BLOCKED
ACTION_REJECTED
PAGE_NOT_SETTLED
VERIFICATION_FAILED
PLANNER_INVALID
PLANNER_TIMEOUT
LOCAL_MODEL_FAILURE
REMOTE_MODEL_FAILURE
PRIVACY_GATE_FAILURE
```

Retries must be bounded and classified.

Never retry blindly.

---

## P04-16 — Timeout Budget

Implement an overall action/planning timeout budget.

The system must prevent:

* infinite planning
* infinite retries
* infinite settle waits
* hanging model requests

Reuse the reference timeout discipline where compatible.

---

## P04-17 — Receipt and Transport Verification

Port/adapt the reference receipt/transport security architecture.

Verify sanitized payload integrity before outbound transmission.

Request bodies must be schema validated.

Sensitive raw values must never bypass the privacy boundary.

---

## P04-18 — Agent Privacy Boundary Tests

Add adversarial tests proving:

1. raw sensitive values do not reach remote planner
2. raw screenshot data does not reach planner
3. invalid plans never execute
4. malformed actions never execute
5. planner output is independently verified
6. goal tokenisation works
7. logs contain no raw sensitive values
8. failed privacy gates stop execution
9. retries cannot bypass security checks

---

## P04-19 — Tiering Regression Tests

Test representative tasks across:

* Tier 0
* Tier 1
* Tier 2

Verify deterministic tasks do not unnecessarily invoke higher tiers.

Test escalation on genuine ambiguity.

---

## P04-20 — End-to-End Agent Tests

Build deterministic browser tests covering:

```text
goal
→ route
→ resolve
→ plan
→ verify
→ execute
→ settle
→ re-read
→ complete
```

Include:

* successful form interaction
* ambiguous target
* blocked target
* dynamic page
* stale target
* failed planner
* failed completion
* privacy failure

---

## P04-21 — Performance Review

Measure:

* deterministic routing latency
* local model latency
* remote planning latency
* action latency
* settle latency
* completion verification latency
* retry frequency

Optimize only after correctness is established.

---

## P04-22 — Full Regression Verification

Run:

```text
npm run typecheck
npm run build
npm test
npm run test:privacy
npm run test:privacy-contract
npm run test:gate
```

Run relevant Python tests.

Verify Phase 00–03 tests remain green.

---

## P04-23 — Reference-Reuse Provenance Audit

Produce:

| Reference component | Privis destination | Ported/adapted | Adaptations | Tests |
| ------------------- | ------------------ | -------------- | ----------- | ----- |

Every mandatory component must have an explicit result.

“Implemented equivalent behavior” does not count as a successful port where the reference was compatible.

---

## P04-24 — Security Audit

Verify:

* planner cannot bypass privacy
* executor cannot execute unverified plans
* sensitive values do not enter remote planning unnecessarily
* no raw pixels leave the privacy boundary
* receipt verification remains independent
* retries cannot bypass gates
* malformed planner output fails closed
* target ambiguity fails closed
* logs remain sanitized

---

## P04-25 — Scope Audit

Confirm no:

* document processing
* PDF pipeline
* unrelated UI system
* new uncontrolled external provider
* Phase 05+ functionality
* privacy weakening

---

## P04-26 — Phase Handoff

Final report:

1. P04-01 → P04-26 status
2. files added
3. files modified
4. files deleted
5. mandatory reference components ported
6. adaptations
7. tiering behavior
8. tests
9. security findings
10. performance findings
11. unresolved issues
12. GLM review recommendations

Do not commit.

Do not push.

Stop after handoff.

---

# 6. GIT RULES

Mandatory branch:

`round2/phase-04-agent-execution`

Never:

* commit
* push
* create PR
* merge
* reset
* revert
* clean
* stash
* discard

Preserve all previous phase work.

---

# 7. COMPLETION CRITERIA

Phase 04 is complete only when:

* P04-01 through P04-26 pass.
* Mandatory reference implementations are actually ported/adapted.
* Deterministic tiering works.
* Plans are schema validated.
* Plans are security verified before execution.
* Browser actions are independently validated.
* Settle and completion verification work.
* Goal privacy is preserved.
* Receipt/transport verification works.
* Failure/retry handling is bounded.
* Full regression suite passes.
* No raw sensitive information bypasses the privacy boundary.
* No document processing is introduced.
* No commits/pushes/PRs/merges occur.
