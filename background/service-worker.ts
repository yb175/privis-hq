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
export async function capturePackage(tabId: number): Promise<CapturePackage> {
  const [{ dataUrl }, dom] = await Promise.all([
    takeScreenshot(tabId),
    sendToContent<CaptureResponseMessage>(tabId, { type: "capture.request" }),
  ]);
  const { elements, browserState } = dom.payload;
  return {
    tabId,
    dataUrl,
    elements,
    detections: detectSensitive(elements),
    browserState,
  };
}

/**
 * Executes a full step of the privacy-preserving agent loop.
 * @param tabId Target tab ID
 * @param goal Human prompt or task instruction
 */
export async function runStep(tabId: number, goal: string): Promise<StepResult> {
  const pkg = await capturePackage(tabId);

  // Sanitizer: structural placeholders + in-memory visual redaction.
  const { sanitized } = applyPlaceholders(pkg.elements, pkg.detections);
  const sanitizedScreenshot = await redactVisual(
    pkg.dataUrl,
    pkg.detections,
    pkg.browserState.viewport
  );

  // Policy Gate: never call the remote unless the package is allowed out.
  const gate = decide({ detections: pkg.detections, browserState: pkg.browserState });
  if (gate.decision !== "allow") {
    return { decision: gate.decision, reason: gate.reason };
  }

  // Remote Agent: only the sanitized package crosses the wire — never the raw
  // dataUrl, never the element_id -> real value map.
  const actions: Action[] = await sendSanitized({
    goal,
    sanitizedScreenshot,
    sanitizedContext: { elements: sanitized, browserState: pkg.browserState },
  });

  // Local Executor: apply the returned actions on the real page DOM.
  const results = await applyActions(tabId, actions);
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

// Manual-test hook: { type: "privis.runStep", tabId, goal? } → StepResult.
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
