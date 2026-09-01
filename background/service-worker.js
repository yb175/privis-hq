// background/service-worker.js — MV3 service worker. Owns the screenshot and
// the pipeline: capture -> sanitize -> policy gate -> remote -> executor.
// Screenshots stay in memory only. Nothing unsanitized ever leaves the device.

importScripts(
  "../utils/screenshot.js",
  "../utils/messaging.js",
  "../privacy/sanitizer/visual-redact.js",
  "../privacy/policy-gate/policy-gate.js",
  "../executor/local-executor.js",
  "../remote/client.js"
);

// Capture Layer (background half): screenshot + DOM package from the content script.
async function capturePackage(tabId) {
  const { dataUrl } = await takeScreenshot(tabId);
  const page = await sendToContent(tabId, { type: "capture" });
  return { tabId, dataUrl, ...page }; // page = { elements, detections, browserState }
}

// One form step. The DOM detection + placeholder swap already happened on the
// page (content script); the values map never left it.
async function runStep(tabId, goal) {
  const pkg = await capturePackage(tabId);

  const gate = decide(pkg);
  if (gate.decision !== "allow") {
    // human_approval: needs an approval prompt UI — blocked-safe until then.
    return gate;
  }

  const sanitizedScreenshot = await redactVisual(pkg.dataUrl, pkg.detections, pkg.browserState.viewport);
  const actions = await sendSanitized({
    goal,
    sanitizedScreenshot,
    sanitizedContext: { elements: pkg.elements, browserState: pkg.browserState },
  });

  const results = await applyActions(tabId, actions || []);
  return { decision: "allow", reason: gate.reason, actions: results };
}

chrome.action.onClicked.addListener((tab) => {
  runStep(tab.id, "fill the current form").then((r) => console.log("[PRIVIS step]", r));
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "run") runStep(sender.tab.id, msg.goal).then(sendResponse);
  return true;
});
