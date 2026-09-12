// orchestrator/outbound.ts
// Outbound context construction and wire-exchange logging for the session loop.
//
// Everything the Remote Agent may see is assembled here:
// - stripLabels(): removes the user-controlled `label` (accessible label /
//   placeholder / title) so no raw value rides along in element metadata.
// - buildOutboundPackage(): the SanitizedPackage that crosses the wire —
//   goal, sanitized screenshot, sanitized context, and the REQUIRED
//   `redacted: true` provenance stamp (every outbound boundary refuses
//   packages without it).
// - buildOutboundPayload(): the popup's "what left the device" view.
// - logStepExchange(): one CBA-11 transparency entry per wire exchange
//   (success, refusal, or failure), digest-pinned.
//
// Privacy: this module must never receive raw element values. It consumes
// the Sanitizer's output (placeholders already applied).

import type {
  AgentAction,
  AgentSession,
  BrowserState,
  ElementMeta,
  GateRecord,
  RedactionManifest,
  SanitizedPackage,
  TransparencyEntry,
} from "../types/index.js";
import { computeRequestDigest, logTransparencyEntry } from "./transparency-log.js";
import type { ModelChoice } from "../shared/settings.js";

/**
 * Strips the user-controlled `label` (accessible label / placeholder / title)
 * from sanitized elements so no raw value survives in the remote context.
 * applyPlaceholders swaps only `text`; the label is the remaining field a
 * page author controls.
 */
export function stripLabels(elements: ElementMeta[]): ElementMeta[] {
  return elements.map((el) => ({ ...el, label: null }));
}

/**
 * Builds the SanitizedPackage that crosses the wire. `redacted: true` is the
 * sanitizer provenance stamp — structural + visual redaction applied before
 * this call. The router (assertSanitizedPackage) refuses packages without it.
 */
export function buildOutboundPackage(
  goal: string,
  elements: ElementMeta[],
  sanitizedScreenshot: string,
  browserState: BrowserState,
  redactionManifest?: RedactionManifest
): SanitizedPackage {
  const manifest = redactionManifest ?? {
    counts: {},
    redactedFraction: 0,
    overRedactedFraction: 0,
    policyVersion: "1.0",
    receipt: {
      algo: "SHA-256",
      hash: "",
      manifestHash: "",
      sealedAt: Date.now(),
    },
  };
  return {
    goal,
    sanitizedScreenshot,
    sanitizedContext: { elements: stripLabels(elements), browserState },
    redactionManifest: manifest,
    redacted: true,
  };
}

/**
 * Builds the popup's "what left the device" payload: sanitized screenshot,
 * tag/type/role/text of the remote elements, placeholder tokens, URL, model.
 */
export function buildOutboundPayload(
  sanitizedScreenshot: string,
  elements: ElementMeta[],
  url: string,
  model: ModelChoice
): NonNullable<AgentSession["outboundPayload"]> {
  return {
    sanitizedScreenshot,
    elements: elements.map(({ tag, type, role, text }) => ({ tag, type, role, text })),
    placeholders: elements
      .map((element) => element.text)
      .filter((text) => /^[A-Z]+_\d+$/.test(text)),
    url,
    model,
  };
}

/**
 * Logs one CBA-11 transparency entry for an outbound wire exchange:
 * success (response set), refusal (response null, gate reason as error), or
 * failure (response null, error set). The request is digest-pinned.
 */
export async function logStepExchange(params: {
  sessionId: string;
  tabIdHint: number;
  goal: string;
  step: number;
  model: string;
  request: SanitizedPackage;
  response: AgentAction | null;
  gate: GateRecord;
  error?: string;
}): Promise<void> {
  const { sessionId, tabIdHint, goal, step, model, request, response, gate, error } = params;
  const requestDigest = await computeRequestDigest(request);
  const entry: TransparencyEntry = {
    sessionId,
    tabIdHint,
    goal,
    step,
    timestamp: Date.now(),
    model,
    request,
    requestDigest,
    response,
    gate,
  };
  if (error !== undefined) entry.error = error;
  await logTransparencyEntry(entry);
}
