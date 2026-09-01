// utils/dom-extractor.ts
// Content-script DOM metadata extraction helper
//
// Responsibilities:
// - Finds visible interactive elements, labels, and bounding boxes.
// - Collects high-level page and viewport dimensions.

import type { BrowserState, ElementMeta } from "../types/index.js";

/**
 * Finds accessible label or placeholder associated with an element.
 * @param el DOM element
 */
export function labelFor(el: HTMLElement): string | null {
  // TODO: Implement in chunks
  return null;
}

/**
 * Extracts visible interactive elements, media, and form controls.
 */
export function extractElements(): ElementMeta[] {
  // TODO: Implement in chunks
  return [];
}

/**
 * Collects high-level page metadata and viewport dimensions.
 */
export function collectBrowserState(): BrowserState {
  // TODO: Implement in chunks
  return {
    url: "",
    title: "",
    viewport: { w: 0, h: 0 },
  };
}
