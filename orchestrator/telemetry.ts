export type TelemetryPhase = "capture" | "planner" | "execution" | "wait" | "verification" | "policy";

export interface StepTelemetry {
  correlationId: string;
  sessionId: string;
  step: number;
  phase: TelemetryPhase;
  outcome: "ok" | "failed" | "blocked" | "uncertain";
  code?: string;
  durationMs?: number;
  timestamp: number;
}

const KEY = "privis_step_telemetry_v1";
const MAX_ENTRIES = 500;

function id(): string {
  try { return crypto.randomUUID(); } catch { return `corr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
}

export async function recordStepTelemetry(input: Omit<StepTelemetry, "correlationId" | "timestamp"> & { correlationId?: string }): Promise<StepTelemetry> {
  const entry: StepTelemetry = { ...input, correlationId: input.correlationId ?? id(), timestamp: Date.now() };
  try {
    const storage = chrome.storage?.session ?? chrome.storage?.local;
    if (storage?.get && storage?.set) {
      const current = await storage.get(KEY);
      const entries = Array.isArray(current?.[KEY]) ? current[KEY] as StepTelemetry[] : [];
      entries.push(entry);
      await storage.set({ [KEY]: entries.slice(-MAX_ENTRIES) });
    }
  } catch {
    // Telemetry must never block or fail the browser action.
  }
  return entry;
}

export function newCorrelationId(): string { return id(); }
