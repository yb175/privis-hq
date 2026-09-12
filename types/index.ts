// types/index.ts
// Shared type definitions across all PRIVIS modules

export type SensitiveCategory =
  | "EMAIL"
  | "PAN"
  | "AADHAAR"
  | "AMOUNT"
  | "PHONE"
  | "NAME"
  | "FACE"
  | "PASSWORD"
  // Phase 01 (SIH26171-approved lexical layer): checksum-backed identifier
  // classes. Every one flows through privacy/engine/validators.ts before it
  // becomes a Detection — a regex match alone never mints these categories.
  | "CARD"
  | "IFSC"
  | "GSTIN"
  | "UPI"
  | "ACCOUNT"
  | "DOB"
  | "PASSPORT"
  | "LICENCE";

/**
 * Provenance of a finding. "dom": Capture Layer DOM rules; "vision":
 * on-device model (face, later visual detectors); "ocr": reserved seam for
 * the document pipeline (no detector emits it yet). The set is closed —
 * normalizeDetections() rejects anything else.
 */
export type DetectionSource = "dom" | "vision" | "ocr";

export type BoundingBox = [x: number, y: number, width: number, height: number];

export interface Detection {
  element_id: string;
  category: SensitiveCategory;
  bbox: BoundingBox;
  confidence: number;
  source: DetectionSource;
}

export interface ElementMeta {
  element_id: string;
  tag: string;
  type: string | null;
  role: string | null;
  label: string | null;
  text: string;
  bbox: BoundingBox;
  /** True when element_id is an in-memory generated id, not a DOM id. */
  generated?: boolean;
}

export interface Viewport {
  w: number;
  h: number;
}

export interface BrowserState {
  url: string;
  title: string;
  viewport: Viewport;
}

export interface Action {
  type: "click" | "type" | string;
  target: string;
  value?: string;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export type PolicyGateDecision = "allow" | "human_approval" | "block";

/**
 * Receipt stamped by the redaction gate when a screenshot is sealed. `hash` is
 * SHA-256 over the encoded outbound image bytes; `manifestHash` is SHA-256 over
 * the canonicalised manifest (receipt excluded). Both are recomputed
 * independently at every outbound boundary (remote-agent/receipt.ts).
 */
export interface RedactionReceipt {
  algo: "SHA-256";
  hash: string;
  manifestHash: string;
  sealedAt: number;
}

/**
 * Self-describing record of one seal operation: per-class detection counts,
 * how much of the viewport was painted, and how much of the painted area
 * covered nothing detected (over-redaction). Counts and fractions only —
 * never a raw value.
 */
export interface RedactionManifest {
  counts: Partial<Record<SensitiveCategory, number>>;
  redactedFraction: number;
  overRedactedFraction: number;
  policyVersion: string;
  receipt: RedactionReceipt;
}

export interface PolicyGateResult {
  decision: PolicyGateDecision;
  reason: string;
}

export interface CapturePackage {
  tabId: number;
  dataUrl: string;
  elements: ElementMeta[];
  detections: Detection[];
  browserState: BrowserState;
}

export interface SanitizedContext {
  elements: ElementMeta[];
  browserState: BrowserState;
}

export interface SanitizedPackage {
  goal: string;
  sanitizedScreenshot: string;
  sanitizedContext: SanitizedContext;
  /**
   * Phase 01 redaction receipt (SIH26171 gate.ts port). Digest of the outbound
   * image bytes + digest of the canonicalised manifest, minted by the only
   * module permitted to encode an image (privacy/sanitizer/redaction-gate.ts).
   * Every outbound boundary (queryServer, operator server) recomputes both
   * digests and refuses to transmit/serve on mismatch.
   */
  redactionManifest?: RedactionManifest;
  /**
   * Provenance stamp — REQUIRED. Only the on-device Sanitizer path sets it to
   * true after structural + visual redaction. Every outbound boundary (router,
   * queryServer) refuses packages without it, so an unredacted
   * raw screenshot can never be dispatched to a cloud model. ponytail: stamped
   * by trusted in-device code; a fully compromised extension process could
   * forge it — real mitigation is the sanitizer being the only package builder,
   * per CONTRACT.md data flow.
   */
  redacted: true;
}

export interface StepResult {
  decision: PolicyGateDecision;
  reason: string;
  actions?: ActionResult[];
}

export interface CaptureRequestMessage {
  type: "capture.request";
}

export interface CaptureResponseMessage {
  type: "capture.response";
  payload: {
    elements: ElementMeta[];
    browserState: BrowserState;
  };
}

export interface ExecuteRequestMessage {
  type: "execute.request";
  payload: {
    actions: Action[];
  };
}

export interface ExecuteResponseMessage {
  type: "execute.response";
  payload: {
    results: ActionResult[];
  };
}

export interface PingMessage {
  type: "ping";
}

export interface PongMessage {
  type: "pong";
}

export type PrivisMessage =
  | CaptureRequestMessage
  | CaptureResponseMessage
  | ExecuteRequestMessage
  | ExecuteResponseMessage
  | PingMessage
  | PongMessage;

export type PrivisMessageType = PrivisMessage["type"];

// Cloud Browser Agent (CBA) types
import type { AgentAction } from "../remote-agent/types.js";
export * from "../remote-agent/types.js";
// Type-only re-exports: the barrel must stay a pure-type module so value
// imports of packager/guard never drag the router + LLM clients into
// lightweight consumers (service worker, content scripts, executor).
export type * from "../remote-agent/packager.js";
export type * from "../remote-agent/guard.js";

// CBA-11 Session Transparency Log types
export interface GateRecord {
  decision: PolicyGateDecision | string;
  reason: string;
}

export interface TransparencyEntry {
  sessionId: string;
  tabIdHint?: number;
  goal: string;
  step: number;
  timestamp: number;
  model: string;
  request: SanitizedPackage;
  requestDigest: string;
  response: AgentAction | null;
  gate: GateRecord;
  error?: string;
}

export interface TransparencyLogStore {
  version: 1;
  prunedCount: number;
  entries: TransparencyEntry[];
}

