// privacy/policy-gate/policy-gate.js — Allow / Human Approval / Block.

// decide({ detections, sanitizedContext, browserState }) ->
//   { decision: "allow" | "human_approval" | "block", reason }
// Block: bank/payroll URL + residual raw PII. Approval: low confidence,
// password, pay/submit on sensitive host. Otherwise allow.
function decide(pkg) {
  // TODO
  return { decision: "block", reason: "not implemented" };
}

export { decide };
