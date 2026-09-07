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
  | "PASSWORD";

export type DetectionSource = "dom" | "vision";

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
   * Provenance stamp — REQUIRED. Only the on-device Sanitizer path sets it to
   * true after structural + visual redaction. Every outbound boundary (router,
   * sendSanitized, queryServer) refuses packages without it, so an unredacted
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

