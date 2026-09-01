// background/service-worker.ts
// MV3 Service Worker orchestrating the end-to-end pipeline.
//
// Pipeline Flow:
// 1. Capture Layer: Tab screenshot (memory-only) + Content script DOM package.
// 2. Local Privacy Vision Engine (DOM path): detectSensitive on extracted elements.
// 3. Sanitizer: structural placeholders (applyPlaceholders) + pixel redaction (redactVisual).
// 4. Policy Gate: Evaluate risk (Allow / Human Approval / Block).
// 5. Remote Agent: Transmit sanitized package only (never called unless the gate allows).
// 6. Local Executor: Execute actions locally on DOM.

import type {
  Action,
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
import { sendSanitized } from "../remote/client.js";
import { applyActions } from "../executor/local-executor.js";

// Toolbar clicks carry no typed goal; run with the demo default.
const DEFAULT_GOAL = "Submit the employee portal form";

/**
 * Coordinates tab screenshot and DOM extraction from content script,
 * then fuses DOM detections (Local Privacy Vision Engine, DOM path).
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

// Helper to broadcast step updates to the popup HUD if open
function broadcastHudStep(step: number, detail: string) {
  try {
    chrome.runtime.sendMessage({ type: "hud.step", step, detail }).catch(() => {
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
  broadcastHudStep(1, `Capture Layer: Snapshotting tab ${tabId} and extracting DOM elements.`);
  const pkg = await capturePackage(tabId);
  broadcastHudStep(
    1,
    `Capture Layer: Extracted ${pkg.elements.length} DOM elements and in-memory screenshot.`
  );

  // Vision Engine Detections
  broadcastHudStep(
    2,
    `Local Privacy Vision Engine: Found ${pkg.detections.length} sensitive items (${pkg.detections.map((d) => d.category).join(", ")}).`
  );

  // Sanitizer: structural placeholders + in-memory visual redaction.
  const { sanitized } = applyPlaceholders(pkg.elements, pkg.detections);
  const sanitizedScreenshot = await redactVisual(
    pkg.dataUrl,
    pkg.detections,
    pkg.browserState.viewport
  );
  broadcastHudStep(
    3,
    `Sanitizer: Pixels redacted on canvas. Text values replaced with tokens (EMAIL_1, PAN_1, etc.).`
  );

  // Policy Gate: never call the remote unless the package is allowed out.
  const gate = decide({ detections: pkg.detections, browserState: pkg.browserState });
  broadcastHudStep(4, `Policy Gate: Decision is [${gate.decision.toUpperCase()}] — ${gate.reason}`);
  if (gate.decision !== "allow") {
    return { decision: gate.decision, reason: gate.reason };
  }

  // Remote Agent: only the sanitized package crosses the wire — never the raw
  // dataUrl, never the element_id -> real value map. applyPlaceholders swaps
  // only `text`, so strip the user-controlled `label` (accessible label /
  // placeholder / title) to keep any raw value out of the remote context.
  const remoteElements: ElementMeta[] = sanitized.map((el) => ({ ...el, label: null }));
  broadcastHudStep(5, `Remote Agent: Sending sanitized package with goal "${goal}"...`);
  const actions: Action[] = await sendSanitized({
    goal,
    sanitizedScreenshot,
    sanitizedContext: { elements: remoteElements, browserState: pkg.browserState },
  });
  broadcastHudStep(5, `Remote Agent: Received ${actions.length} action(s): ${JSON.stringify(actions)}`);

  // Local Executor: apply the returned actions on the real page DOM.
  broadcastHudStep(6, `Local Executor: Resolving and applying actions on real DOM.`);
  const results = await applyActions(tabId, actions);
  broadcastHudStep(
    6,
    `Local Executor: Action execution finished with status: ${results.map((r) => (r.ok ? "OK" : r.error)).join(", ")}`
  );

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
};
(globalThis as unknown as { privis: unknown }).privis = privisAPI;
if (typeof self !== "undefined") {
  (self as unknown as { privis: unknown }).privis = privisAPI;
}


// Plus the pre-existing { type: "PRIVIS_CAPTURE_SCREENSHOT", tabId } → { dataUrl }.
// Both are in-memory only.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
