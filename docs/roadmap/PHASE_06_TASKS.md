# PRIVIS — PHASE 06 TASKS

## Advanced Browser Interaction, Dynamic Pages, and Reliable Execution

**Branch:** `round2/phase-06-browser-interaction`

**Status:** PLANNED

---

## Objective

Make Privis reliable on real-world dynamic websites.

Focus on:

* element discovery
* dynamic DOM
* scrolling
* visibility
* occlusion
* forms
* dropdowns
* buttons
* navigation
* mutation handling
* stale targets
* action verification

---

## Mandatory reference reuse

Port/adapt actual implementations from:

* `extension/src/content/interactivity.ts`
* `extension/src/content/occlusion.ts`
* `extension/src/content/settle-watch.ts`
* `extension/src/content/format.ts`
* relevant executor/action implementations
* relevant reference browser tests

---

## Tasks

### P06-01 — Browser Interaction Inventory

Audit existing Privis interaction stack.

### P06-02 — Port Interactivity

Port/adapt:

* enabled state
* visibility
* semantic interactability
* disabled controls
* editable controls

### P06-03 — Port Occlusion

Port/adapt:

* hit testing
* overlays
* fixed elements
* obstructed controls
* viewport visibility

### P06-04 — Dynamic DOM Tracking

Handle:

* SPA navigation
* DOM replacement
* lazy loading
* mutation
* stale references

### P06-05 — Scrolling

Implement safe:

* target scrolling
* incremental scrolling
* viewport verification
* post-scroll re-resolution

### P06-06 — Form Interaction

Support robust:

* text
* password
* select
* checkbox
* radio
* textarea
* contenteditable

### P06-07 — Deterministic Formatting

Port/adapt reference formatting.

### P06-08 — Navigation

Handle:

* navigation
* redirects
* URL changes
* page replacement
* timeout

### P06-09 — Target Re-resolution

Never execute against stale element references.

### P06-10 — Action Verification

Every important action must have a postcondition.

### P06-11 — Dynamic Settle

Port/adapt settle-watch behavior.

### P06-12 — Error Recovery

Handle:

* stale element
* detached node
* blocked target
* navigation race
* DOM mutation

### P06-13 — Browser Adversarial Tests

Test dynamic and hostile pages.

### P06-14 — End-to-End Tests

Cover complete goal → execution flows.

### P06-15 — Performance

Measure action and DOM-discovery latency.

### P06-16 — Security Audit

Ensure dynamic-page behavior cannot bypass privacy gates.

### P06-17 — Reference Provenance Audit

Document actual ports/adaptations.

### P06-18 — Full Regression

All phases green.

### P06-19 — Phase Handoff

No commit/push/PR/merge.

---

## Completion

Reliable interaction must work on dynamic pages without bypassing privacy or plan verification.
