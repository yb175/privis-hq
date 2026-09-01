// utils/messaging.js — typed request/response between background and content.

// background -> content
function sendToContent(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

// content -> background
function sendToBackground(message) {
  return chrome.runtime.sendMessage(message);
}
