// utils/screenshot.js — background-only helper.
// Wraps chrome.tabs.captureVisibleTab. Data URL lives in memory only.

// Returns { dataUrl, width, height } or throws.
async function takeScreenshot(tabId) {
  // TODO: chrome.tabs.captureVisibleTab(windowId, { format: "png" })
  return { dataUrl: null, width: 0, height: 0 };
}

export { takeScreenshot };
