// remote-agent/router.ts
// CBA-2 Model Router: Routes sanitized agent requests between chatgpt and Gemini

import type { SanitizedPackage } from "../types/index.js";
import { type AgentAction, PII_PATTERNS } from "./types.js";
import {
  type ModelSettings,
  loadModelSettings,
  normalizeModelSettings,
} from "../shared/settings.js";
import { queryOpenAI, type OpenAIOptions } from "./client-openai.js";
import { queryGemini, type GeminiOptions } from "./client-gemini.js";
import { guardAction } from "./guard.js";
import { assertSanitizedPackage } from "./assert.js";

// Re-exported for compatibility: the outbound boundary lives in assert.ts (a
// leaf module) so the provider clients can enforce it too, without an import
// cycle (router -> clients -> assert).
export { assertSanitizedPackage };

export interface RouterOptions {
  settings?: Partial<ModelSettings>;
  fetchFn?: typeof fetch;
}

/**
 * Verifies that a 'type' action's placeholder actually exists in the sanitized
 * context. Catches model-hallucinated tokens (e.g. "PAN_2" when only "PAN_1"
 * was sanitized) that pass the token-format regex but reference nothing real.
 */
function assertPlaceholderInContext(pkg: SanitizedPackage, action: AgentAction): void {
  if (action.type !== "type") return;
  const knownPlaceholders = new Set(
    pkg.sanitizedContext.elements.map((el) => el.text).filter(Boolean)
  );
  if (!knownPlaceholders.has(action.placeholder)) {
    throw new Error(
      `Refusing action: placeholder "${action.placeholder}" does not exist in sanitized context — model hallucination`
    );
  }
}

/**
 * Deterministic first hop: when the goal names a destination — an explicit
 * URL/domain or a known brand ("open uber") — navigate straight there without
 * spending an LLM call or asking the human for a link. Unknown brands still
 * fall through to the model (prompt rule 6 covers well-known services).
 * ponytail: fixed brand table; extend it when a demo brand matters, or add a
 * search/lookup action once guessing stops being enough.
 */
const URL_OR_DOMAIN_RE =
  /https?:\/\/[^\s"']+|\b[a-z](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.(?:com\.in|co\.in|com|in|org|net|io|dev|ai|app|edu|gov)(?:\/[^\s"']*)?/i;

const BRAND_URLS: Record<string, string> = {
  uber: "https://m.uber.com/go/home",
  ola: "https://book.ola.com/",
  flipkart: "https://www.flipkart.com/",
  amazon: "https://www.amazon.in/",
  myntra: "https://www.myntra.com/",
  irctc: "https://www.irctc.co.in/",
  gmail: "https://mail.google.com/",
  google: "https://www.google.com/",
  youtube: "https://www.youtube.com/",
};

function hostOverlap(a: string, b: string): boolean {
  return a === b || a.endsWith("." + b) || b.endsWith("." + a);
}

export function planQuickNavigate(
  goal: string,
  pageUrl: string
): { type: "navigate"; url: string } | null {
  let destination: string | null = null;
  const urlMatch = goal.match(URL_OR_DOMAIN_RE);
  if (urlMatch) {
    destination = urlMatch[0].startsWith("http") ? urlMatch[0] : `https://${urlMatch[0]}`;
  } else {
    const goalLower = goal.toLowerCase();
    for (const [brand, url] of Object.entries(BRAND_URLS)) {
      if (new RegExp(`\\b${brand}\\b`).test(goalLower)) {
        destination = url;
        break;
      }
    }
  }
  if (!destination) return null;

  let target: URL;
  let current: URL;
  try {
    target = new URL(destination);
    current = new URL(pageUrl);
  } catch {
    return null;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return null;
  // Already on that site (same host or sub/superdomain) — the page-level agent
  // loop must run, not re-navigate.
  if (hostOverlap(current.hostname, target.hostname)) return null;
  return { type: "navigate", url: destination };
}

/**
 * Execute a model search action server-side against SerpAPI and convert the
 * top organic hit into a navigate action. The extension never sees 'search':
 * only the resolved URL comes back, then the gate + sanitizer run against the
 * freshly loaded page like any other navigation. The SERPAPI_KEY lives here
 * (operator server), never in the browser.
 */
async function resolveSearchToNavigate(
  query: string,
  pkg: SanitizedPackage,
  fetchFn?: typeof fetch
): Promise<AgentAction> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) {
    return {
      type: "ask_human",
      reason: `Could not search for "${query}": SERPAPI_KEY not configured on the agent server`,
    };
  }
  const endpoint = new URL("https://serpapi.com/search.json");
  endpoint.searchParams.set("engine", "google");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("num", "5");
  endpoint.searchParams.set("api_key", apiKey);
  try {
    const res = await (fetchFn ?? fetch)(endpoint.toString(), {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return { type: "ask_human", reason: `Search for "${query}" failed (HTTP ${res.status})` };
    }
    const data = (await res.json()) as {
      organic_results?: { link?: unknown }[];
    };
    const link = (data.organic_results ?? [])
      .map((r) => r.link)
      .find((l): l is string => typeof l === "string" && /^https?:\/\//i.test(l));
    if (!link) {
      return { type: "ask_human", reason: `Search for "${query}" returned no usable result` };
    }
    // Third-party URL gets the same guard pass as a model-proposed navigate.
    const guardRes = guardAction({ type: "navigate", url: link }, { sanitizedPackage: pkg });
    return guardRes.ok ? guardRes.action : guardRes.fallbackAction;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { type: "ask_human", reason: `Search for "${query}" failed: ${msg}` };
  }
}

/**
 * Routes the sanitized package to the configured model brain ("chatgpt" OpenAI-compatible or "gemini").
 * Returns a validated AgentAction adhering to the CBA-1 schema.
 */
export async function routeAgentRequest(
  pkg: SanitizedPackage,
  options?: RouterOptions
): Promise<AgentAction> {
  // 1. Strict Privacy & Sanitization Boundary Check
  assertSanitizedPackage(pkg);

  // 1b. User told us where to go — go there; don't ask.
  const quickNav = planQuickNavigate(pkg.goal, pkg.sanitizedContext.browserState.url);
  if (quickNav) {
    const guardRes = guardAction(quickNav, { sanitizedPackage: pkg });
    if (guardRes.ok) return guardRes.action;
    // Guard rejected (e.g. PII in the URL): fall through to the model.
  }

  // 2. Resolve settings
  let settings: ModelSettings;
  if (options?.settings) {
    settings = normalizeModelSettings(options.settings);
  } else {
    settings = await loadModelSettings();
  }

  const fetchFn = options?.fetchFn;

  // 3. Dispatch to selected model client and guard output
  try {
    let action: AgentAction;
    if (settings.model === "gemini") {
      const geminiOpts: GeminiOptions = {
        apiKey: settings.geminiApiKey,
        baseUrl: settings.geminiBaseUrl,
        model: settings.geminiModel,
        fetchFn,
      };
      action = await queryGemini(pkg, geminiOpts);
    } else {
      // Default: "chatgpt" (OpenAI-compatible)
      const openAiOpts: OpenAIOptions = {
        apiKey: settings.openaiApiKey,
        baseUrl: settings.openaiBaseUrl,
        model: settings.openaiModel,
        fetchFn,
      };
      action = await queryOpenAI(pkg, openAiOpts);
    }

    const guardRes = guardAction(action, { sanitizedPackage: pkg });
    if (!guardRes.ok) {
      return guardRes.fallbackAction;
    }
    // 'search' is a server-side tool: resolve it to navigate before the wire
    // answer goes back, so the extension only ever executes page actions.
    if (guardRes.action.type === "search") {
      return resolveSearchToNavigate(guardRes.action.query, pkg, fetchFn);
    }
    return guardRes.action;
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    // If an unhandled remote error occurs, return ask_human action so the agent loop doesn't crash
    return {
      type: "ask_human",
      reason: `Remote model error (${settings.model}): ${errorMsg}`,
    };
  }
}
