// PRIVIS content script. Owner: content only — DOM reads and DOM actions.
// Never takes screenshots; never sends raw PII values upstream.

// Capture Layer (content half): read DOM, a11y, visible text, labels, bounding boxes.
// Returns elements as { element_id, tag, role, label, text?, bbox: [x,y,w,h] }.
// Sensitive VALUES stay on the page; only metadata + box coordinates go up.
async function extractPageState() {
  // TODO: use utils/dom-extractor.js
  return { elements: [], browserState: null };
}

// Local Executor: resolve a target from the sanitized context, click or type on the real page.
// Typing real values uses the on-device mapping table — never a placeholder string.
async function executeAction(action) {
  // TODO: { type: "click" | "type", target, value? }
  return { ok: false };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // TODO: handle "capture" and "execute" messages
});
