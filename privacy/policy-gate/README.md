# privacy/policy-gate/

**Owner:** background (decides before anything leaves the device).

## Responsibility

- Evaluate the sanitized package: Allow, Human Approval, or Block.
- Allow: high-sensitivity items redacted, high confidence.
- Human Approval: low-confidence residuals, password involvement, pay/submit on a sensitive host.
- Block: bank/payroll URL with residual raw PII.
- Runs after the Sanitizer, before the Remote Agent.

## Decision Rules (`decide({ detections, browserState })`)

1. **Demo Exception (v0 pragmatic rule):**
   - Returns `allow` if all detections have confidence $\ge 0.8$ and the URL is `file://`, `localhost`, `127.0.0.1`, or `demo-portal`.
2. **Block (Sensitive Host + Low Confidence):**
   - Returns `block` if URL host matches bank/payroll/tax deny list (`onlinesbi`, `incometax`, `epfo`) AND any detection confidence $< 0.5$.
3. **Block (Password Presence):**
   - Returns `block` if any `PASSWORD` category detection is present (remote agent is blocked from password pages in v0).
4. **Human Approval (Low Confidence):**
   - Returns `human_approval` if any detection confidence $< 0.6$.
5. **Human Approval (Face on Login):**
   - Returns `human_approval` if any `FACE` category detection is present on a login/auth page.
6. **Allow (Otherwise):**
   - Returns `allow` when all checks pass.

## Inputs

- Sanitized screenshot + sanitized context + detections (categories, confidence, source).

## Outputs

- Decision: `{ decision: "allow" | "human_approval" | "block", reason }`.

## Forbidden

- Forwarding anything to the Remote Agent on a "block" decision.
- Auto-approving password or payment flows without the human.
- Any network calls of its own.
