# PRIVIS Round 2 — Architecture

Repository layout after the Phase 00 restructure. The six architecture boxes
and their order are locked (CONTRACT.md):

Capture Layer → Local Privacy Vision Engine → Sanitizer → Policy Gate →
Remote Agent → Local Executor

## Layout

```
manifest.json               MV3 manifest (service worker + 1 content script)
background/                 service worker: wires UI/toolbar to the loop
content/                    capture-content.ts — Capture Layer in the page
orchestrator/               the session loop (box sequencing, no box logic)
  runStep.ts                  step sequencing: capture → engine → sanitizer
                              → gate → remote → executor (fail-closed order)
  capture.ts                  capture primitive + DOM detection invocation
  hud.ts                      live step feed for the popup HUD
  outbound.ts                 outbound package construction + audit logging
  runGoal.ts                  goal entry (toolbar/chat)
  session.ts                  on-device session state, human-approval flow
  transparency-log.ts         CBA-11 audit store (digest-pinned)
privacy/
  engine/                    Local Privacy Vision Engine (ML-owned)
    detect-dom.ts              DOM-rule detection (source of truth for TS
                              detection patterns)
    detect-lexical.ts          SIH26171 L1 port: checksum-validated lexical
                              scan (PAN/Aadhaar/CARD/IFSC/GSTIN/UPI/...);
                              consumed by detect-dom.ts
    validators.ts              SIH26171 validators port: per-class checksums
                              (Verhoeff, Luhn, mod-36 GSTIN) — the only thing
                              that mints the identifier categories
    normalize.ts               canonical finding contract (Phase 01): stable
                              PrivacyError codes, closed category/source sets,
                              assertValidBBox, normalizeDetection(s) — the
                              validation layer every finding crosses
    fuse.ts                    DOM+vision fusion (parity with ml/fusion)
    vision/                    YuNet face path (ORT Web, offscreen host)
  sanitizer/                 Sanitizer
    structural-redact.ts       placeholders + local value map (detection moved
                              OUT in Phase 00; Phase 01: normalize-on-entry,
                              fail-closed stale finding rejection,
                              resetPlaceholderTokens session scoping)
    placeholders.ts            SIH26171 placeholder allocator port (session-
                              scoped, NO_VALUE for PASSWORD)
    redaction-gate.ts          Phase 01: the one-way encoding gate (seal →
                              encode); the ONLY path from raw screenshot
                              bytes to sanitized PNG + receipt
    vault.ts                   SIH26171 secret vault port (origin+class keyed;
                              executor wiring deferred)
    visual-redact.ts           canvas pixel redaction (blur/black/mask;
                              Phase 01: malformed bbox throws, no silent skip)
  policy-gate/               Policy Gate (block / human_approval / allow)
remote-agent/               Remote Agent (operator server + clients)
  assert.ts                  outbound boundary leaf (assertSanitizedPackage);
                              router re-exports, provider clients enforce
  router.ts                   routes sanitized requests to chatgpt/gemini
  packager.ts, guard.ts       prompt compilation + placeholder allowlist
  client-server.ts            the ONLY live remote transport (queryServer);
                              Phase 01: verifies the redaction receipt
                              pre-flight — mismatch means no fetch
  receipt.ts                  SIH26171 receipt port: SHA-256 screenshot /
                              manifest digests, verified at BOTH boundaries
  client-openai/gemini.ts     server-side model clients (keys never on device;
                              Phase 01: enforce assertSanitizedPackage at entry)
executor/                   Local Executor (click/type/scroll/navigate)
  format-value.ts            SIH26171 format port: reshape a typed value to
                              the field's declared shape (DD-MM-YYYY etc.)
shared/                     settings model (extension + server both import)
utils/                      coords.ts (all coordinate conversions), DOM
                            extractor, screenshot, messaging, digest
extension/src/              popup UI (chat, settings, HUD) + offscreen host
types/index.ts              THE contract: shared shapes for every box
ml/                         Python parity reference (fusion, PII classifier)
tests/ + privacy/engine/vision/test-*.ts   suites (27, all in `npm test`;
                            test-privacy-contract.ts = Phase 01 contract suite)
fixtures/                   synthetic PII fixtures (never real data)
demo-portal/                static demo site for manual E2E
docs/                       Round 2 context + this document
```

## Key invariants pinned by tests

- **Fail-closed ordering** (`test-privacy-boundary.ts` §Order): in
  `orchestrator/runStep.ts`, `capturePackage → runVisionPath → applyPlaceholders
  → redactVisual → decide → queryServer` in source order; `queryServer(`
  appears exactly once as a call; no `fetch(` in the loop (remote transport is
  `queryServer` only). Same intent is pinned by `test-face-pipeline.ts` §9.
- **Outbound defense** (`remote-agent/assert.ts`, re-exported by `router.ts`):
  every package crossing the wire passes `assertSanitizedPackage` — refuses raw
  fields (`tabId`, `dataUrl`, `detections`), requires `redacted: true`
  provenance, scans serialized PII patterns, and validates placeholder tokens.
  As of Phase 01 the boundary is a leaf module: `queryOpenAI` and `queryGemini`
  enforce it themselves, so no provider can be dispatched an unsanitized
  package even when called directly (pinned by `tests/test-privacy-contract.ts`
  [5], which also proves the fetch spy is never reached).
- **Canonical finding model** (`privacy/engine/normalize.ts`): every finding
  crossing a module or process boundary is validated and rebuilt by
  `normalizeDetection(s)` — exact 5-field shape, closed category/source sets,
  confidence ∈ [0,1], bbox finite with w>0/h>0. Malformed findings throw
  `PrivacyError` with a stable `PRIVIS_*` code and abort the step (fail closed);
  they are never silently dropped. Pinned by `tests/test-privacy-contract.ts`
  [1]/[4]/[7], including 500 seeded adversarial cases.
- **No silent redaction skips** (`privacy/sanitizer/visual-redact.ts`): a
  malformed bbox throws instead of skipping the region (a skipped region means
  raw sensitive pixels cross the boundary). Valid-but-offscreen boxes clamp to
  a no-op. Pinned by `tests/test-privacy-contract.ts` [3].
- **Structural fail-closed** (`privacy/sanitizer/structural-redact.ts`): a
  non-FACE detection whose `element_id` has no backing element throws — its
  raw value would otherwise cross un-placeholdered. Vision-source FACE with
  synthetic `vision-*` ids is the documented exception (pixel-only). Pinned by
  `tests/test-privacy-contract.ts` [2].
- **Placeholder lifecycle** (`structural-redact.ts` + `runStep.ts`):
  `resetPlaceholderTokens()` at session start — real values are retained in
  the local map for the minimum lifetime the session semantics require, never
  for the service-worker lifetime. Pinned by `tests/test-privacy-contract.ts`
  [2] (determinism, value-keying, duplicate collapse, order-independence).
- **Coordinate conversions** (`utils/coords.ts`): screenshot→CSS uses
  round-half-even (Python parity, pinned by fusion tests); CSS→screenshot uses
  `Math.round` + canvas clamping (pinned by pixel-geometry tests). The two
  roundings are deliberately different — do not unify.
- **Fusion parity**: `privacy/engine/fuse.ts` mirrors `ml/fusion/fuse.py`
  (IoU ≥ 0.3, strict-confidence replace, DOM wins ties).
- **Detection confidence constants**: 0.95 regex/type hits, 0.7 label-only.
- **PII registries**: detection patterns source of truth =
  `privacy/engine/detect-dom.ts`; outbound tripwire source of truth =
  `remote-agent/types.ts` `PII_PATTERNS`. Two different roles — intentionally
  separate, do not merge.
- **Error semantics**: privacy-contract errors are `PrivacyError` instances
  with stable codes (`INVALID_DETECTION`, `INVALID_GEOMETRY`, ...), messages
  prefixed `PRIVIS_<CODE>`, and **never contain raw values** — pinned by
  `tests/test-privacy-contract.ts` [6]. Logging rule: server-side logs pass
  free text through `redactPii` before writing (`remote-agent/server.ts`).

## Developer boundaries (two-developer parallel work)

- **Dev A — pipeline & infra**: `orchestrator/`, `privacy/engine/` (except
  `vision/`), `privacy/sanitizer/`, `privacy/policy-gate/`, `remote-agent/`,
  `executor/`, `shared/`, `utils/`, `background/`, `content/`, `types/index.ts`
  (contract changes need both devs' review).
- **Dev B — vision & ML**: `privacy/engine/vision/`, `ml/`, vision test
  suites, `extension/src/offscreen/`, model assets.

Shared-file discipline: `types/index.ts` and `utils/coords.ts` changes require
the other dev's review; everything else is disjoint.

## Where new pipelines plug in (future seam, no scaffolding yet)

Every future capture modality (documents, OCR) must terminate into the same
shape: detections + elements → Sanitizer → Policy Gate → the outbound
`SanitizedPackage` built in `orchestrator/outbound.ts`. That function's
signature physically enforces sanitized-only data; nothing bypasses
`assertSanitizedPackage`. When document work starts, it lands as
`privacy/engine/` siblings to `vision/` — not by editing the sanitizer.
A document pipeline's findings arrive with `source: "ocr"` (the seam is
already a valid `DetectionSource`) and must pass the same
`normalizeDetections` gate before fusion — no bespoke path around it.
