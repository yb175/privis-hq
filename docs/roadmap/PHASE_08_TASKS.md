# PRIVIS — PHASE 08 TASKS

## Production Hardening, UX, Packaging, and Release Readiness

**Branch:** `round2/phase-08-production-release`

**Status:** PLANNED

---

# Objective

Prepare Privis for production/SIH demonstration quality.

This phase focuses on:

* reliability
* security hardening
* UX
* configuration
* packaging
* observability
* recovery
* documentation
* release verification

No major new architectural subsystem should be introduced.

---

# Mandatory reference reuse

Port/adapt relevant approved reference implementations where they materially improve Privis:

* panel/docking UX
* confirmation UX concepts
* marks/set-of-mark rendering
* typed message envelopes
* error/recovery handling
* release/model integrity checks
* relevant browser E2E infrastructure

Actual code must be ported where technically compatible.

---

# Tasks

### P08-01 — Production Architecture Audit

Audit all previous phases.

### P08-02 — Configuration Audit

Remove:

* insecure defaults
* development-only flags
* debug leakage
* accidental test configuration

### P08-03 — Permissions Audit

Minimize extension permissions.

### P08-04 — Manifest Audit

Verify:

* MV3 correctness
* content scripts
* worker
* permissions
* CSP
* host permissions

### P08-05 — Secret/Provider Configuration

Ensure credentials never enter:

* repository
* bundle
* logs
* client-visible configuration

### P08-06 — Model Packaging

Verify:

* model presence
* hashes
* versions
* expected runtime

### P08-07 — Error UX

Create useful user-facing failures without exposing sensitive data.

### P08-08 — Privacy UX

Clearly communicate:

* what is being sanitized
* when remote planning is used
* what information leaves the browser

Do not expose raw sensitive values.

### P08-09 — Confirmation UX

Integrate confirmation for risky/high-impact actions where appropriate.

### P08-10 — Visual Redaction Marks

Port/adapt reference set-of-mark behavior where useful.

### P08-11 — Typed Message Boundaries

Audit extension ↔ worker ↔ offscreen ↔ server messages.

Adopt stronger typed envelopes where beneficial.

### P08-12 — Recovery

Test:

* worker restart
* offscreen restart
* network failure
* model failure
* page navigation
* browser restart

### P08-13 — Long-Running Stability

Test repeated tasks and sessions.

### P08-14 — Memory Leak Audit

Inspect:

* screenshots
* OCR caches
* models
* vault entries
* DOM references
* timers/listeners

### P08-15 — Security Fuzzing

Fuzz:

* detections
* coordinates
* planner output
* messages
* goals
* action parameters

### P08-16 — Permission/Network Audit

Verify every outbound endpoint and permission is justified.

### P08-17 — Full E2E

Run realistic browser scenarios.

### P08-18 — Evaluation Gate

Run Phase 07 evaluation.

No release if critical metrics regress.

### P08-19 — Build Reproducibility

Verify clean reproducible builds.

### P08-20 — Release Packaging

Create release-ready extension artifact.

Do not publish automatically.

### P08-21 — Documentation

Update:

* architecture
* setup
* security
* privacy
* deployment
* troubleshooting

### P08-22 — Final Security Audit

Full attack-surface review.

### P08-23 — Final Privacy Audit

Prove:

* no raw sensitive outbound data
* no raw pixels outbound
* no planner bypass
* no executor bypass
* no logging leakage

### P08-24 — Reference Provenance Audit

Final audit of all reference-derived code.

### P08-25 — SIH Demo Readiness

Prepare deterministic demo scenarios.

### P08-26 — Final Regression

All tests green.

### P08-27 — Release Readiness Report

Produce:

* architecture status
* test status
* evaluation metrics
* security findings
* privacy findings
* performance
* known limitations
* release blockers

### P08-28 — Human Release Gate

STOP.

Do not:

* commit
* push
* tag
* publish
* release

until explicitly approved by the user.

---

# Completion

Phase 08 is complete when Privis passes the full regression/evaluation/security gates and has a release-ready artifact, but NOTHING is published without explicit human approval.
