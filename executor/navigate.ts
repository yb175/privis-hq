// executor/navigate.ts
// CBA-5: executes a gate-approved navigate action at the background level.
// The content-script executor has no chrome.tabs access and cannot change a
// tab's URL, so navigation runs here; runStep then recaptures the loop on the
// same (now navigated) tab.

import type { ActionResult } from "../types/index.js";

const ALLOWED_NAVIGATE_PROTOCOLS = ["http:", "https:"];

/**
 * True only for http(s) URLs. This is a trust-boundary check independent of
 * the remote-agent guard: the executor must never navigate to a scheme the
 * guard already rejected (javascript:, file:, data:, ...), even if some future
 * caller skips the guard.
 */
export function isAllowedNavigateUrl(url: string): boolean {
  try {
    return ALLOWED_NAVIGATE_PROTOCOLS.includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Navigates the given tab to `url` (same tab — the session is bound to that
 * tabId), waits for the page to finish loading, and returns the outcome.
 * ponytail: same-tab tabs.update only; the session always has a tabId, so a
 * tabs.create branch is dead code here. If a future "open in new tab" flow
 * needs it, re-bind the session to the new tabId.
 */
export async function navigateTab(tabId: number, url: string): Promise<ActionResult> {
  if (typeof chrome === "undefined" || !chrome.tabs?.update) {
    return { ok: false, error: "chrome.tabs.update is not available" };
  }
  if (!isAllowedNavigateUrl(url)) {
    return { ok: false, error: `Disallowed URL "${url}" — only http: and https: allowed` };
  }
  try {
    await chrome.tabs.update(tabId, { url });
    await waitForLoad(tabId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Polls until the tab reports status "complete". Times out instead of hanging
 * the agent loop on a page that never finishes loading.
 */
async function waitForLoad(tabId: number, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("navigate: timed out waiting for page load");
}
