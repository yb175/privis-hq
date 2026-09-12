# PRIVIS — PHASE 12 TASKS

## Privacy UX & Transparency

**Branch:** `round2/phase-12-privacy-ux`

## Objective

Make Privis understandable and controllable for real users without exposing the sensitive information that Privis exists to protect.

The user should be able to understand:

* what Privis detected
* what stays local
* what may be sent remotely
* what was redacted
* what the agent is doing
* when confirmation is required
* how to stop/reset/forget a session

---

## Mandatory Rules

1. Read `GEMINI.md` and this entire task file first.
2. Preserve Phases 00–11.
3. No reset/revert/clean/stash/discard.
4. No commits/pushes/PRs/merges/tags/releases.
5. Never display raw secrets or unnecessary raw PII in UX.
6. Never weaken privacy gates for transparency.
7. No document/PDF functionality.
8. Reuse mapped reference UX components where applicable.
9. Preserve legal notices.

---

# Tasks

## P12-01 — Privacy UX Inventory

Inspect:

* panel
* popup
* HUD
* redaction marks
* confirmations
* errors
* status indicators
* session controls

---

## P12-02 — Privacy State Model

Define the user-visible states corresponding to:

* local processing
* detection
* sanitization
* remote planning
* execution
* completion
* failure
* cancellation

Do not expose raw sensitive content.

---

## P12-03 — Local vs Remote Transparency

Clearly indicate whether a task is:

* fully local
* using a local model
* using a remote planner

Remote state must never imply that raw PII is transmitted.

---

## P12-04 — Detection Transparency

Show useful detection information without displaying raw values unnecessarily.

Examples:

* category
* count
* source
* redaction state

---

## P12-05 — Redaction Visualization

Integrate existing visual marks/set-of-mark concepts.

Show users what was protected without exposing the protected content.

---

## P12-06 — Placeholder Visualization

Present placeholders in a user-understandable way while keeping actual secrets hidden.

---

## P12-07 — Vault Status UX

Provide safe indication of:

* protected secrets
* active session
* expiration
* deletion

Never expose secret values.

---

## P12-08 — Remote Planner Consent

If remote processing is configured, provide clear user-facing consent/status behavior consistent with the privacy architecture.

Do not create a path that bypasses existing policy gates.

---

## P12-09 — Sensitive Action Confirmation

Require appropriate confirmation before sensitive local actions where the existing architecture requires it.

---

## P12-10 — Permission Explanation

Explain browser permissions clearly and accurately.

Do not request permissions solely to simplify UX.

---

## P12-11 — Network Transparency

Show meaningful remote activity status without exposing:

* URLs unnecessarily
* sensitive payloads
* API keys
* raw user data

---

## P12-12 — Privacy Failure UX

Create safe user-facing messages for:

* detection failure
* sanitization failure
* receipt failure
* planner failure
* Vault failure
* model failure

Messages must not contain secrets.

---

## P12-13 — Agent Failure UX

Explain:

* what failed
* whether the action occurred
* whether retry is safe
* whether user intervention is required

---

## P12-14 — Recovery UX

Provide safe controls for:

* retry
* cancel
* reset
* continue where safe

Do not retry actions that may have already executed unless the architecture proves it safe.

---

## P12-15 — User Cancellation

Verify cancellation stops:

* planner work where possible
* execution
* observers
* retries
* sensitive state

---

## P12-16 — Session Reset / Forget

Provide safe session cleanup.

Verify Vault and placeholders are cleaned according to policy.

---

## P12-17 — Accessibility

Test:

* keyboard navigation
* focus
* labels
* screen readers where available
* contrast
* error announcement

Accessibility changes must not reveal sensitive content.

---

## P12-18 — UX Security Audit

Test UI against:

* DOM injection
* malicious text
* planner-controlled strings
* raw PII rendering
* unsafe HTML

Use safe text rendering.

---

## P12-19 — UX Regression

Add focused tests for privacy states and sensitive-data handling.

---

## P12-20 — Chrome UX Validation

Run the privacy UX in actual Chrome where available.

Verify visual states and controls.

---

## P12-21 — Full Regression

Run:

```text
npm run typecheck
npm run build
npm test
python ml/evaluation/test_evaluate.py
python ml/fusion/test_fuse.py
```

plus relevant Chrome/E2E tests.

---

## P12-22 — Privacy Audit

Verify the UX layer itself cannot become a privacy leak.

---

## P12-23 — Reference Provenance Audit

Verify mapped reference UX components were substantively reused where applicable.

---

## P12-24 — Scope Audit

No unrelated features or document processing.

---

## P12-25 — Phase Handoff

Report:

* UX changes
* exact files
* privacy impact
* security findings
* accessibility findings
* Chrome validation
* tests
* provenance
* unresolved issues
* final verdict

STOP with no commit/push/release.
