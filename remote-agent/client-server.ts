// remote-agent/client-server.ts
// Privacy-first client: the extension NEVER holds LLM keys. It POSTs the
// sanitized package to the operator's Hono server (remote-agent/server.ts),
// which owns the API keys and picks the actual model brain.

import type { RedactionManifest, SanitizedPackage } from "../types/index.js";
import { type AgentAction, parseAgentAction } from "./types.js";
import type { ModelChoice, ModelSettings } from "../shared/settings.js";
import { assertSanitizedPackage } from "./router.js";
import { verifyReceipt } from "./receipt.js";

/** Transport budget: a hung operator server must not hang the session. */
const REQUEST_TIMEOUT_MS = 30_000;

export interface ServerOptions {
  serverUrl?: string;
  /** Bearer token required by the server when AGENT_AUTH_TOKEN is configured. */
  authToken?: string;
  /** Model preference sent to the server; the server MAY ignore it. */
  model?: ModelChoice;
  fetchFn?: typeof fetch;
}

import { securePostJson } from "./transport.js";

/**
 * Sends the sanitized package to the remote agent server and returns a
 * validated AgentAction. No API keys required on the client.
 */
export async function queryServer(
  pkg: SanitizedPackage,
  options?: ServerOptions
): Promise<AgentAction> {
  const configured = options?.serverUrl;
  if (typeof configured === "string" && configured.trim() === "") {
    throw new Error(
      "No agent server configured — open PRIVIS Settings, set the Server URL, then start it with `npm run serve:agent`."
    );
  }
  const serverUrl = (configured || "http://localhost:3201").replace(/\/+$/, "");

  const headers: Record<string, string> = {
    ...(options?.authToken ? { Authorization: `Bearer ${options.authToken}` } : {}),
  };

  const outboundPkg: SanitizedPackage = {
    ...pkg,
    ...(options?.model ? { model: options.model } as any : {}),
  };

  const resp = await securePostJson<{ ok?: boolean; action?: unknown; error?: string }>(
    `${serverUrl}/plan`,
    outboundPkg,
    headers,
    {
      timeoutMs: REQUEST_TIMEOUT_MS,
      fetchFn: options?.fetchFn,
    }
  );

  if (!resp.ok || !resp.data) {
    throw new Error(resp.error || `Remote agent server error (${resp.status})`);
  }

  const data = resp.data;
  if (!data.ok || data.action === undefined) {
    throw new Error(data.error || "Remote agent server returned no action");
  }

  // Validate server response against the same AgentAction schema + PII guard
  return parseAgentAction(data.action);
}

/**
 * Convenience wrapper resolving server URL + model preference from settings.
 */
export function serverOptionsFromSettings(settings: ModelSettings): ServerOptions {
  return {
    serverUrl: settings.serverUrl,
    authToken: settings.agentAuthToken,
    model: settings.model,
  };
}
