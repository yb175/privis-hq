// extension/src/settings/models.ts
// Configuration and persistence for CBA-2 Model Router settings (chatgpt vs Gemini)

export type ModelChoice = "chatgpt" | "gemini";

export interface ModelSettings {
  model: ModelChoice;
  /**
   * Privacy mode (default): the extension never holds LLM keys. It POSTs the
   * sanitized package to the operator's server, which owns the keys and picks
   * the actual brain (chatgpt/gemini). `model` above is sent as a preference
   * the server MAY honor.
   */
  serverUrl?: string;
  /** Bearer token for the operator server (sent as Authorization header). */
  agentAuthToken?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  geminiApiKey?: string;
  geminiBaseUrl?: string;
  geminiModel?: string;
}

export const STORAGE_KEY_MODEL_SETTINGS = "privis_model_settings";

/**
 * Non-secret defaults (always defined). API keys are NOT defaulted — they come
 * from chrome.storage / env only.
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
 * Loads model settings from chrome.storage.local (or env variables in Node/test environments).
 */
export async function loadModelSettings(): Promise<ModelSettings> {
  let stored: Partial<ModelSettings> | null = null;

  if (
    typeof chrome !== "undefined" &&
    chrome.storage &&
    typeof chrome.storage.local?.get === "function"
  ) {
    try {
      const res = await chrome.storage.local.get(STORAGE_KEY_MODEL_SETTINGS);
      if (res && res[STORAGE_KEY_MODEL_SETTINGS]) {
        stored = res[STORAGE_KEY_MODEL_SETTINGS] as Partial<ModelSettings>;
      }
    } catch {
      // Storage read error; fallback to defaults
    }
  }

  // Fallback to environment variables if available (e.g. Node CLI / testing environment)
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
 * Persists updated model settings to chrome.storage.local.
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
        [STORAGE_KEY_MODEL_SETTINGS]: merged,
      });
    } catch {
      // Persistence is optional (e.g. quota exceeded, MV3 shutdown) — routing
      // still works with the merged in-memory settings this call returns.
    }
  }

  return merged;
}
