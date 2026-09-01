// content/capture-content.js -> content/capture-content.ts
// Content Script (Page Context)
//
// Responsibilities:
// - Extracts visible DOM elements, metadata, and bounding boxes.
// - Detects sensitive fields and swaps them with stable placeholders (e.g., PAN_1, EMAIL_1).
// - Holds local mapping { element_id: real_value } strictly in memory.
// - Executes real DOM actions (clicks, keyboard input) on behalf of local executor.

import type {
  Action,
  ActionResult,
  BrowserState,
  CaptureRequestMessage,
  ElementMeta,
  ExecuteRequestMessage,
  ExecuteResponseMessage,
} from "../types/index.js";
import { collectBrowserState, extractElements } from "../utils/dom-extractor.js";
import { isPrivisMessage } from "../utils/messaging.js";

/**
 * Capture Layer content-script half: visible elements + browser state.
 * No placeholders, no clicks — those live elsewhere (Sanitizer / Local Executor).
 */
export function captureDom(): { elements: ElementMeta[]; browserState: BrowserState } {
  return { elements: extractElements(), browserState: collectBrowserState() };
}

// In-memory real value store for placeholder resolution (never sent upstream).
// The Sanitizer writes element_id -> real value; this executor only reads it.
const localValues: Record<string, string> = {};

/**
 * Resolves a target selector or element id to a live DOM element.
 * @param target Element ID or CSS selector
 */
export function resolveTarget(target: string): HTMLElement | null {
  const byId = document.getElementById(target);
  if (byId) return byId;

  let bySelector: HTMLElement | null = null;
  try {
    bySelector = document.querySelector<HTMLElement>(target);
  } catch {
    // Invalid CSS selector: fall through to the attribute lookup instead of throwing.
  }
  if (bySelector) return bySelector;

  // data-privis-id carries the element_id (DOM id, or the generated id for
  // id-less controls once the Sanitizer exposes it). Unknown values simply
  // don't match; no selector parsing, so no escaping concerns.
  for (const el of document.querySelectorAll<HTMLElement>("[data-privis-id]")) {
    if (el.getAttribute("data-privis-id") === target) return el;
  }
  return null;
}

// Stable per-category placeholder tokens produced by the Sanitizer (EMAIL_1, PAN_1, ...).
const PLACEHOLDER_RE = /^(EMAIL|PAN|AADHAAR|AMOUNT|PHONE|NAME)_\d+$/;

/**
 * Executes an action on the page DOM, substituting placeholders with real local values.
 * @param action The requested action (click, type, etc.)
 */
export async function executeAction(action: Action): Promise<ActionResult> {
  const el = resolveTarget(action.target);
  if (!el) return { ok: false, error: `Target not found: ${action.target}` };

  switch (action.type) {
    case "click":
      el.click();
      return { ok: true };

    case "type": {
      let value = action.value ?? "";
      if (PLACEHOLDER_RE.test(value)) {
        // Substitute the placeholder with the real value only when the Sanitizer
        // already stored one for this element; otherwise type what was sent.
        const elementId = el.id || el.dataset.privisId || "";
        // Own-property check so page ids like "constructor"/"toString" never
        // resolve to inherited Object.prototype members.
        if (Object.hasOwn(localValues, elementId)) value = localValues[elementId];
      }
      if (!("value" in el)) {
        return { ok: false, error: `Cannot type into non-form element: ${action.target}` };
      }
      const field = el as HTMLInputElement;
      field.value = value;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true };
    }

    default:
      return { ok: false, error: `Unsupported action type: ${action.type}` };
  }
}

function isExecuteRequest(message: unknown): message is ExecuteRequestMessage {
  // Reuse the shared validator: rejects malformed execute messages (missing
  // payload, non-array/malformed actions) before payload.actions is touched.
  return isPrivisMessage(message) && message.type === "execute.request";
}

function isCaptureRequest(message: unknown): message is CaptureRequestMessage {
  return isPrivisMessage(message) && message.type === "capture.request";
}

// Capture channel for the Capture Layer: returns the DOM package (elements +
// browser state) to the background on request. Wired by the orchestrator (#15);
// the background half lives in background/service-worker.ts.
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isCaptureRequest(message)) return false;
  sendResponse({ type: "capture.response", payload: captureDom() });
  return false;
});

async function executeActions(actions: Action[]): Promise<ExecuteResponseMessage> {
  const results: ActionResult[] = [];
  for (const action of actions) {
    const result = await executeAction(action);
    results.push(result);
    if (!result.ok) break; // stop on first failure
  }
  return { type: "execute.response", payload: { results } };
}

// Execute channel for the Local Executor: applies gate-approved actions to the
// real page DOM and replies with per-action results (stops on first failure).
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isExecuteRequest(message)) return false;
  void executeActions(message.payload.actions).then(sendResponse);
  return true; // keep the channel open for the async response
});
