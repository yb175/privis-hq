// executor/local-executor.js — pipeline step 6 (background side).
// The content script performs the real DOM actions (content/capture-content.js).

// applyActions(tabId, actions) — executes each gate-approved action in order.
async function applyActions(tabId, actions) {
  const results = [];
  for (const action of actions) {
    try {
      results.push(await sendToContent(tabId, { type: "execute", action }));
    } catch (e) {
      results.push({ ok: false, error: String(e) });
    }
  }
  return results;
}
