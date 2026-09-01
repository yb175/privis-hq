// privacy/policy-gate/policy-gate.ts
// Policy Gate: Allow / Human Approval / Block decision maker
//
// Responsibilities:
// - Evaluates whether low-confidence detections or sensitive fields (e.g. passwords) are present.
// - Assesses host domain risk (banking, tax, EPFO, payroll).
// - Returns gate decision: "allow", "human_approval", or "block".

import type { BrowserState, Detection, PolicyGateResult } from "../../types/index.js";

/**
 * Decides whether the sanitized package is safe to send to the remote agent.
 * @param params Detections and browser state
 */
export function decide(params: {
  detections: Detection[];
  browserState: BrowserState;
}): PolicyGateResult {
  // TODO: Implement in chunks
  return {
    decision: "block",
    reason: "Policy gate not implemented",
  };
}
