// orchestrator/runGoal.ts
// CBA-9: Single entry point for goal execution in the background.
// Chat, HUD, and tests must all enter through runGoal so every execution
// strictly flows through:
// Capture -> Local Vision Engine -> Sanitizer -> Policy Gate -> Remote Agent -> Local Executor.
// Bypassing Policy Gate by directly invoking the remote agent is forbidden.

import type { StepResult } from "../types/index.js";
import { getSession, pendingHumanDecisions, resumeSession } from "./session.js";
import { runStep } from "./runStep.js";

/**
 * Resolve the currently active tab ID in Chrome.
 */
export async function resolveActiveTabId(): Promise<number> {
  if (
    typeof chrome !== "undefined" &&
    chrome.tabs &&
    typeof chrome.tabs.query === "function"
  ) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const id = tabs[0]?.id;
    if (typeof id === "number") return id;
  }
  throw new Error("runGoal: No active tab found");
}

/**
 * Execute a user goal on a tab through the full privacy-preserving pipeline.
 *
 * @param text The user goal or instruction (e.g. "Submit the employee portal form")
 * @param tabId Optional tab ID. If omitted, resolves the current active tab.
 */
export async function runGoal(text: string, tabId?: number): Promise<StepResult> {
  const goalText = typeof text === "string" ? text.trim() : "";
  if (!goalText) {
    throw new Error("runGoal: Goal text must not be empty");
  }

  const targetTabId = typeof tabId === "number" ? tabId : await resolveActiveTabId();

  // A session parked on an escalation (remote ask_human / step cap) is resumed
  // by the human's chat reply — same session, same history, fresh step budget.
  // A session parked on a gate approval still has a pending decision; the loop
  // is live there, so leave it to the Approve/Reject card (runStep's loop guard
  // rejects the call anyway).
  const parked = getSession(targetTabId);
  if (
    parked &&
    parked.status === "waiting_human" &&
    !pendingHumanDecisions.has(parked.sessionId)
  ) {
    resumeSession(parked, goalText);
    return runStep(targetTabId, parked.goal);
  }

  return runStep(targetTabId, goalText);
}
