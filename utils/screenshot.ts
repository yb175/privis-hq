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
// Chrome hard-throttles chrome.tabs.captureVisibleTab to ~2 calls/sec per
// extension (MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND). One serialized
// spacing point for ALL callers — retry loops, per-tab session loops, and
// HUD-triggered captures can never stack past the quota again.
// ponytail: single global chain; per-window chains if multi-window throughput matters.
const MIN_CAPTURE_SPACING_MS = 600;
let lastCaptureAt = 0;
let captureChain: Promise<unknown> = Promise.resolve();

async function captureSpaced(tabId: number): Promise<{ dataUrl: string }> {
  const wait = lastCaptureAt + MIN_CAPTURE_SPACING_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));

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
  } finally {
    // Space even failed captures so a quota-reject retry respects the limit.
    lastCaptureAt = Date.now();
  }
}

export function takeScreenshot(tabId: number): Promise<{ dataUrl: string }> {
  const run = () => captureSpaced(tabId);
  const result = captureChain.then(run);
  // Keep the chain alive even when a capture rejects.
  captureChain = result.catch(() => {});
  return result;
}
