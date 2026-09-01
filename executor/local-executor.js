// executor/local-executor.js — pipeline step 6. Coordinates with the content script,
// which performs the real DOM actions (see content/capture-content.js).

// applyActions(tabId, actions) — resolves targets, executes clicks/types, returns results.
// Real values for typing come from the on-device mapping table (gate-approved only).
async function applyActions(tabId, actions, mappingTable) {
  // TODO: sendToContent(tabId, { type: "execute", actions })
  return { ok: false };
}

export { applyActions };
