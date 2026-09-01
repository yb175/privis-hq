// privacy/policy-gate/policy-gate.js — Allow / Human Approval / Block.

// decide({ detections, sanitizedElements, browserState }) ->
//   { decision: "allow" | "human_approval" | "block", reason }
function decide({ detections, browserState }) {
  const lowConf = detections.filter((d) => d.confidence < 0.7);
  const hasPassword = detections.some((d) => d.category === "PASSWORD");
  const sensitiveHost = /bank|payroll|salary|tax|itr|epfo|income/i.test(browserState.url);

  if (sensitiveHost && (lowConf.length || hasPassword))
    return { decision: "block", reason: "sensitive host with residual low-confidence PII or password field" };
  if (hasPassword || lowConf.length)
    return { decision: "human_approval", reason: hasPassword ? "password field present" : `${lowConf.length} low-confidence detection(s)` };
  return { decision: "allow", reason: "all detections redacted with high confidence" };
}
