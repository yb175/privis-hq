// content/capture-content.js -> content/capture-content.ts
// Content Script (Page Context)
//
// Responsibilities:
// - Extracts visible DOM elements, metadata, and bounding boxes.
// - Detects sensitive fields and swaps them with stable placeholders (e.g., PAN_1, EMAIL_1).
// - Holds local mapping { element_id: real_value } strictly in memory.
// - Executes real DOM actions (clicks, keyboard input) on behalf of local executor.

import type { Action, ActionResult, BrowserState, ElementMeta } from "../types/index.js";
import { collectBrowserState, extractElements } from "../utils/dom-extractor.js";

/**
 * Capture Layer content-script half: visible elements + browser state.
 * No placeholders, no clicks — those live elsewhere (Sanitizer / Local Executor).
 */
export function captureDom(): { elements: ElementMeta[]; browserState: BrowserState } {
  return { elements: extractElements(), browserState: collectBrowserState() };
}

// In-memory real value store for placeholder resolution (never sent upstream)
// let localValues: Record<string, string> = {};

/**
 * Resolves a target selector or element id to a live DOM element.
 * @param target Element ID or CSS selector
 */
export function resolveTarget(target: string): HTMLElement | null {
  // TODO: Implement in chunks
  return null;
}

/**
 * Executes an action on the page DOM, substituting placeholders with real local values.
 * @param action The requested action (click, type, etc.)
 */
export async function executeAction(action: Action): Promise<ActionResult> {
  // TODO: Implement in chunks
  throw new Error("Not implemented");
}

// TODO: chrome.runtime.onMessage listener for "capture" and "execute"
