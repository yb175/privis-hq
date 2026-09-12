# PRIVIS QA Report — CBA-6 Multi-Page Session Loop

- **Product box:** Orchestrator (`orchestrator/session.ts`, `orchestrator/runStep.ts`)
- **Scope:** issue #46 — the while-loop that recaptures after every action
- **Reviewed:** branch `feat/cba-6-multi-page-session-loop`
- **Evidence run:** `npm test` (typecheck + CBA-1/2/3/5 + privacy boundary + popup + `test:loop` + `test:session-e2e`) — all passed. `npm run build` passed.

## 1. What was attacked, and with what

| Attack | Vehicle | Result |
|---|---|---|
| Old one-shot behaviour: does a click/type still end the session? | E2E trail home → form → thanks: `navigate → type ×3 → click → done` must be **one** session with recaptures on all three pages | Caught. 6 passes, ends only on remote `done` |
| Runaway agent: brain that never says `done` | Scripted `/plan` returning `click` forever | Loop executes exactly 8 steps, escalates to `ask_human`, parks `waiting_human`, chat notified |
| Deadlocked user: new goal after an escalation | Second `runStep` on a capped session | Fresh session starts (found + fixed bug #2 below) |
| Double-drive: two loops on one tab | `runStep` while a loop is active | Refused by per-tab loop guard (found + fixed bug #1) |
| PII on the wire | Raw HTTP body of every `/plan` call scanned for the 6 real values (name, email, PAN, phone, amount, password) across all steps | 0 leaks; placeholders cross, real values only appear in the on-device executor payload |
| Gate bypass mid-session | Bank page with PASSWORD field while a session would otherwise run | `blocked`, **zero** remote calls, reason to chat |
| Privacy pipeline order after refactor | Static audit in `test-privacy-boundary` now points at `orchestrator/runStep.ts` + persistence/network scan extended to both new files | Order capture→vision→sanitize→gate→remote holds; no fetch/persistence in orchestrator |
| Progress-stealing capture (page mutates under screenshot) | Existing `capturePackage` before/after fingerprint loop exercised on every pass | Consistent snapshots enforced |

## 2. Bugs found and fixed during QA

1. **Concurrent loops per tab.** The old one-shot `runStep` made overlap
   harmless; with a real loop, a toolbar click while a chat goal runs would
   interleave history/steps. Fix: `tryBeginLoop`/`endLoop` guard — second
   caller gets a refusal, session untouched, live goal not hijacked
   (`startSession` no longer overwrites the goal of a reused session).
2. **Escalation dead-lock.** After the 8-step cap, `status=waiting_human` and
   `step=8` were *reused* by `startSession`: the next goal instantly
   re-escalated without executing anything. Fix: a `waiting_human` session
   with no pending gate decision (i.e. an escalation, not a park) resets to a
   fresh session; a session parked on a real approval prompt is left alone.
3. **Invisible escalation.** The cap `ask_human` set `lastAction` but never
   entered `history`, and the chat renders history — the escalation chip
   would not appear (and a cap at step 0 showed nothing at all). Fix: the
   escalation is recorded as a step.

## 3. Known gaps (deliberate)

- **Indefinite human-approval park.** `waitForHumanDecision` never times out;
  if the popup is closed, the loop (and the tab's loop slot) waits until the
  service worker dies and memory resets. Pre-existing (CBA-4 behaviour);
  a timeout belongs in CBA-9 wiring where chat state is owned end-to-end.
- **Post-escalation Approve card.** If the last gate decision was
  `human_approval` before a later `ask_human` escalation, the chat may show a
  stale approval card whose resolver is gone (`cba.humanDecision` answers
  `ok:false`). Cosmetic; fix is gate-badge scoping per step in CBA-9.
- **MV3 idle timeout.** Long loops rely on chrome API activity to keep the
  worker alive; a >30s stall (human park) can evict the SW — in-memory
  sessions die with it by design (fail-closed, nothing leaks to disk).
- **Remote amnesia by design.** The plan sees only the current sanitized
  package; repeated identical actions consume budget until `ask_human`
  instead of looping forever. Form progress is visible to the brain only via
  redaction footprint — sharper progress context is a CBA-7/#47 concern.
- **Browser-level E2E** (real chromium, real `captureVisibleTab`, offscreen
  ONNX document) not automated here; the Node harness runs the same real
  modules against faked `chrome.*`. Manual trail to verify before closing the
  parent issue: load `dist`, demo portal, `npm run serve:agent`, watch three
  recaptures in chat.

## 4. Verdict

The loop is the agent: bounded (8 steps), stateful on-device, privacy
invariants unchanged and now re-audited against the new files. Ship for #46;
gaps above are routed to CBA-7/CBA-9, not blockers.
