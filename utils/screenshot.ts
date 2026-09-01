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
  // captureVisibleTab works on the active tab of a window; resolve the tab's window.
  let windowId: number | undefined;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active) {
      throw new Error(
        `takeScreenshot: tab ${tabId} is not the active tab in its window; captureVisibleTab would capture a different tab`,
      );
    }
    windowId = tab.windowId;
  } catch {
    throw new Error(`takeScreenshot: tab ${tabId} not found`);
  }

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
    if (!dataUrl) {
      throw new Error("takeScreenshot: captureVisibleTab returned empty data");
    }
    return { dataUrl };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`takeScreenshot: capture failed: ${detail}`);
  }
}
