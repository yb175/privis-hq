// background/service-worker.ts
// MV3 Service Worker entry point. The pipeline itself — Capture Layer →
// Local Privacy Vision Engine → Sanitizer → Policy Gate → Remote Agent →
// Local Executor, run as the CBA-6 multi-page session loop (max 8 steps,
// recapture after every action) — lives in orchestrator/runStep.ts with
// session state in orchestrator/session.ts. This file only wires the loop to
// chrome: toolbar click, popup/HUD message handlers, and the debug global.

import { takeScreenshot } from "../utils/screenshot.js";
import { runStep, capturePackage, getLiveSteps } from "../orchestrator/runStep.js";
import { runGoal } from "../orchestrator/runGoal.js";
import {
  sessionsByTab,
  pendingHumanDecisions,
} from "../orchestrator/session.js";

// Toolbar clicks carry no typed goal; run with the demo default.
const DEFAULT_GOAL = "Submit the employee portal form";

// Toolbar click → one full session loop on the active tab, default goal.
chrome.action.onClicked.addListener((tab) => {
  if (typeof tab.id !== "number") return;
  runGoal(DEFAULT_GOAL, tab.id).catch((err: unknown) => {
    console.error(
      "PRIVIS runGoal (toolbar) failed:",
      err instanceof Error ? err.message : String(err)
    );
  });
});

// Expose on self and globalThis for DevTools service worker console testing
const privisAPI = {
  takeScreenshot,
  capturePackage,
  runStep,
  runGoal,
  sessionsByTab,
  pendingHumanDecisions,
};
(globalThis as unknown as { privis: unknown }).privis = privisAPI;
if (typeof self !== "undefined") {
  (self as unknown as { privis: unknown }).privis = privisAPI;
}


// Plus the pre-existing { type: "PRIVIS_CAPTURE_SCREENSHOT", tabId } → { dataUrl }.
// Both are in-memory only.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "hud.getLatestSteps") {
    sendResponse({ steps: getLiveSteps() });
    return false;
  }
  if (msg?.type === "cba.getSession") {
    const tabId = typeof msg.tabId === "number" ? msg.tabId : undefined;
    const sendSession = (id: number) => {
      sendResponse({ session: sessionsByTab.get(id) || null });
    };
    if (typeof tabId === "number") {
      sendSession(tabId);
      return false;
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        const activeTabId = tabs[0]?.id;
        if (typeof activeTabId === "number") {
          sendSession(activeTabId);
        } else {
          sendResponse({ session: null });
        }
      });
      return true;
    }
  }
  if (msg?.type === "RUN_GOAL") {
    const text =
      typeof msg.text === "string" && msg.text
        ? msg.text
        : typeof msg.goal === "string" && msg.goal
        ? msg.goal
        : DEFAULT_GOAL;
    const tabId = typeof msg.tabId === "number" ? msg.tabId : undefined;
    runGoal(text, tabId)
      .then((res) => {
        const resolvedTabId =
          typeof tabId === "number"
            ? tabId
            : Array.from(sessionsByTab.entries()).find(
                ([, sess]) => sess.goal === text
              )?.[0];
        const session =
          typeof resolvedTabId === "number"
            ? sessionsByTab.get(resolvedTabId)
            : null;
        sendResponse({ ok: true, session, result: res });
      })
      .catch((err: unknown) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        })
      );
    return true; // async response
  }
  if (msg?.type === "cba.startSession") {
    const goal = typeof msg.goal === "string" && msg.goal ? msg.goal : DEFAULT_GOAL;
    const tabId = typeof msg.tabId === "number" ? msg.tabId : undefined;
    runGoal(goal, tabId)
      .then((res) => {
        const resolvedTabId =
          typeof tabId === "number"
            ? tabId
            : Array.from(sessionsByTab.entries()).find(
                ([, sess]) => sess.goal === goal
              )?.[0];
        const session =
          typeof resolvedTabId === "number"
            ? sessionsByTab.get(resolvedTabId)
            : null;
        sendResponse({ ok: true, session, result: res });
      })
      .catch((err: unknown) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
      );
    return true;
  }
  if (msg?.type === "cba.humanDecision" && typeof msg.sessionId === "string") {
    const resolver = pendingHumanDecisions.get(msg.sessionId);
    if (resolver) {
      resolver(Boolean(msg.approved));
      pendingHumanDecisions.delete(msg.sessionId);
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: "No pending human approval for session " + msg.sessionId });
    }
    return false;
  }
  if (msg?.type === "privis.runStep" && typeof msg.tabId === "number") {
    const goal = typeof msg.goal === "string" && msg.goal ? msg.goal : DEFAULT_GOAL;
    runGoal(goal, msg.tabId)
      .then(sendResponse)
      .catch((err: unknown) =>
        sendResponse({ error: err instanceof Error ? err.message : String(err) })
      );
    return true; // async response
  }
  if (msg?.type === "PRIVIS_CAPTURE_SCREENSHOT" && typeof msg.tabId === "number") {
    takeScreenshot(msg.tabId)
      .then((r) => sendResponse(r))
      .catch((err: unknown) =>
        sendResponse({ error: err instanceof Error ? err.message : String(err) })
      );
    return true; // async response
  }
  return false;
});
