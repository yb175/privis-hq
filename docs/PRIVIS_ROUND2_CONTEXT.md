# PRIVIS Round 2 — Context

Working notes for Round 2 development. The contract lives in `CONTRACT.md`;
the architecture layout lives in `PRIVIS_ROUND2_ARCHITECTURE.md` (this folder).
Nothing here overrides the contract.

## What PRIVIS is

An on-device privacy layer for light-weight browser agents: the extension
captures the page, a **local** vision engine detects sensitive entities (DOM
rules + face detection), a sanitizer replaces/blurs them, a policy gate decides
whether anything may leave the device, and only then does a remote agent
(the "remote brain") plan the next action — which a local executor applies on
the real page, swapping placeholders back to real values on-device.

## Locked architecture (never rename these boxes)

Capture Layer → Local Privacy Vision Engine → Sanitizer → Policy Gate →
Remote Agent → Local Executor

## Non-negotiable privacy rules (summary — CONTRACT.md is authoritative)

1. Raw screenshots never leave the device.
2. Sanitized screenshots stay in memory.
3. Raw DOM values never go to remote models.
4. The local placeholder→value map never leaves the device.
5. Remote agents only ever receive sanitized context.
6. Verification failures fail closed.

## Round 2 state (Phase 01: privacy engine hardening + unified contract)

- Phase 01 added the canonical finding contract: `privacy/engine/normalize.ts`
  (PrivacyError + stable codes, closed category/source sets, geometry assert,
  normalizeDetection rebuild). Every finding crossing a module or process
  boundary is normalized; malformed findings fail closed.
- Visual/structural redaction hardened: no silent skips on malformed geometry;
  stale non-FACE findings abort the step; placeholder state is session-scoped.
- Outbound boundary moved to a leaf module (`remote-agent/assert.ts`) and is
  enforced by both provider clients at entry, not only by the router.
- Full Phase 00 state below is still accurate as the pipeline baseline.

- Live pipeline: multi-step session loop (`orchestrator/runStep.ts` + `capture.ts` /
  `hud.ts` / `outbound.ts`), YuNet face detection via ONNX Runtime Web in the
  offscreen document, M4 DOM+vision fusion, placeholder sanitizer, visual
  redaction, policy gate, operator-hosted remote-agent server (chatgpt/gemini),
  local executor with click/type/scroll/navigate, session HUD + transparency log.
- Detection (DOM path): `privacy/engine/detect-dom.ts`.
- Detection (vision path): `privacy/engine/vision/` (face pipeline). OCR /
  document pipelines are **not implemented** — Round 2 work.
- Reference Python implementations: `ml/` (fusion parity, PII classifier).
  The Python side is a parity reference, not shipped in the extension.

## Regression gate (run before every merge)

```
npm run typecheck
npm run build
npm test        # 16 suites incl. vision, face, face-pipeline, privacy
                # boundary, privacy contract
```

Python parity gate (separate toolchain, separate venv — these are assert-based
scripts, not pytest suites, so run them directly):

```
.venv-ml/Scripts/python.exe ml/fusion/test_fuse.py
.venv-ml/Scripts/python.exe ml/inference/test_pii_classifier.py
# etc. — see ml/README.md
```

Suites that read source files by path (privacy-boundary static audits,
face-pipeline §9 wiring check) must be updated **in the same PR** whenever a
pinned file moves or a pinned call expression changes — that is by design:
they pin the fail-closed ordering `capture → vision → placeholders →
redactVisual → decide → queryServer`.

## Deferred (do not build before the owning phase)

- Document pipeline (OCR, PDF handling, authenticity/ELA checks).
- Second vision models beyond YuNet face detection.
- Any new remote-agent model beyond chatgpt/gemini behind the operator server.
- Python-side work beyond parity fixtures.

## External references

Round 2 planning reviewed an external parallel implementation of the same
problem statement (tiered local-first redaction ladder, offscreen ONNX host,
placeholder allocator, synthetic eval corpus). It carries **no license**, so
only design ideas were considered — **no code, assets, or text was copied**,
and none may be. Findings that influenced Round 2 planning only: keep the
offscreen inference host pattern we already use; treat a labeled synthetic
eval corpus as the acceptance bar for the document pipeline phases.
