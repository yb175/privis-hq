# privacy/policy-gate/

**Owner:** background (decides before anything leaves the device).

## Responsibility

- Evaluate the sanitized package: Allow, Human Approval, or Block.
- Allow: high-sensitivity items redacted, high confidence.
- Human Approval: low-confidence residuals, password involvement, pay/submit on a sensitive host.
- Block: bank/payroll URL with residual raw PII.
- Runs after the Sanitizer, before the Remote Agent.

## Inputs

- Sanitized screenshot + sanitized context + detections (categories, confidence, source).

## Outputs

- Decision: `{ decision: "allow" | "human_approval" | "block", reason }`.

## Forbidden

- Forwarding anything to the Remote Agent on a "block" decision.
- Auto-approving password or payment flows without the human.
- Any network calls of its own.
