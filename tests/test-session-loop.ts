// tests/test-session-loop.ts
// CBA-6: Multi-page session loop.
//
// Exercises the REAL loop (orchestrator/session.ts runSessionLoop +
// startSession), not a copy: a step callback stands in for the pipeline pass
// (capture→sanitize→gate→remote→executor), which is covered by the other
// suites. Checks the issue's test plan:
//  1. Trail home → form → thanks: the loop recaptures after EVERY action and
//     only ends when remote says done (the old one-shot click=done is gone).
//  2. Hit step 8 without done → ask_human + waiting_human, loop stops.
//  3. Gate block stops the loop immediately ("if not Allow: stop, tell chat").
//  4. Session state: per-tab reuse while running, fresh session after done;
//     maxSteps is 8; every update is notified to the chat popup.

import assert from "node:assert";
import { readFileSync } from "node:fs";
import type { AgentSession, AgentAction } from "../types/index.js";
import {
  MAX_SESSION_STEPS,
  endLoop,
  notifySessionUpdate,
  pendingHumanDecisions,
  resumeSession,
  runSessionLoop,
  sessionsByTab,
  startSession,
  tryBeginLoop,
  waitForHumanDecision,
  type Outcome,
} from "../orchestrator/session.js";

// chrome mock: record sessionUpdate broadcasts (what the chat popup receives).
const sentUpdates: Array<{ session: AgentSession; gate?: unknown }> = [];
(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: {
    sendMessage: async (msg: { session?: AgentSession; gateResult?: unknown }) => {
      if (msg?.session) sentUpdates.push({ session: msg.session, gate: msg.gateResult });
    },
  },
};

console.log("=== CBA-6 session loop tests ===");

function makeSession(tabId: number, goal = "fill the form"): AgentSession {
  sentUpdates.length = 0;
  return startSession(tabId, goal);
}

// A step fn that records an action into history (like runOneStep does) and
// follows a scripted list of remote actions; never says done if script runs out.
function scriptedRemote(actions: AgentAction[]): (s: AgentSession) => Promise<Outcome> {
  let i = 0;
  return async (session) => {
    const action = actions[i++] ?? { type: "scroll", dy: 400 };
    session.lastAction = action;
    session.history.push({
      step: session.history.length + 1,
      url: `page-${session.history.length}`,
      action,
      result: { ok: true },
      timestamp: Date.now(),
    });
    session.step = session.history.length;
    if (action.type === "done" || action.type === "ask_human") {
      session.status = action.type === "done" ? "done" : "waiting_human";
      return { decision: "allow", reason: "", stop: true };
    }
    return { decision: "allow", reason: "" };
  };
}

// 1. Trail: type → type → click → done. The loop must run 4 passes on ONE
//    session (3 recaptures after actions + the done pass) — the demo bug was
//    that a single click ended the session after pass 1.
{
  const session = makeSession(11, "home → form → thanks");
  const result = await runSessionLoop(session, scriptedRemote([
    { type: "type", target: { role: "textbox" }, placeholder: "NAME_1" },
    { type: "type", target: { role: "textbox" }, placeholder: "EMAIL_1" },
    { type: "click", target: { name: "Submit" } },
    { type: "done", reason: "form submitted" },
  ]));
  assert.strictEqual(session.history.length, 4, "each action is one recorded step");
  assert.strictEqual(session.step, 4);
  assert.strictEqual((result as Outcome).stop, true, "done stops the loop");
  assert.strictEqual(session.status, "done");
  assert.strictEqual(session.lastAction?.type, "done");
  console.log("  PASS trail home → form → thanks: 4 passes, one session, ends only on done");
}

// 2. Cap: never-done remote → exactly 8 passes, then ask_human + waiting_human.
{
  const session = makeSession(22);
  let passes = 0;
  const step = async (s: AgentSession): Promise<Outcome> => {
    passes++;
    const action: AgentAction = { type: "click", target: { name: "again" + passes } };
    s.history.push({ step: passes, url: "u", action, result: { ok: true }, timestamp: Date.now() });
    s.step = passes;
    return { decision: "allow", reason: "" };
  };
  const result = await runSessionLoop(session, step);
  assert.strictEqual(passes, MAX_SESSION_STEPS, "loop runs exactly maxSteps passes");
  assert.strictEqual(MAX_SESSION_STEPS, 25, "v1: max 25 steps (login flows need more than 8)");
  assert.strictEqual(session.status, "waiting_human");
  assert.strictEqual(session.lastAction?.type, "ask_human");
  assert.ok(
    result.reason.startsWith(`Step limit (${MAX_SESSION_STEPS}) reached without done`),
    "escalation names the cap"
  );
  const last = sentUpdates[sentUpdates.length - 1];
  assert.strictEqual(last?.session.status, "waiting_human", "chat is told about the escalation");
  assert.strictEqual(last?.session.lastAction?.type, "ask_human");
  console.log("  PASS hit step 8 without done → ask_human, chat notified");
}

// 2b. resumeSession: a capped/parked session is continued by the human's
// reply — same session, appended goal, fresh budget — instead of abandoning
// the task.
{
  const session = makeSession(23);
  session.status = "waiting_human"; // parked on ask_human / step cap
  session.step = MAX_SESSION_STEPS;
  resumeSession(session, "i typed the password, continue");
  assert.strictEqual(session.status, "running");
  assert.ok(
    session.goal.endsWith("[Human follow-up]: i typed the password, continue"),
    "human reply is appended to the goal the remote agent receives"
  );
  assert.strictEqual(session.maxSteps, MAX_SESSION_STEPS * 2, "each follow-up grants a fresh budget");
  let passes = 0;
  await runSessionLoop(session, async (s) => {
    passes++;
    s.step = (s.step ?? 0) + 1;
    return { decision: "allow", reason: "" };
  });
  assert.strictEqual(passes, MAX_SESSION_STEPS, "resumed loop gets a full new budget");
  assert.strictEqual(session.status, "waiting_human", "and escalates again if it still never finishes");
  console.log("  PASS resumeSession: human follow-up continues the same session with a fresh budget");
}

// 3. Gate stop: step reports block with stop → loop exits after ONE pass.
{
  const session = makeSession(33);
  let passes = 0;
  const result = await runSessionLoop(session, async (s) => {
    passes++;
    s.step = 1;
    return { decision: "block", reason: "PASSWORD on external site", stop: true };
  });
  assert.strictEqual(passes, 1, "not-allow stops immediately");
  assert.strictEqual(result.decision, "block");
  console.log("  PASS gate not-allow stops the loop, reason propagates to chat");
}

// 4. Session state semantics: reuse while running, reset after done.
{
  const first = makeSession(44, "goal A");
  assert.strictEqual(first.maxSteps, MAX_SESSION_STEPS);
  first.status = "running";
  first.history.push({ step: 1, url: "u", action: { type: "scroll", dy: 1 }, timestamp: Date.now() });
  first.step = 1;
  const reused = startSession(44, "goal B");
  assert.strictEqual(reused.sessionId, first.sessionId, "live session is reused");
  assert.strictEqual(reused.goal, "goal A", "a running session keeps its original goal");
  assert.strictEqual(reused.history.length, 1, "history survives between messages");
  reused.status = "done";
  const fresh = startSession(44, "goal C");
  assert.notStrictEqual(fresh.sessionId, reused.sessionId, "done session resets for a new goal");
  assert.strictEqual(fresh.history.length, 0);
  assert.strictEqual(fresh.step, 0);
  assert.notStrictEqual(startSession(45, "other tab").sessionId, fresh.sessionId, "state is per-tab");
  assert.ok(sessionsByTab.has(44) && sessionsByTab.has(45));

  // Escalated (waiting_human, no pending gate decision) + new goal → fresh
  // session; a session parked ON a pending decision must NOT be reset.
  fresh.status = "waiting_human";
  fresh.step = 8;
  const afterEscalation = startSession(44, "goal D");
  assert.notStrictEqual(afterEscalation.sessionId, fresh.sessionId,
    "post-ask_human goal starts a fresh session (no instant cap re-hit)");
  const parked = startSession(46, "parked");
  parked.status = "waiting_human";
  waitForHumanDecision(parked.sessionId); // registers a pending decision
  const reusedParked = startSession(46, "parked B");
  assert.strictEqual(reusedParked.sessionId, parked.sessionId,
    "session awaiting a gate approval is not reset by a new goal");
  pendingHumanDecisions.delete(parked.sessionId);
  console.log("  PASS session state: per-tab, reused while running, reset when finished");
}

// 4b. One loop per tab: tryBeginLoop rejects a concurrent second loop.
{
  assert.strictEqual(tryBeginLoop(77), true);
  assert.strictEqual(tryBeginLoop(77), false, "second loop on same tab refused");
  assert.strictEqual(tryBeginLoop(78), true, "other tab unaffected");
  endLoop(77);
  assert.strictEqual(tryBeginLoop(77), true, "loop slot freed after end");
  endLoop(77);
  endLoop(78);
  console.log("  PASS one active loop per tab (toolbar + chat cannot interleave history)");
}

// 5. Human decision wiring (popup approve/reject resolves the loop's wait).
{
  const session = makeSession(55);
  let approved: boolean | undefined;
  const waiting = waitForHumanDecision(session.sessionId).then((a) => { approved = a; });
  assert.ok(pendingHumanDecisions.has(session.sessionId), "loop parks the decision here");
  // Simulate the service worker's cba.humanDecision handler:
  pendingHumanDecisions.get(session.sessionId)!(true);
  pendingHumanDecisions.delete(session.sessionId);
  await waiting;
  assert.strictEqual(approved, true);
  console.log("  PASS waitForHumanDecision resolves via pendingHumanDecisions");
}

// 6. Static: the pipeline in runStep.ts must not end the session on click/type
//    (the old one-shot demo behaviour) — "done" status only comes from the
//    terminal-action path or the loop's own bookkeeping.
{
  const src = readFileSync("orchestrator/runStep.ts", "utf-8");
  const doneAssigns = src.match(/session\.status\s*=\s*[^;]*"done"[^;]*;/g) ?? [];
  assert.strictEqual(doneAssigns.length, 1,
    'exactly one session.status assignment can say "done" (the terminal done action)');
  assert.ok(src.includes("runSessionLoop(session"), "runStep drives the real CBA-6 loop");
  assert.ok(src.includes("waitForTabSettled(tabId)"), "recapture waits for the action's page load");
  assert.ok(src.includes('agentAction.type === "done" || agentAction.type === "ask_human"'),
    "done/ask_human are terminal and stop the loop");
  console.log("  PASS runStep.ts static: click/type recapture, only done/ask_human/gate stop the loop");
}

console.log("\nALL CBA-6 SESSION LOOP TESTS PASSED");
