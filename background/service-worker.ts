// background/service-worker.ts
// MV3 Service Worker orchestrating the end-to-end pipeline.
//
// Pipeline Flow:
// 1. Capture Layer: Tab screenshot (memory-only) + Content script DOM package.
// 2. Policy Gate: Evaluate risk (Allow / Human Approval / Block).
// 3. Sanitizer: Redact screenshot pixels via OffscreenCanvas + swap structural DOM placeholders.
// 4. Remote Agent: Transmit sanitized package only.
// 5. Local Executor: Execute actions locally on DOM.

import type { CapturePackage, StepResult } from "../types/index.js";

/**
 * Coordinates tab screenshot and DOM extraction from content script.
 * @param tabId Target tab ID
 */
export async function capturePackage(tabId: number): Promise<CapturePackage> {
  // TODO: Implement in chunks
  throw new Error("Not implemented");
}

/**
 * Executes a full step of the privacy-preserving agent loop.
 * @param tabId Target tab ID
 * @param goal Human prompt or task instruction
 */
export async function runStep(tabId: number, goal: string): Promise<StepResult> {
  // TODO: Implement in chunks
  throw new Error("Not implemented");
}

// TODO: Extension click and message listener hooks
