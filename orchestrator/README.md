# Orchestrator (CBA-6)

The session loop — the part that makes the Remote Agent act like an agent.
One-shot `click #submit` was a demo trick; filling a form takes several
recaptures (type → type → click → next page). After each action:

```
capture → Engine → Sanitizer → Gate → Remote Agent → Executor → recapture
```

bounded to **8 steps**; hitting the cap without `done` escalates to
`ask_human` in the chat. Session state (tabId, step, last action, goal)
stays on the device — memory only, never persisted (CONTRACT.md rules 1/2).

## Files

| File | Role |
|---|---|
| `session.ts` | Per-tab session registry (`startSession` reuse/reset rules), `runSessionLoop` (the bounded while-loop + ask_human escalation), chat broadcast (`notifySessionUpdate`), pending human decisions, one-active-loop-per-tab guard. |
| `runStep.ts` | One pipeline pass (`runOneStep`): capture consistency loop → fail-closed vision path → structural + visual redaction → policy gate (block/human stop the loop) → remote plan (sanitized package only) → navigate-in-place or executor run → wait for page settle → loop. |

`background/service-worker.ts` is chrome wiring only: toolbar click, popup
message handlers (`cba.startSession` / `cba.getSession` / `cba.humanDecision`),
HUD step cache.

## Stop rules

- Gate `block` → session `blocked`, remote never called.
- Gate `human_approval` → chat parked until approve/reject (reject → blocked).
- Remote `done` → session `done`.
- Remote `ask_human` or step cap → `waiting_human` with an `ask_human` chip in
  chat; a new goal then starts a fresh session.
- Capture/vision/remote failure → session `error`, fail-closed (throws to the
  caller after notifying chat).

Tests: `npm run test:loop` (loop semantics) and `npm run test:session-e2e`
(real pipeline: home → form → thanks trail, 8-step cap, gate-block zero-call
trail, raw-socket PII wire tripwire).
