// remote-agent/client-server.ts
// Privacy-first client: the extension NEVER holds LLM keys. It POSTs the
// sanitized package to the operator's Hono server (remote-agent/server.ts),
// which owns the API keys and picks the actual model brain.

import type { SanitizedPackage } from "../types/index.js";
import { type AgentAction, parseAgentAction } from "./types.js";
import type { ModelChoice, ModelSettings } from "../extension/src/settings/models.js";
import { assertSanitizedPackage } from "./router.js";

export interface ServerOptions {
  serverUrl?: string;
  /** Bearer token required by the server when AGENT_AUTH_TOKEN is configured. */
  authToken?: string;
  /** Model preference sent to the server; the server MAY ignore it. */
  model?: ModelChoice;
  fetchFn?: typeof fetch;
}

/**
 * Sends the sanitized package to the remote agent server and returns a
 * validated AgentAction. No API keys required on the client.
 */
export async function queryServer(
  pkg: SanitizedPackage,
  options?: ServerOptions
): Promise<AgentAction> {
  const serverUrl = (options?.serverUrl || "http://localhost:8080").replace(/\/+$/, "");
  const fetchClient = options?.fetchFn || (typeof fetch !== "undefined" ? fetch : null);

  if (!fetchClient) {
    throw new Error("No fetch implementation available for server client");
  }

  // Privacy check BEFORE anything crosses to the operator server. The server
  // re-checks (defense in depth), but a malformed/leaked package must never
  // leave the device.
  assertSanitizedPackage(pkg);

  const response = await fetchClient(`${serverUrl}/plan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options?.authToken
        ? { Authorization: `Bearer ${options.authToken}` }
        : {}),
    },
    body: JSON.stringify({
      goal: pkg.goal,
      sanitizedScreenshot: pkg.sanitizedScreenshot,
      sanitizedContext: pkg.sanitizedContext,
      redacted: pkg.redacted,
      // Preference only — the server decides with its own keys.
      model: options?.model,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    throw new Error(`Remote agent server error (${response.status}): ${errBody || response.statusText}`);
  }

  const data = (await response.json()) as {
    ok?: boolean;
    action?: unknown;
    error?: string;
  };

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
