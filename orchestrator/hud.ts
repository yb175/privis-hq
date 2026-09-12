// orchestrator/hud.ts
// Live step feed for the extension popup HUD.
//
// broadcastHudStep() records each pipeline stage (capture, detection,
// sanitization, gate, remote, execution) as a rich step record and best-effort
// forwards it to the popup via chrome.runtime.sendMessage. The popup being
// closed is normal and ignored.
//
// Privacy: step records carry sanitized data only (sanitized screenshot,
// placeholder swaps, decisions) — never raw values or the mapping table.

// In-memory step cache for the HUD
const lastLiveSteps: Array<Record<string, unknown>> = [];

export function getLiveSteps(): Array<Record<string, unknown>> {
  return lastLiveSteps;
}

// Helper to broadcast step updates with rich data to the popup HUD
export function broadcastHudStep(step: number, data: Record<string, unknown>) {
  const payload = { type: "hud.liveStep", step, ...data };
  if (step === 1) lastLiveSteps.length = 0;
  lastLiveSteps.push(payload);
  try {
    // HUD popup might be closed; safe to ignore.
    void chrome.runtime.sendMessage(payload).catch(() => {});
  } catch {
    // Ignore if no receiver
  }
}
