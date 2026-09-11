// orchestrator/session.ts
// CBA-6: multi-page session state. One session per tab carrying tabId, step,
// last action and goal. State lives in memory only (CONTRACT.md rule 1/2 —
// raw captures and real values never written to disk or storage; sanitized
// outbound wire packages logged separately under CBA-11). The Remote Agent
// is stateless; the loop here IS the agent's memory.

import type {
  AgentSession,
  PolicyGateResult,
  StepResult,
} from "../types/index.js";

// One pipeline pass reports its StepResult plus `stop`: whether the session
// loop must end (done / ask_human / gate block / human reject).
export type Outcome = StepResult & { stop?: boolean };

// Max steps per session. A multi-page flow (login → search → select → confirm)
// needs more than the old 8; hitting the cap without `done` still escalates
// to ask_human, and a human follow-up grants a fresh budget (resumeSession).
export const MAX_SESSION_STEPS = 25;

// In-memory session registry, keyed by tabId.
const sessionsByTab = new Map<number, AgentSession>();

// Pending gate approvals, keyed by sessionId (resolved by the popup's
// cba.humanDecision message handler in the service worker).
const pendingHumanDecisions = new Map<string, (approved: boolean) => void>();

// Tabs with a session loop currently executing. A second runStep on the same
// tab (toolbar click while a chat goal runs) must not interleave history.
const activeLoops = new Set<number>();

export function tryBeginLoop(tabId: number): boolean {
  if (activeLoops.has(tabId)) return false;
  activeLoops.add(tabId);
  return true;
}

export function endLoop(tabId: number): void {
  activeLoops.delete(tabId);
}

export function getSession(tabId: number): AgentSession | undefined {
  return sessionsByTab.get(tabId);
}

export { sessionsByTab, pendingHumanDecisions };

/**
 * Start a run on a tab: reuse the live session only if it is still in
 * progress; a finished (done/error/blocked) or absent session gets a fresh
 * one for the new goal.
 */
export function startSession(tabId: number, goal: string): AgentSession {
  let session = sessionsByTab.get(tabId);
  // A waiting_human session with NO pending gate decision is an escalation
  // (done budget exhausted / remote asked the human) — the loop already ended,
  // so a new goal starts a fresh session instead of instantly re-hitting the
  // step cap. A session parked on waitForHumanDecision still has a pending
  // entry and is left alone.
  const escalated =
    session?.status === "waiting_human" &&
    !pendingHumanDecisions.has(session.sessionId);
  if (
    !session ||
    session.status === "done" ||
    session.status === "error" ||
    session.status === "blocked" ||
    escalated
  ) {
    session = {
      sessionId:
        "sess_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      tabId,
      goal,
      step: 0,
      maxSteps: MAX_SESSION_STEPS,
      status: "running",
      history: [],
    };
    sessionsByTab.set(tabId, session);
  } else {
    // A live session keeps its original goal — a second message while the
    // loop runs must not hijack it (runStep rejects such calls anyway).
    session.status = "running";
  }
  return session;
}

/**
 * Resume a session parked in `waiting_human` (remote asked the human, or the
 * step cap escalated): the human's chat reply is appended to the goal, and a
 * fresh step budget is granted — each human continuation buys another
 * MAX_SESSION_STEPS, so the loop is bounded between human touches but never
 * abandons an unfinished task.
 */
export function resumeSession(session: AgentSession, humanReply: string): void {
  session.goal = `${session.goal}\n[Human follow-up]: ${humanReply}`;
  session.status = "running";
  session.error = undefined;
  session.maxSteps = (session.step ?? 0) + MAX_SESSION_STEPS;
}

/** Broadcast session state (and optionally the latest gate result) to the chat popup. */
export function notifySessionUpdate(
  session: AgentSession,
  gateResult?: PolicyGateResult
): void {
  const payload = { type: "cba.sessionUpdate", session, gateResult };
  try {
    // Popup might be closed; safe to ignore in MV3.
    void chrome.runtime.sendMessage(payload).catch(() => {});
  } catch {
    // No receiver — ignore.
  }
}

/** Resolve when the human approves/rejects this session's pending gate decision. */
export function waitForHumanDecision(sessionId: string): Promise<boolean> {
  return new Promise((resolve) => {
    pendingHumanDecisions.set(sessionId, resolve);
  });
}

/**
 * The CBA-6 session loop, isolated from the pipeline so it is testable:
 * run `step` while session.step < maxSteps; stop the moment it reports
 * `stop`. Hitting the cap without `done` escalates to ask_human — the agent
 * burned its budget, a human takes over.
 */
export async function runSessionLoop(
  session: AgentSession,
  step: (session: AgentSession) => Promise<Outcome>
): Promise<StepResult> {
  while ((session.step ?? 0) < (session.maxSteps ?? MAX_SESSION_STEPS)) {
    const outcome = await step(session);
    if (outcome.stop) return outcome;
  }
  const reason = `Step limit (${session.maxSteps ?? MAX_SESSION_STEPS}) reached without done — asking human.`;
  const action = { type: "ask_human", reason } as const;
  session.lastAction = action;
  // Record it like any other step: the chat renders history, and a cap hit
  // at step 0 (no passes run yet) would otherwise show no ask_human chip.
  session.history.push({
    step: session.history.length + 1,
    url: "",
    action,
    result: { ok: true },
    timestamp: Date.now(),
  });
  session.step = session.history.length;
  session.status = "waiting_human";
  notifySessionUpdate(session);
  return { decision: "allow", reason };
}
