# privacy/

**Owner:** shared — background runs the pipeline stages; detection helpers may run in either context. No page interaction here.

## Responsibility

- `engine/` — Local Privacy Vision Engine: fuse DOM detections with (later) vision boxes into a detection list. **README only — no code files yet.**
- `sanitizer/` — visual redaction on a canvas copy (`visual-redact.js`) + structural placeholders (`structural-redact.js`).
- `policy-gate/` — Allow / Human Approval / Block decision (`policy-gate.js`).

## Inputs

- Capture package: in-memory screenshot + elements + browser state.

## Outputs

- Detections list (engine) → sanitized screenshot + sanitized context (sanitizer) → gate decision (policy gate).

## Forbidden

- Training scripts, `.py` files, `.onnx` files, an `ml/` directory.
- Uploading raw screenshots anywhere.
- Inventing new architecture box names.
