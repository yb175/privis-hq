// utils/screenshot.ts
// Background-only screenshot helper
//
// Responsibilities:
// - Wraps chrome.tabs.captureVisibleTab into an in-memory PNG data URL.
// - Ensures raw screenshots are never written to disk or extension storage.

/**
 * Captures the visible tab into an in-memory PNG data URL.
 * @param tabId Target tab ID
 */
export async function takeScreenshot(tabId: number): Promise<{ dataUrl: string }> {
  // TODO: Implement in chunks
  throw new Error("Not implemented");
}
