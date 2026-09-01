// remote/client.js — the only network path. Sanitized package in, action plan out.

// sendSanitized({ goal, sanitizedScreenshot, sanitizedContext })
// Calls the remote reasoning server. Never called on a gate "block".
async function sendSanitized(pkg) {
  // TODO: fetch(serverUrl, { sanitized package }) -> action plan
  return null; // [{ type: "click" | "type", target, value? }]
}

export { sendSanitized };
