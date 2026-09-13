import type { ActionResult, BrowserState, ElementMeta } from "../types/index.js";
import type { Target, VerificationCheck, VerificationSpec } from "../remote-agent/types.js";
import { sendToContent } from "../utils/messaging.js";

export type Snapshot = { browserState: BrowserState; elements: ElementMeta[] };

async function snapshot(tabId: number): Promise<Snapshot> {
  let frames: Array<{ frameId: number }> | undefined;
  try { frames = (await chrome.webNavigation?.getAllFrames?.({ tabId })) ?? undefined; } catch { frames = undefined; }
  const ids = frames?.map((f) => f.frameId).filter((id): id is number => typeof id === "number") ?? [0];
  const results = await Promise.allSettled(ids.map((frameId) =>
    sendToContent<{ type: "capture.response"; payload: { elements: ElementMeta[]; browserState: BrowserState; frameId?: number } }>(tabId, { type: "capture.request", frameId }, frameId)
  ));
  const packages = results
    .filter((r): r is PromiseFulfilledResult<{ type: "capture.response"; payload: { elements: ElementMeta[]; browserState: BrowserState; frameId?: number } }> => r.status === "fulfilled")
    .map((r) => r.value.payload);
  const primary = packages.find((p) => (p.frameId ?? 0) === 0);
  if (!primary) throw new Error("verification capture missing top frame");
  return { browserState: primary.browserState, elements: packages.flatMap((p) => p.elements) };
}

function targetMatches(element: ElementMeta, target: Target): boolean {
  if (target.ref) return element.element_id === target.ref.elementId && element.documentId === target.ref.documentId && (element.frameId ?? 0) === (target.ref.frameId ?? 0);
  if (target.role && element.role !== target.role) return false;
  if (target.name && !(element.label === target.name || element.text === target.name)) return false;
  if (target.bbox) {
    const [x, y, w, h] = target.bbox;
    const [ex, ey, ew, eh] = element.bbox;
    if (x + w < ex || ex + ew < x || y + h < ey || ey + eh < y) return false;
  }
  return Boolean(target.role || target.name || target.bbox);
}

function textPresent(elements: ElementMeta[], needle: string): boolean {
  const q = needle.toLocaleLowerCase();
  return elements.some((e) => `${e.text} ${e.label ?? ""}`.toLocaleLowerCase().includes(q));
}

function count(elements: ElementMeta[], role?: string, name?: string): number {
  return elements.filter((e) => (!role || e.role === role) && (!name || e.label === name || e.text === name)).length;
}

function evaluate(check: VerificationCheck, before: Snapshot, after: Snapshot): { ok: boolean; evidence: string } {
  switch (check.type) {
    case "text_appeared": {
      const ok = !textPresent(before.elements, check.needle) && textPresent(after.elements, check.needle);
      return { ok, evidence: ok ? `text appeared: ${check.needle}` : `text did not appear: ${check.needle}` };
    }
    case "text_disappeared": {
      const ok = textPresent(before.elements, check.needle) && !textPresent(after.elements, check.needle);
      return { ok, evidence: ok ? `text disappeared: ${check.needle}` : `text did not disappear: ${check.needle}` };
    }
    case "element_appeared": {
      const ok = !before.elements.some((e) => targetMatches(e, check.target)) && after.elements.some((e) => targetMatches(e, check.target));
      return { ok, evidence: ok ? "element appeared" : "element did not appear" };
    }
    case "element_disappeared": {
      const ok = before.elements.some((e) => targetMatches(e, check.target)) && !after.elements.some((e) => targetMatches(e, check.target));
      return { ok, evidence: ok ? "element disappeared" : "element did not disappear" };
    }
    case "url_matches": {
      const parts = check.urlPattern.split("*");
      let cursor = 0;
      const ok = parts.every((part) => {
        const index = after.browserState.url.indexOf(part, cursor);
        if (index < 0) return false;
        cursor = index + part.length;
        return true;
      });
      return { ok, evidence: ok ? "URL matched" : "URL did not match" };
    }
    case "state_changed": {
      const b = before.elements.find((e) => targetMatches(e, check.target));
      const a = after.elements.find((e) => targetMatches(e, check.target));
      const ok = b !== undefined && a !== undefined && b[check.attribute] !== a[check.attribute];
      return { ok, evidence: ok ? `${check.attribute} changed` : `${check.attribute} did not change` };
    }
    case "count_changed": {
      const delta = count(after.elements, check.role, check.name) - count(before.elements, check.role, check.name);
      const ok = delta !== 0 && (check.delta === undefined || delta === check.delta);
      return { ok, evidence: ok ? `count changed by ${delta}` : `count changed by ${delta}, expected ${check.delta ?? "non-zero"}` };
    }
  }
}

export async function verifyPostcondition(
  tabId: number,
  before: Snapshot,
  verification: VerificationSpec,
): Promise<ActionResult> {
  const deadline = Date.now() + (verification.timeoutMs ?? 5000);
  let lastEvidence: string[] = [];
  while (Date.now() <= deadline) {
    try {
      const after = await snapshot(tabId);
      const checks = verification.checks.map((check) => evaluate(check, before, after));
      lastEvidence = checks.map((check) => check.evidence);
      const ok = verification.mode === "any" ? checks.some((check) => check.ok) : checks.every((check) => check.ok);
      if (ok) return { ok: true, detail: JSON.stringify(lastEvidence) };
    } catch (error) {
      lastEvidence = [error instanceof Error ? error.message : String(error)];
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return { ok: false, code: "TIMEOUT", error: "Verification did not pass before timeout", detail: JSON.stringify(lastEvidence) };
}
