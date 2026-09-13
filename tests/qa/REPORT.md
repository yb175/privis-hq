# Pipeline QA report

- Repo / slice: `privis-hq` / Issue #77 durable session state, telemetry, and verification
- Date: 2026-09-13
- Scope: session recovery, planner verification contracts, local postcondition checks, privacy, server defaults, and regression suite
- Live model: not exercised; no production model credentials used

## Verdict

**demo-only** — the decision spine is implemented and locally tested, but live-model quality, real-browser cross-site behavior, backend confirmation, rate limiting, and production authentication remain unproven or intentionally deferred.

## Inventory

| Hop | Status | Evidence |
|---|---|---|
| Capture | implemented | `orchestrator/runStep.ts` |
| Sanitization | implemented | `privacy/sanitizer/*` |
| Policy gate | implemented | `privacy/policy-gate/policy-gate.ts` |
| Planner | implemented | `remote-agent/router.ts`, `remote-agent/prompt.md` |
| Verification contract | implemented | `remote-agent/types.ts`, `remote-agent/guard.ts` |
| Local verification | implemented | `orchestrator/verification.ts` |
| Session recovery | implemented | `orchestrator/session.ts`, `orchestrator/runGoal.ts` |
| Telemetry | implemented, bounded | `orchestrator/telemetry.ts` |
| Executor | implemented | `executor/*` |
| Server auth/CORS | implemented but opt-in | `remote-agent/server.ts` |
| Live AI evaluation | blocked | no live API key used |

## Scorecard (0–5)

| Area | Score | Note |
|---|---:|---|
| Secrets / PII | 4 | Raw values and screenshots remain memory-only in session persistence; existing redaction tests pass. |
| Ingress safety | 3 | Bearer auth exists but is disabled unless configured. |
| State machine | 4 | Bounded loop, persistence, duplicate suppression, and human escalation pass tests. |
| AI blast radius | 4 | Output is schema/PII checked; verifier cannot execute actions. |
| Retries / recovery | 3 | Bounded, but no backend idempotency or site adapter. |
| Verification | 3 | Strong for observable DOM transitions; weak for backend-confirmed outcomes. |
| Data / PII | 4 | Sanitized persistence and wire tests pass. |
| API surface | 3 | Contract is bounded, but CSS verification targets are not locally resolvable. |
| Observability | 3 | Correlation IDs and bounded telemetry exist; no production export/alerting. |
| Tests vs reality | 3 | Extensive mocks and fixtures; no live browser matrix or live model scoring. |

## Scenario matrix

| ID | Case | Expected | Actual | Result |
|---|---|---|---|---|
| V1 | Planner returns action + verification wrapper | Preserve both safely | Guard and parser preserve contract | PASS |
| V2 | Invalid verification type | Reject before execution | Rejected | PASS |
| V3 | Verification contains PII | Reject/fail closed | Rejected | PASS |
| V4 | Verification target uses stale/different snapshot | Reject | Snapshot mismatch rejected | PASS |
| V5 | Text appears after action | Verify locally | Passes | PASS |
| V6 | Text never appears | Timeout, no success | Returns `TIMEOUT` | PASS |
| V7 | Verification timeout | Bounded wait | Enforced 100–10000ms contract | PASS |
| V8 | Service-worker restart | Restore sanitized control state | Restored from storage mock | PASS |
| V9 | Persisted state contains PII | No raw goal/value | Redaction test passes | PASS |
| V10 | Persisted state contains screenshot/map | Never persist | `outboundPayload` omitted | PASS |
| V11 | Hidden/unsupported CSS verification target | No unsafe action | Safely fails/abstains, but may waste retries | WATCH |
| V12 | Navigation with URL verification | Verify after navigation | Implemented and bounded | PASS |
| V13 | SPA delayed transition | Poll until timeout | Covered by bounded polling; real sites not exercised | WATCH |
| V14 | Optimistic UI success, backend later rejects | Do not claim final success | Not detectable without backend/network adapter | FAIL |
| V15 | Payment/order/email side effect | Human confirmation | Existing policy requires escalation | PASS |
| V16 | Server exposed without bearer token | Refuse exposure or warn | Server starts with auth off unless configured | FAIL |
| V17 | Duplicate successful action | Suppress repeat | Existing E2E passes | PASS |
| V18 | Live model malformed/injected output | Ask human, no execution | Existing guard tests pass | PASS |

## Live AI

Blocked. No live model credentials were used. Mocked provider responses are not evidence of planner reliability, verification quality, or prompt-injection resistance against real model output.

## Findings

### P0

- None observed in the local suite.

### P1

- `remote-agent/server.ts` — authentication is opt-in. Exposing the server without `AGENT_AUTH_TOKEN` allows arbitrary callers to spend provider keys. Keep it localhost-only in demos and require auth for any non-loopback bind.
- `orchestrator/verification.ts` — verification is DOM-observation based. It cannot detect server-side rejection after an optimistic UI update, payment settlement, email delivery failure, or order cancellation.
- `orchestrator/verification.ts` — CSS verification targets are accepted by the contract but cannot be resolved by the verifier, so model-generated CSS checks can systematically timeout and burn the session budget.
- No live browser matrix covers Gmail, Zepto, Amazon/Flipkart, checkout, iframes, shadow DOM, localization, or accessibility-tree differences.

### P2

- Telemetry is persisted locally but has no UI/export/alerting contract yet.
- Verification evidence is stored as compact detail strings rather than a typed evidence model.
- `count_changed` is generic and can produce false positives when unrelated matching elements are added or removed.

## What is solid

- Typecheck and production build pass.
- Full `npm test` passes.
- Verification timeout, malformed contract, PII rejection, snapshot binding, and session-restart tests pass.
- Existing privacy, router, guard, executor, session E2E, and transparency suites pass.
- Raw screenshots, real values, and placeholder maps are not persisted as session control state.
- Verification is read-only and cannot override policy or execute browser actions.

## Human replay

```bash
npm test
npm run build
npm run test:verification
npm run serve:agent
```

For non-loopback deployment, configure `HOST`, `AGENT_AUTH_TOKEN`, and `AGENT_ALLOWED_ORIGINS` before starting the server. Do not treat mocked provider tests as live-AI evidence.
