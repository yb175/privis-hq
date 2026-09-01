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
}

export interface StepResult {
  decision: PolicyGateDecision;
  reason: string;
  actions?: ActionResult[];
}
