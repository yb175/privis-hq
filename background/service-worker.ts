// background/service-worker.ts
// MV3 Service Worker orchestrating the end-to-end pipeline.
//
// Pipeline Flow:
// 1. Capture Layer: Tab screenshot (memory-only) + Content script DOM package.
// 2. Local Privacy Vision Engine: DOM path (detectSensitive) fused with the
//    browser-local YuNet FACE detector (M6-D, fail-closed: any vision-path
//    failure rejects runStep below — gate and remote are never reached).
// 3. Sanitizer: structural placeholders (applyPlaceholders) + pixel redaction (redactVisual).
// 4. Policy Gate: Evaluate risk (Allow / Human Approval / Block).
// 5. Remote Agent: Transmit sanitized package only (never called unless the gate allows).
// 6. Local Executor: Execute actions locally on DOM.

import type {
  Action,
  AgentAction,
  AgentSession,
  CapturePackage,
  CaptureResponseMessage,
  ElementMeta,
  PolicyGateResult,
  SessionStep,
  StepResult,
} from "../types/index.js";
import { takeScreenshot } from "../utils/screenshot.js";
import { sendToContent } from "../utils/messaging.js";
import {
  detectSensitive,
  applyPlaceholders,
} from "../privacy/sanitizer/structural-redact.js";
import { redactVisual } from "../privacy/sanitizer/visual-redact.js";
import { decide } from "../privacy/policy-gate/policy-gate.js";
import { loadModelSettings } from "../extension/src/settings/models.js";
import { queryServer, serverOptionsFromSettings } from "../remote-agent/client-server.js";
import { agentActionToExecutorActions } from "../executor/agent-action.js";
import { applyActions } from "../executor/local-executor.js";
import { runVisionPath } from "../privacy/engine/vision/face-pipeline.js";

// Toolbar clicks carry no typed goal; run with the demo default.
const DEFAULT_GOAL = "Submit the employee portal form";

/**
 * Coordinates tab screenshot and DOM extraction from content script,
 * then runs DOM-path detections (detectSensitive) on the elements.
 * (Vision-path fusion happens in runStep via runVisionPath.)
 * @param tabId Target tab ID
 */
// Snapshot the content-script DOM package for a tab.
function domPackage(tabId: number): Promise<CaptureResponseMessage> {
  return sendToContent<CaptureResponseMessage>(tabId, { type: "capture.request" });
}

// Cheap, deterministic fingerprint of the DOM package. Element ids are stable
// across extractions (the content script keys them by DOM node), so equality
// here means the page did not change between snapshots.
function packageFingerprint(dom: CaptureResponseMessage): string {
  return JSON.stringify(dom.payload);
}

export async function capturePackage(tabId: number): Promise<CapturePackage> {
  const MAX_TRIES = 3;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    // Snapshot the DOM first, capture the screenshot of that same state, then
    // re-snapshot the DOM and require it to be unchanged. This guarantees the
    // detections always describe the pixels we redact — never detections from
    // one page state applied to another state's screenshot.
    const before = await domPackage(tabId);
    const { dataUrl } = await takeScreenshot(tabId);
    const after = await domPackage(tabId);
    if (packageFingerprint(before) === packageFingerprint(after)) {
      const { elements, browserState } = before.payload;
      return {
        tabId,
        dataUrl,
        elements,
        detections: detectSensitive(elements),
        browserState,
      };
    }
  }
  throw new Error(
    "capturePackage: page state kept changing between DOM snapshot and screenshot"
  );
}

// In-memory step cache for the HUD
const lastLiveSteps: Array<Record<string, unknown>> = [];

// In-memory session registry (CONTRACT.md: memory only, never written to disk or storage)
const sessionsByTab = new Map<number, AgentSession>();
const pendingHumanDecisions = new Map<string, (approved: boolean) => void>();

function notifySessionUpdate(session: AgentSession, gateResult?: PolicyGateResult) {
  const payload = {
    type: "cba.sessionUpdate",
    session,
    gateResult,
  };
  try {
    chrome.runtime.sendMessage(payload).catch(() => {
      // Popup might be closed; safe to ignore in MV3
    });
  } catch {
    // Ignore if no receiver
  }
}

function waitForHumanDecision(sessionId: string): Promise<boolean> {
  return new Promise((resolve) => {
    pendingHumanDecisions.set(sessionId, resolve);
  });
}

// Helper to broadcast step updates with rich data to the popup HUD
function broadcastHudStep(step: number, data: Record<string, unknown>) {
  const payload = { type: "hud.liveStep", step, ...data };
  if (step === 1) lastLiveSteps.length = 0;
  lastLiveSteps.push(payload);
  try {
    chrome.runtime.sendMessage(payload).catch(() => {
      // HUD popup might be closed; safe to ignore
    });
  } catch {
    // Ignore if no receiver
  }
}

/**
 * Executes a full step of the privacy-preserving agent loop.
 * @param tabId Target tab ID
 * @param goal Human prompt or task instruction
 */
export async function runStep(tabId: number, goal: string): Promise<StepResult> {
  let session = sessionsByTab.get(tabId);
  if (!session || session.status === "done" || session.status === "error" || session.status === "blocked") {
    session = {
      sessionId: "sess_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      tabId,
      goal,
      step: 1,
      maxSteps: 10,
      status: "running",
      history: [],
    };
    sessionsByTab.set(tabId, session);
  } else {
    session.status = "running";
    session.goal = goal;
  }
  notifySessionUpdate(session);

  let pkg: CapturePackage;
  try {
    pkg = await capturePackage(tabId);
  } catch (err: unknown) {
    session.status = "error";
    session.error = err instanceof Error ? err.message : String(err);
    notifySessionUpdate(session);
    throw err;
  }

  // M6-D vision path: browser-local YuNet FACE inference on the SAME in-memory
  // screenshot (no extra capture), fused with the DOM detections through the
  // M4 rules (privacy/engine/fuse.ts). FAIL-CLOSED: any decode/model/inference
  // error rejects this step before the gate — never an empty detection list
  // with an unsanitized screenshot heading to the remote agent.
  try {
    pkg.detections = await runVisionPath({
      dataUrl: pkg.dataUrl,
      elements: pkg.elements,
      domDetections: pkg.detections,
      viewport: pkg.browserState.viewport,
    });
  } catch (err: unknown) {
    session.status = "error";
    session.error = err instanceof Error ? err.message : String(err);
    notifySessionUpdate(session);
    throw err;
  }

  broadcastHudStep(1, {
    rawScreenshot: pkg.dataUrl,
    elementCount: pkg.elements.length,
    viewport: pkg.browserState.viewport,
  });

  // Vision Engine Detections
  broadcastHudStep(2, {
    detections: pkg.detections,
  });

  // Sanitizer: structural placeholders + in-memory visual redaction.
  const { sanitized, map } = applyPlaceholders(pkg.elements, pkg.detections);
  const sanitizedScreenshot = await redactVisual(
    pkg.dataUrl,
    pkg.detections,
    pkg.browserState.viewport
  );
  // Real value -> placeholder pairs, so the HUD can show the swap happening.
  // The map itself never leaves this device; only placeholders go to the agent.
  const swaps = sanitized
    .filter((el) => typeof map[el.element_id] === "string")
    .map((el) => ({ real: map[el.element_id], placeholder: el.text }));
  broadcastHudStep(3, {
    sanitizedScreenshot,
    rawScreenshot: pkg.dataUrl,
    swaps,
    detectionsCount: pkg.detections.length,
  });

  // Policy Gate: never call the remote unless the package is allowed out.
  const gate = decide({ detections: pkg.detections, browserState: pkg.browserState });
  session.gateDecision = gate.decision;
  broadcastHudStep(4, {
    decision: gate.decision,
    reason: gate.reason,
  });
  notifySessionUpdate(session, gate);

  if (gate.decision === "block") {
    session.status = "blocked";
    session.error = gate.reason;
    notifySessionUpdate(session, gate);
    return { decision: gate.decision, reason: gate.reason };
  }

  if (gate.decision === "human_approval") {
    session.status = "waiting_human";
    session.error = gate.reason;
    notifySessionUpdate(session, gate);
    const approved = await waitForHumanDecision(session.sessionId);
    if (!approved) {
      session.status = "blocked";
      session.error = "Human rejected action";
      notifySessionUpdate(session, gate);
      return { decision: gate.decision, reason: "Human rejected action" };
    }
    session.status = "running";
    notifySessionUpdate(session, gate);
  }

  // Remote Agent: only the sanitized package crosses the wire — never the raw
  // dataUrl, never the element_id -> real value map. applyPlaceholders swaps
  // only `text`, so strip the user-controlled `label` (accessible label /
  // placeholder / title) to keep any raw value out of the remote context.
  // Privacy-first: NO LLM keys on this device — the package goes to the
  // operator's remote-agent server, which holds the keys and picks the brain.
  const remoteElements: ElementMeta[] = sanitized.map((el) => ({ ...el, label: null }));
  const settings = await loadModelSettings();
  session.outboundPayload = {
    sanitizedScreenshot,
    elements: remoteElements.map(({ tag, type, role, text }) => ({ tag, type, role, text })),
    placeholders: remoteElements
      .map((element) => element.text)
      .filter((text) => /^[A-Z]+_\d+$/.test(text)),
    url: pkg.browserState.url,
    model: settings.model,
  };
  notifySessionUpdate(session, gate);

  let agentAction: AgentAction;
  try {
    agentAction = await queryServer(
      {
        goal,
        sanitizedScreenshot,
        sanitizedContext: { elements: remoteElements, browserState: pkg.browserState },
        redacted: true, // sanitizer provenance: structural placeholders + visual redaction applied above
      },
      serverOptionsFromSettings(settings)
    );
  } catch (err: unknown) {
    session.status = "error";
    session.error = err instanceof Error ? err.message : String(err);
    notifySessionUpdate(session, gate);
    throw err;
  }

  session.lastAction = agentAction;
  broadcastHudStep(5, {
    goal,
    agentAction,
  });

  // Convert the AgentAction contract into executor Actions (name/role/bbox
  // targets resolved against the sanitized elements; placeholder → real-value
  // swap happens HERE, on-device, from the local map — CONTRACT.md rule 2).
  const actions: Action[] = agentActionToExecutorActions(agentAction, sanitized, map);

  // Local Executor: apply the returned actions on the real page DOM.
  const results = await applyActions(tabId, actions);
  const stepRecord: SessionStep = {
    step: session.history.length + 1,
    url: pkg.browserState.url,
    action: agentAction,
    result: results[0] ?? { ok: true },
    timestamp: Date.now(),
  };
  session.history.push(stepRecord);
  session.step = session.history.length;
  session.status = "done";

  broadcastHudStep(6, {
    actions,
    results,
  });
  notifySessionUpdate(session, gate);

  return { decision: gate.decision, reason: gate.reason, actions: results };
}

// Toolbar click → one full step on the active tab, default goal.
chrome.action.onClicked.addListener((tab) => {
  if (typeof tab.id !== "number") return;
  runStep(tab.id, DEFAULT_GOAL).catch((err: unknown) => {
    console.error(
      "PRIVIS runStep (toolbar) failed:",
      err instanceof Error ? err.message : String(err)
    );
  });
});

// Expose on self and globalThis for DevTools service worker console testing
const privisAPI = {
  takeScreenshot,
  capturePackage,
  runStep,
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
    sendResponse({ steps: lastLiveSteps });
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
  if (msg?.type === "cba.startSession") {
    const goal = typeof msg.goal === "string" && msg.goal ? msg.goal : DEFAULT_GOAL;
    const startForTab = (id: number) => {
      runStep(id, goal)
        .then((res) => sendResponse({ ok: true, session: sessionsByTab.get(id), result: res }))
        .catch((err: unknown) =>
          sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
        );
    };
    if (typeof msg.tabId === "number") {
      startForTab(msg.tabId);
      return true;
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        const activeTabId = tabs[0]?.id;
        if (typeof activeTabId === "number") {
          startForTab(activeTabId);
        } else {
          sendResponse({ ok: false, error: "No active tab found" });
        }
      });
      return true;
    }
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
    runStep(msg.tabId, goal)
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
