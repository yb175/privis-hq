// remote/client.ts
// Network gateway to remote agent model (only outbound network pathway).
//
// Responsibilities:
// - Sends ONLY sanitized screenshot and tokenized DOM context to remote server.
// - Returns planned actions array from remote agent.

import type { Action, SanitizedPackage } from "../types/index.js";

/**
 * Sends sanitized package to the remote planner endpoint.
 * Called strictly after Policy Gate grants "allow".
 * @param pkg Sanitized package containing tokens and redacted image
 */
export async function sendSanitized(pkg: SanitizedPackage): Promise<Action[]> {
  // TODO: Implement in chunks
  return [];
}
