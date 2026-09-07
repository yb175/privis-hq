// orchestrator/runStep.ts
// CBA-6: the multi-page session loop. After each action:
// capture → Engine → Sanitizer → Gate → Remote Agent → Executor → recapture.
// Max 8 steps; reaching the cap without `done` escalates to ask_human.
//
//   while step < 8:
//     capture → sanitize → gate
//     if not Allow: stop, tell chat
//     action = remoteAgent.plan(...)
//     if done: stop
//     executor.run(action)
//
// Session state (tabId, step, last action, goal) stays on the device — see
// orchestrator/session.ts. This module previously lived as a one-shot runStep
// in background/service-worker.ts: a single click/type ended the session.
// Now every executed action recaptures, so form filling (type → type → click
// → next page) runs as one continuous session.

import type {
  Action,
  AgentAction,
  AgentSession,
  CapturePackage,
  CaptureResponseMessage,
  ElementMeta,
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
import { navigateTab } from "../executor/navigate.js";
import { runVisionPath } from "../privacy/engine/vision/face-pipeline.js";
import {
  notifySessionUpdate,
  runSessionLoop,
  startSession,
  waitForHumanDecision,
  tryBeginLoop,
  endLoop,
  type Outcome,
} from "./session.js";

/**
 * Snapshot the content-script DOM package for a tab, then run DOM-path
 * detections (detectSensitive) on the elements.
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

export function getLiveSteps(): Array<Record<string, unknown>> {
  return lastLiveSteps;
}

// Helper to broadcast step updates with rich data to the popup HUD
function broadcastHudStep(step: number, data: Record<string, unknown>) {
  const payload = { type: "hud.liveStep", step, ...data };
  if (step === 1) lastLiveSteps.length = 0;
  lastLiveSteps.push(payload);
  try {
    // HUD popup might be closed; safe to ignore.
    void chrome.runtime.sendMessage(payload).catch(() => {});
  } catch {
    // Ignore if no receiver
  }
}

/**
 * Let a just-executed action land before the recapture: poll until the tab
 * reports status "complete" (a click on Submit navigates to page B). Bounded
 * and non-fatal — capturePackage's before/after fingerprint check is the real
 * guard against a mid-transition snapshot.
 */
async function waitForTabSettled(tabId: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") return;
    } catch {
      return; // tab closed — capturePackage will surface the real error
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

/**
 * Execute a full step of the privacy-preserving agent loop.
 * @param tabId Target tab ID
 * @param goal Human prompt or task instruction
 */
export async function runStep(tabId: number, goal: string): Promise<StepResult> {
  // One loop per tab at a time: a toolbar click while a chat goal is running
  // must not start a second loop interleaving the same session history.
  if (!tryBeginLoop(tabId)) {
    return { decision: "allow", reason: "A session loop is already running on this tab." };
  }
  try {
    const session = startSession(tabId, goal);
    notifySessionUpdate(session);
    // CBA-6 loop: keep recapturing after each action until the agent says done,
    // the gate stops us, or the step cap is hit. Infra errors (capture, vision,
    // remote) reject the run — the session is already marked "error" + notified.
    return await runSessionLoop(session, (s) => runOneStep(s));
  } finally {
    endLoop(tabId);
  }
}

/**
 * One pipeline pass: capture → Engine → Sanitizer → Gate → Remote Agent →
 * Executor. Throws on capture/vision/remote failure (fail-closed, session
 * marked "error"); otherwise returns this pass's StepResult with `stop` set
 * when the session loop must end.
 */
async function runOneStep(session: AgentSession): Promise<Outcome> {
  const { tabId, goal } = session;
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
    return { decision: gate.decision, reason: gate.reason, stop: true };
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
      return { decision: gate.decision, reason: "Human rejected action", stop: true };
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
        redacted: true, // sanitizer provenance: structural + visual redaction applied above
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

  // Terminal actions: the remote says the goal is complete, or gives up and
  // asks the human. Record, stop the loop, tell the chat. No executor run.
  if (agentAction.type === "done" || agentAction.type === "ask_human") {
    const stepRecord = {
      step: session.history.length + 1,
      url: pkg.browserState.url,
      action: agentAction,
      result: { ok: true },
      timestamp: Date.now(),
    };
    session.history.push(stepRecord);
    session.step = session.history.length;
    session.status = agentAction.type === "done" ? "done" : "waiting_human";
    broadcastHudStep(6, { actions: [], results: [] });
    notifySessionUpdate(session, gate);
    return { decision: gate.decision, reason: gate.reason, stop: true };
  }

  // CBA-5: navigate cannot run in the content-script executor (no chrome.tabs
  // access). Navigate the tab here, then loop to recapture the new page — the
  // gate runs again on the freshly loaded page, so a sensitive target
  // (e.g. IRCTC) is still Human/Block after load, never bypassed.
  if (agentAction.type === "navigate") {
    const result = await navigateTab(tabId, agentAction.url);
    const stepRecord = {
      step: session.history.length + 1,
      url: pkg.browserState.url,
      action: agentAction,
      result,
      timestamp: Date.now(),
    };
    session.history.push(stepRecord);
    session.step = session.history.length;
    broadcastHudStep(6, { actions: [], results: [result] });
    if (!result.ok) {
      // Failed navigation (e.g. load timeout): stop the session with the error
      // visible to chat instead of retrying the same navigate blindly.
      session.status = "error";
      session.error = result.error;
      notifySessionUpdate(session, gate);
      return { decision: gate.decision, reason: gate.reason, stop: true };
    }
    // Loop continues: next iteration recaptures the navigated page.
    notifySessionUpdate(session, gate);
    return { decision: gate.decision, reason: gate.reason };
  }

  // Convert the AgentAction contract into executor Actions (name/role/bbox
  // targets resolved against the sanitized elements; placeholder → real-value
  // swap happens HERE, on-device, from the local map — CONTRACT.md rule 2).
  const actions: Action[] = agentActionToExecutorActions(agentAction, sanitized, map);

  // Local Executor: apply the returned actions on the real page DOM.
  const results = await applyActions(tabId, actions);
  const stepRecord = {
    step: session.history.length + 1,
    url: pkg.browserState.url,
    action: agentAction,
    result: results[0] ?? { ok: true },
    timestamp: Date.now(),
  };
  session.history.push(stepRecord);
  session.step = session.history.length;
  broadcastHudStep(6, {
    actions,
    results,
  });

  // CBA-6: an executed click/type is NOT the end of the session (that was the
  // one-shot demo behaviour). Wait for any navigation it triggered to settle,
  // then loop and recapture the new page.
  notifySessionUpdate(session, gate);
  await waitForTabSettled(tabId);
  return { decision: gate.decision, reason: gate.reason, actions: results };
}
