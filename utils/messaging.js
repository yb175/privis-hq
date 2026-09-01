// utils/messaging.js — typed request/response between background and content.

// background -> content: sendToContent(tabId, { type: "capture" | "execute", ... })
async function sendToContent(tabId, message) {
  // TODO: chrome.tabs.sendMessage with promise wrapper
  return null;
}

// content -> background: sendToBackground(message)
function sendToBackground(message) {
  // TODO: chrome.runtime.sendMessage
  return null;
}

export { sendToContent, sendToBackground };
