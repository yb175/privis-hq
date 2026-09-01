// remote/client.js — the only network path. Sanitized package in, action plan out.

// ponytail: hardcoded loopback URL — move to options page when a real server exists.
const SERVER_URL = "http://localhost:8787/plan";

// sendSanitized({ goal, sanitizedScreenshot, sanitizedContext }) -> [{ type, target, value? }]
// Called only after a Policy Gate "allow" (caller enforces this).
async function sendSanitized(pkg) {
  const res = await fetch(SERVER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pkg),
  });
  if (!res.ok) throw new Error(`remote agent: ${res.status}`);
  return res.json();
}
