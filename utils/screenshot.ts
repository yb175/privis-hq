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
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    throw new Error(`takeScreenshot: tab ${tabId} not found`);
  }

  if (!tab.active) {
    // If not active, activate it so captureVisibleTab can capture it
    try {
      await chrome.tabs.update(tabId, { active: true });
      await new Promise((r) => setTimeout(r, 80));
    } catch {
      // Ignore if cannot update tab
    }
  }
  const windowId = tab.windowId;

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
