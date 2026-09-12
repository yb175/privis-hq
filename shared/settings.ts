// shared/settings.ts
// Configuration and persistence for CBA-8 Settings (server URL + model toggle).
// Moved out of extension/src/settings so core subsystems (remote-agent server,
// orchestrator) depend on a neutral module instead of extension UI code. The
// extension still owns persistence (chrome.storage.local); every chrome.* access
// here is guarded, so the Node-side server can import it unchanged.
//
// Privacy boundary: the extension persists ONLY non-provider-key settings —
// model preference, operator server URL, and optional server auth token.
// Provider API keys (OpenAI/Gemini) live server-side in the operator's .env
// and are never accepted from, persisted by, or sent from the extension.

export type ModelChoice = "chatgpt" | "gemini";

/**
 * Settings the extension may hold and persist in chrome.storage.local.
 * Provider API keys are deliberately absent — they stay on the operator server.
 */
export interface ClientSettings {
  model: ModelChoice;
  serverUrl?: string;
  /** Bearer token for the operator server (sent as Authorization header). */
  agentAuthToken?: string;
}

/**
 * Full settings shape used by the operator server (remote-agent). Provider keys
 * exist ONLY here, sourced from the server's environment — never from
 * chrome.storage or the extension.
 */
export interface ModelSettings extends ClientSettings {
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  geminiApiKey?: string;
  geminiBaseUrl?: string;
  geminiModel?: string;
}

export const STORAGE_KEY_MODEL_SETTINGS = "privis_model_settings";

/**
 * The only fields the extension is allowed to persist. Provider keys excluded.
 */
export function toClientSettings(settings: ModelSettings): ClientSettings {
  return {
    model: settings.model,
    serverUrl: settings.serverUrl,
    agentAuthToken: settings.agentAuthToken,
  };
}

/**
 * Non-secret defaults (always defined). API keys are NOT defaulted — they come
 * from the server's env only.
 */
export const DEFAULT_MODEL_SETTINGS: Required<
  Omit<ModelSettings, "openaiApiKey" | "geminiApiKey" | "agentAuthToken">
> = {
  model: "chatgpt",
  serverUrl: "http://localhost:3201",
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "gpt-4o-mini",
  geminiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
  geminiModel: "gemini-3.5-flash-lite-preview",
};

/**
 * Validates and merges partial settings with defaults.
 * Every field is type-checked before use — a corrupted storage blob (non-string
 * values) must never break loading or routing.
 */
export function normalizeModelSettings(settings?: Partial<ModelSettings> | null): ModelSettings {
  const model: ModelChoice = settings?.model === "gemini" ? "gemini" : "chatgpt";
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
  const stripSlash = (s: string) => s.replace(/\/+$/, "");
  const storedUrl = str(settings?.serverUrl);
  // Migration: builds before the port alignment persisted the old default
  // (8080) into chrome.storage; the agent server listens on 3201, so treat
  // that stale value as unset instead of letting it strand the client.
  const LEGACY_DEFAULT = "http://localhost:8080";
  const serverUrl =
    storedUrl && stripSlash(storedUrl) !== LEGACY_DEFAULT
      ? storedUrl
      : DEFAULT_MODEL_SETTINGS.serverUrl;

  return {
    model,
    serverUrl,
    agentAuthToken: str(settings?.agentAuthToken),
    openaiApiKey: str(settings?.openaiApiKey),
    openaiBaseUrl: str(settings?.openaiBaseUrl) || DEFAULT_MODEL_SETTINGS.openaiBaseUrl,
    openaiModel: str(settings?.openaiModel) || DEFAULT_MODEL_SETTINGS.openaiModel,
    geminiApiKey: str(settings?.geminiApiKey),
    geminiBaseUrl: str(settings?.geminiBaseUrl) || DEFAULT_MODEL_SETTINGS.geminiBaseUrl,
    geminiModel: str(settings?.geminiModel) || DEFAULT_MODEL_SETTINGS.geminiModel,
  };
}

/**
 * Loads settings. In the extension this reads ONLY client fields from
 * chrome.storage.local (provider keys are dropped even if a stale blob carries
 * them). On the server (no chrome) provider keys come from environment variables.
 */
export async function loadModelSettings(): Promise<ModelSettings> {
  let stored: ClientSettings | null = null;

  if (
    typeof chrome !== "undefined" &&
    chrome.storage &&
    typeof chrome.storage.local?.get === "function"
  ) {
    try {
      const res = await chrome.storage.local.get(STORAGE_KEY_MODEL_SETTINGS);
      if (res && res[STORAGE_KEY_MODEL_SETTINGS]) {
        // Strip provider keys: the extension never reads keys back from storage.
        stored = toClientSettings(
          normalizeModelSettings(res[STORAGE_KEY_MODEL_SETTINGS] as Partial<ModelSettings>)
        );
      }
    } catch {
      // Storage read error; fallback to defaults
    }
  }

  // Server-side: provider keys come from environment variables (Node).
  const envSettings: Partial<ModelSettings> = {};
  if (typeof process !== "undefined" && process.env) {
    if (process.env.PRIVIS_MODEL === "gemini" || process.env.PRIVIS_MODEL === "chatgpt") {
      envSettings.model = process.env.PRIVIS_MODEL;
    }
    if (process.env.OPENAI_API_KEY) {
      envSettings.openaiApiKey = process.env.OPENAI_API_KEY;
    }
    if (process.env.OPENAI_BASE_URL) {
      envSettings.openaiBaseUrl = process.env.OPENAI_BASE_URL;
    }
    if (process.env.OPENAI_MODEL) {
      envSettings.openaiModel = process.env.OPENAI_MODEL;
    }
    if (process.env.GEMINI_API_KEY) {
      envSettings.geminiApiKey = process.env.GEMINI_API_KEY;
    }
    if (process.env.GEMINI_BASE_URL) {
      envSettings.geminiBaseUrl = process.env.GEMINI_BASE_URL;
    }
    if (process.env.GEMINI_MODEL) {
      envSettings.geminiModel = process.env.GEMINI_MODEL;
    }
  }

  return normalizeModelSettings({
    ...envSettings,
    ...(stored || {}),
  });
}

/**
 * Persists updated settings. Only client fields (model, serverUrl,
 * agentAuthToken) are written to chrome.storage.local — provider API keys are
 * never persisted, even if a caller passes them.
 */
export async function saveModelSettings(
  updates: Partial<ModelSettings>
): Promise<ModelSettings> {
  const current = await loadModelSettings();
  const merged = normalizeModelSettings({ ...current, ...updates });

  if (
    typeof chrome !== "undefined" &&
    chrome.storage &&
    typeof chrome.storage.local?.set === "function"
  ) {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEY_MODEL_SETTINGS]: toClientSettings(merged),
      });
    } catch {
      // Persistence is optional (e.g. quota exceeded, MV3 shutdown) — routing
      // still works with the merged in-memory settings this call returns.
    }
  }

  return merged;
}
