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

import { tokeniseGoal } from "./goal-tokenize.js";

/**
 * Sanitize untrusted human replies: tokenize lexical PII, redact raw passwords/OTPs/credentials,
 * and ensure raw sensitive values never become part of session.goal or outbound payloads.
 */
export function sanitizeHumanReply(
  humanReply: string,
  session?: AgentSession
): { safeText: string; secretValue?: string } {
  const trimmed = humanReply.trim();

  const nonSecretWords = /^(?:entered|submitted|done|typed|provided|ready|ok|continue|confirmed|filled|here|now)$/i;

  // Check if reply contains a password, OTP, PIN, or secret credential
  const passwordMatch = trimmed.match(/(?:password|passwd|pwd|passphrase)\s*(?:is|was|[:=])\s*([^\s,;]+)/i) ??
    trimmed.match(/(?:password|passwd|pwd|passphrase)\s+([^\s,;]+)/i);
  const otpMatch = trimmed.match(
    /(?:otp|one[- ]?time[- ]?(?:password|code|pin)|2fa|mfa|verification code|security code)\s*(?:is|was|[:=])?\s*([0-9a-zA-Z]{4,10})/i
  );
  const pinMatch = trimmed.match(/(?:pin|cvv|cvc|secret)\s*(?:is|was|[:=])\s*([^\s,;]+)/i);
  const bareOtpMatch = /^[0-9]{4,8}$/.test(trimmed) ? trimmed : null;

  let secretValue: string | undefined = undefined;
  let sanitized = trimmed;

  if (passwordMatch && passwordMatch[1] && !nonSecretWords.test(passwordMatch[1])) {
    secretValue = passwordMatch[1];
    sanitized = sanitized.replace(passwordMatch[1], "[SECRET_CREDENTIAL]");
  } else if (otpMatch && otpMatch[1] && !nonSecretWords.test(otpMatch[1])) {
    secretValue = otpMatch[1];
    sanitized = sanitized.replace(otpMatch[1], "[OTP_CREDENTIAL]");
  } else if (pinMatch && pinMatch[1] && !nonSecretWords.test(pinMatch[1])) {
    secretValue = pinMatch[1];
    sanitized = sanitized.replace(pinMatch[1], "[SECRET_PIN]");
  } else if (bareOtpMatch) {
    secretValue = bareOtpMatch;
    sanitized = "[OTP_CREDENTIAL]";
  } else if (
    session?.lastAction?.type === "ask_human" &&
    /password|otp|pin|credential|secret|login/i.test((session.lastAction as any).reason ?? "") &&
    !nonSecretWords.test(trimmed)
  ) {
    secretValue = trimmed;
    sanitized = "[SECRET_CREDENTIAL]";
  }

  // Tokenize any remaining lexical PII (emails, PANs, Aadhaar, etc.)
  const tokenised = tokeniseGoal(sanitized, session?.sessionId);
  return { safeText: tokenised.goal, secretValue };
}

/**
 * Resume a session parked in `waiting_human` (remote asked the human, or the
 * step cap escalated): the human's chat reply is sanitized/tokenized and appended to the goal,
 * granting a fresh step budget. Raw secrets and PII never enter session.goal.
 */
export function resumeSession(session: AgentSession, humanReply: string): void {
  const { safeText } = sanitizeHumanReply(humanReply, session);
  session.goal = `${session.goal}\n[Human follow-up]: ${safeText}`;
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
