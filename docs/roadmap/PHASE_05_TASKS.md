# PRIVIS — PHASE 05 TASKS

## Privacy Vault, Secret Lifecycle, and Zero-Leak Data Handling

**Branch:** `round2/phase-05-privacy-vault`

**Status:** PLANNED

**Primary implementation:** Antigravity / Gemini
**Architecture/security review:** GLM
**Human approval:** commits/pushes/PRs/merges

---

## Objective

Build a hardened local secret-management layer around the privacy pipeline.

The system must ensure that sensitive values:

* are represented by placeholders wherever possible
* remain local
* are never unnecessarily exposed to planners
* are not written to logs
* have controlled lifecycle
* cannot accidentally cross the outbound boundary

---

## Mandatory reference reuse

Port/adapt the actual implementations from:

* `extension/src/worker/vault.ts`
* `extension/src/shared/placeholders.ts`
* `extension/src/offscreen/allocator.ts`
* `extension/src/worker/router.ts` goal-tokenisation logic
* relevant reference secret/provenance tests

Do not independently recreate equivalent implementations when compatible.

---

## Tasks

### P05-01 — Vault Inventory

Audit existing secret/placeholder handling.

### P05-02 — Port Secret Vault

Port/adapt the reference vault implementation.

Requirements:

* local only
* opaque keys
* controlled lookup
* no raw-value logging
* lifecycle management

### P05-03 — Port Placeholder Allocator

Port/adapt placeholder allocation.

Requirements:

* deterministic session numbering
* category-aware allocation
* stable mapping
* collision resistance
* no FACE-as-text allocation

### P05-04 — Provenance Tracking

Track whether a value originated from:

* DOM
* OCR
* vision
* user input
* derived state

Do not expose raw provenance values unnecessarily.

### P05-05 — Secret Lifecycle

Implement:

* creation
* lookup
* use
* expiration
* cleanup
* session termination

### P05-06 — Goal Tokenisation

Port/adapt privacy-safe goal tokenisation.

Sensitive values must not appear unnecessarily in:

* planner prompts
* errors
* logs
* telemetry
* outbound payloads

### P05-07 — Placeholder Stability

Ensure identical values receive deterministic placeholders within the intended session lifecycle.

### P05-08 — Secret Residue Prevention

Search for raw secret leakage through:

* logs
* exceptions
* debug output
* serialized objects
* planner requests
* browser messages

### P05-09 — Vault Boundary

Make vault access explicit and auditable.

No arbitrary module should directly manipulate raw secret maps.

### P05-10 — Adversarial Vault Tests

Test:

* wrong key
* missing key
* expired key
* duplicate value
* category collision
* stale session
* serialization attempt
* logging attempt

### P05-11 — Memory Lifecycle Review

Ensure raw sensitive data is retained only as long as necessary.

### P05-12 — Full Privacy Regression

Run all prior privacy tests.

### P05-13 — Reference Provenance Audit

Document every port/adaptation.

### P05-14 — Security Audit

Verify zero raw-secret bypass.

### P05-15 — Phase Handoff

No commit/push/PR/merge.

---

## Completion

Phase 05 passes only when:

* vault is implemented
* reference implementation is actually ported
* placeholder allocation is integrated
* goal tokenisation is enforced
* lifecycle cleanup works
* adversarial tests pass
* previous phases remain green
* no secret reaches unauthorized boundaries
