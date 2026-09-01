// PRIVIS background service worker (MV3).
// Owner: background. Screenshot + pipeline coordination live here.
// No DOM access. Screenshots stay in memory — never write to disk.

const { takeScreenshot } = await import(chrome.runtime.getURL("utils/screenshot.js"));
const { sendToContent } = await import(chrome.runtime.getURL("utils/messaging.js"));

// Capture Layer (background half): captureVisibleTab, memory only.
// Returns { dataUrl, browserState } — dataUrl lives in RAM for this step only.
async function capturePackage(tabId) {
  // TODO: chrome.tabs.captureVisibleTab + browser_state collection
  return { dataUrl: null, browserState: null };
}

// Pipeline coordinator: capture -> engine detections -> sanitizer -> policy gate
// -> remote agent -> executor. One form step per loop; capture again after actions.
async function runStep(tabId, goal) {
  // TODO: wire the pipeline end to end
  return { decision: null }; // "allow" | "human_approval" | "block"
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // TODO: dispatch goal / capture / execute messages
});

export { capturePackage, runStep };
