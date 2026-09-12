// orchestrator/capture.ts
// Capture Layer orchestration for the session loop.
//
// capturePackage() is the single capture primitive: it snapshots the DOM
// package, takes the screenshot of that same state, and re-snapshots the DOM
// to prove the page did not change between the two — then runs the engine's
// DOM detection path (detectSensitive) on the frozen elements. Only after
// this succeeds does the step continue to vision fusion and sanitization.
//
// Privacy: everything here stays on-device. The dataUrl is the raw screenshot
// and never leaves the local boundary (see CONTRACT.md rules 1–3).

import type { CapturePackage, CaptureResponseMessage } from "../types/index.js";
import { takeScreenshot } from "../utils/screenshot.js";
import { sendToContent } from "../utils/messaging.js";
import { detectSensitive } from "../privacy/engine/detect-dom.js";

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

/**
 * Snapshot the content-script DOM package for a tab, then run DOM-path
 * detections (detectSensitive) on the elements.
 * @param tabId Target tab ID
 */
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

/**
 * Let a just-executed action land before the recapture: poll until the tab
 * reports status "complete" (a click on Submit navigates to page B). Bounded
 * and non-fatal — capturePackage's before/after fingerprint check is the real
 * guard against a mid-transition snapshot.
 */
export async function waitForTabSettled(tabId: number, timeoutMs = 5000): Promise<void> {
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
