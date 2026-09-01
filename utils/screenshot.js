// utils/screenshot.js — background-only helper.
// Wraps chrome.tabs.captureVisibleTab. Data URL lives in memory only.

// Returns { dataUrl } — caller owns it; never written to disk.
async function takeScreenshot(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  return { dataUrl };
}
