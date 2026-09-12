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
import {
  collectBrowserState,
  extractElements,
  resolveGeneratedElement,
} from "../utils/dom-extractor.js";
import { formatValue } from "../executor/format-value.js";
import { isPrivisMessage } from "../utils/messaging.js";
import { waitForPageSettle } from "./settle-watch.js";

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
  const generatedPrefix = "__privis_generated:";
  if (target.startsWith(generatedPrefix)) {
    return resolveGeneratedElement(target.slice(generatedPrefix.length));
  }

  const byId = document.getElementById(target);
  if (byId) return byId;

  let bySelector: HTMLElement | null = null;
  try {
    bySelector = document.querySelector<HTMLElement>(target);
  } catch {
    // Invalid CSS selector: fall through to the attribute lookup instead of throwing.
  }
  if (bySelector) return bySelector;

  return null;
}

// Stable per-category placeholder tokens produced by the Sanitizer (EMAIL_1,
// PAN_1, ...). Phase 01: extended to the new identifier classes (CARD, IFSC,
// GSTIN, UPI, ACCOUNT, DOB, PASSPORT, LICENCE) — kept in sync with
// SensitiveCategory in types/index.ts.
const PLACEHOLDER_RE =
  /^(EMAIL|PAN|AADHAAR|AMOUNT|PHONE|NAME|CARD|IFSC|GSTIN|UPI|ACCOUNT|DOB|PASSPORT|LICENCE)_\d+$/;

/**
 * Executes an action on the page DOM, substituting placeholders with real local values.
 * @param action The requested action (click, type, etc.)
 */
export function executeAction(action: Action): ActionResult {
  // Global scroll without target
  if (action.type === "scroll" && !action.target) {
    if (typeof window !== "undefined") {
      const dy = typeof (action as any).dy === "number" && Number.isFinite((action as any).dy) ? (action as any).dy : 300;
      window.scrollBy({ top: dy, left: 0, behavior: "smooth" });
      return { ok: true };
    }
    return { ok: false, error: "window unavailable for scroll" };
  }

  const el = resolveTarget(action.target ?? "");
  if (!el) return { ok: false, error: `Target not found: ${action.target ?? ""}` };

  switch (action.type) {
    case "click":
      // Scroll element into view before click if possible
      if (typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "center", inline: "nearest" });
      }
      el.click();
      return { ok: true };

    case "scroll":
      if (typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "center", inline: "nearest" });
        return { ok: true };
      }
      return { ok: false, error: "scrollIntoView unavailable on target" };

    case "select": {
      const val = action.value ?? "";
      if (el.tagName.toLowerCase() === "select") {
        const selectEl = el as HTMLSelectElement;
        let matched = false;
        for (let i = 0; i < selectEl.options.length; i++) {
          const opt = selectEl.options[i]!;
          if (opt.value === val || opt.text.trim().toLowerCase() === val.trim().toLowerCase()) {
            selectEl.selectedIndex = i;
            matched = true;
            break;
          }
        }
        if (!matched && selectEl.options.length > 0) {
          selectEl.value = val;
        }
        selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        selectEl.dispatchEvent(new Event("input", { bubbles: true }));
        return { ok: true };
      }
      return { ok: false, error: `Cannot select on non-select element: ${action.target}` };
    }

    case "type": {
      let value = action.value ?? "";
      if (PLACEHOLDER_RE.test(value)) {
        // Substitute the placeholder with the real value only when the Sanitizer
        // already stored one for this element; otherwise type what was sent.
        const elementId = el.id || el.dataset.privisId || "";
        // Own-property check so page ids like "constructor"/"toString" never
        // resolve to inherited Object.prototype members.
        if (Object.hasOwn(localValues, elementId)) {
          value = localValues[elementId];
        } else {
          return { ok: false, error: `Missing local value for placeholder: ${value}` };
        }
      }

      // Checkbox / Radio toggle
      if (el.tagName.toLowerCase() === "input") {
        const inputEl = el as HTMLInputElement;
        if (inputEl.type === "checkbox" || inputEl.type === "radio") {
          inputEl.checked = value !== "false" && value !== "0";
          inputEl.dispatchEvent(new Event("change", { bubbles: true }));
          inputEl.dispatchEvent(new Event("input", { bubbles: true }));
          return { ok: true };
        }
      }

      // Contenteditable elements
      if (el.hasAttribute("contenteditable") && el.getAttribute("contenteditable") !== "false") {
        el.textContent = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true };
      }

      if (!("value" in el)) {
        return { ok: false, error: `Cannot type into non-form element: ${action.target}` };
      }
      const field = el as HTMLInputElement | HTMLTextAreaElement;
      // Shape the value to what the FIELD will accept
      const shaped = formatValue(value, {
        inputType: (field as any).type,
        placeholder: (field as any).placeholder || undefined,
        title: field.title || undefined,
        pattern: field.getAttribute("pattern") || undefined,
        maxLength: (field as any).maxLength > 0 ? (field as any).maxLength : undefined,
      });
      field.value = shaped.text;
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
  if (typeof document !== "undefined" && (document.body || document.documentElement)) {
    try {
      await waitForPageSettle(document.body || document.documentElement, { quietMs: 50, timeoutMs: 500 });
    } catch {
      // ignore settle error
    }
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
