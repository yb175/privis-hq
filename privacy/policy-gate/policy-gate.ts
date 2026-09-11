// privacy/policy-gate/policy-gate.ts
// Policy Gate: Allow / Human Approval / Block decision maker
//
// Responsibilities:
// - Evaluates whether low-confidence detections or sensitive fields (e.g. passwords) are present.
// - Assesses host domain risk (banking, tax, EPFO, payroll).
// - Returns gate decision: "allow", "human_approval", or "block".

import type { BrowserState, Detection, PolicyGateResult } from "../../types/index.js";

const DENY_HOST_KEYWORDS = ["onlinesbi", "incometax", "epfo"];
const LOGIN_KEYWORDS = ["login", "signin", "sign-in", "auth", "authenticate"];
const TRUSTED_DEMO_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "demo-portal.local",
  "demo-portal.internal",
  "hr.internal.example",
]);

function isDemoOrLocalUrl(rawUrl: string): boolean {
  if (!rawUrl) return false;
  if (rawUrl.startsWith("file://")) return true;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === "file:") return true;
    return TRUSTED_DEMO_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isDenyListedHost(rawUrl: string): boolean {
  if (!rawUrl) return false;
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    return DENY_HOST_KEYWORDS.some((keyword) => host.includes(keyword));
  } catch {
    const lower = rawUrl.toLowerCase();
    return DENY_HOST_KEYWORDS.some((keyword) => lower.includes(keyword));
  }
}

function isLoginPage(browserState: BrowserState): boolean {
  const urlLower = (browserState.url || "").toLowerCase();
  const titleLower = (browserState.title || "").toLowerCase();
  return (
    LOGIN_KEYWORDS.some((kw) => urlLower.includes(kw)) ||
    LOGIN_KEYWORDS.some((kw) => titleLower.includes(kw))
  );
}

/**
 * Decides whether the sanitized package is safe to send to the remote agent.
 * @param params Detections and browser state
 */
export function decide(params: {
  detections: Detection[];
  browserState: BrowserState;
}): PolicyGateResult {
  const { detections, browserState } = params;

  // 1. v0 pragmatic demo rule: allow on file:// or trusted local/demo hosts
  // as long as no detection would independently require human approval.
  // Aligned to the 0.6 human-approval threshold below so label-only hits
  // (0.7) don't silently disable the demo, while truly low-confidence
  // detections (< 0.6) still fail closed even on demo URLs.
  const isDemoOrLocal = isDemoOrLocalUrl(browserState.url);
  const allConfident =
    detections.length === 0 || detections.every((d) => d.confidence >= 0.6);

  if (isDemoOrLocal && allConfident) {
    return {
      decision: "allow",
      reason:
        "Allowed under v0 demo exception: trusted local/demo URL with no low-confidence detections",
    };
  }

  // 2. Hard-block deny-listed hosts (banking / tax / payroll) — never leaves
  //    the device, no human-approval path for these.
  if (isDenyListedHost(browserState.url)) {
    return {
      decision: "block",
      reason: `Blocked: deny-listed host (${browserState.url}) — page never sent to the remote agent`,
    };
  }

  // 3. Human approval if a PASSWORD detection exists on external/non-demo
  //    sites. The sanitizer never extracts or sends the password value (the
  //    field crosses the wire with text ""), so a login page (e.g. Uber) is
  //    workable once the human clears it — v0's hard block made any login flow
  //    impossible to complete.
  const hasPassword = detections.some((d) => d.category === "PASSWORD");
  if (hasPassword) {
    return {
      decision: "human_approval",
      reason:
        "Human approval required: PASSWORD field present. The password value is never sent to the agent — approve to let the agent see and act on this login page.",
    };
  }

  // 4. Human approval if any detection confidence < 0.6
  const lowConfidenceDetection = detections.find((d) => d.confidence < 0.6);
  if (lowConfidenceDetection) {
    return {
      decision: "human_approval",
      reason: `Human approval required: low confidence detection (${lowConfidenceDetection.category} at ${lowConfidenceDetection.confidence.toFixed(2)})`,
    };
  }

  // 5. Human approval if category FACE on a login page
  const hasFace = detections.some((d) => d.category === "FACE");
  if (hasFace && isLoginPage(browserState)) {
    return {
      decision: "human_approval",
      reason: "Human approval required: FACE detection present on login/auth page",
    };
  }

  // 6. Allow otherwise
  return {
    decision: "allow",
    reason: "Allowed: all safety and confidence checks passed",
  };
}
