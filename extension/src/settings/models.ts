// extension/src/settings/models.ts
// Configuration and persistence for CBA-2 Model Router settings (cheap GPT vs Gemini)

export type ModelChoice = "cheap" | "gemini";

export interface ModelSettings {
  model: ModelChoice;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  geminiApiKey?: string;
  geminiBaseUrl?: string;
  geminiModel?: string;
}

export const STORAGE_KEY_MODEL_SETTINGS = "privis_model_settings";

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  model: "cheap",
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiModel: "gpt-4o-mini",
  geminiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
  geminiModel: "gemini-1.5-flash",
};

/**
 * Validates and merges partial settings with defaults.
 */
export function normalizeModelSettings(settings?: Partial<ModelSettings> | null): ModelSettings {
  const model: ModelChoice = settings?.model === "gemini" ? "gemini" : "cheap";

  return {
    model,
    openaiApiKey: settings?.openaiApiKey?.trim() || undefined,
    openaiBaseUrl: settings?.openaiBaseUrl?.trim() || DEFAULT_MODEL_SETTINGS.openaiBaseUrl,
    openaiModel: settings?.openaiModel?.trim() || DEFAULT_MODEL_SETTINGS.openaiModel,
    geminiApiKey: settings?.geminiApiKey?.trim() || undefined,
    geminiBaseUrl: settings?.geminiBaseUrl?.trim() || DEFAULT_MODEL_SETTINGS.geminiBaseUrl,
    geminiModel: settings?.geminiModel?.trim() || DEFAULT_MODEL_SETTINGS.geminiModel,
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
    if (process.env.PRIVIS_MODEL === "gemini" || process.env.PRIVIS_MODEL === "cheap") {
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
    await chrome.storage.local.set({
      [STORAGE_KEY_MODEL_SETTINGS]: merged,
    });
  }

  return merged;
}
