// content/capture-content.js — content script. DOM reads + Local Executor half.
// Raw PII values NEVER leave this page context: they are swapped for
// placeholders before anything is sent to the background, and the map used
// for typing real values stays right here.

// localValues: { element_id: real value } — on-device, session-stable.
let localValues = {};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "capture") {
    const elements = extractElements();
    const detections = detectSensitive(elements);
    const { sanitized, map } = applyPlaceholders(elements, detections);
    localValues = map;
    // Only placeholders + metadata + boxes leave the page.
    sendResponse({ elements: sanitized, detections, browserState: collectBrowserState() });
  } else if (msg?.type === "execute") {
    executeAction(msg.action).then(sendResponse);
  }
  return true; // async response
});

// Local Executor: resolve target, click or type. Typing resolves the
// placeholder back to the real value from localValues — never types "PAN_1".
async function executeAction(action) {
  const el = resolveTarget(action.target);
  if (!el) return { ok: false, error: "target not found" };
  if (action.type === "click") {
    el.click();
    return { ok: true };
  }
  if (action.type === "type") {
    const real = localValues[action.target] || action.value;
    el.focus();
    el.value = real;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true };
  }
  return { ok: false, error: `unknown action type: ${action.type}` };
}

// target is an element_id ("e3"), a DOM id, or a CSS selector.
function resolveTarget(target) {
  return document.getElementById(target) || document.querySelector(target);
}
