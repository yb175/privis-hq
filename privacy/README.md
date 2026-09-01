# privacy/

**Owner:** shared — detection + placeholder swap run in the content script (values never leave the page); canvas redaction and the gate run in the background.

## Responsibility

- `engine/` — Local Privacy Vision Engine: fuse DOM detections with (later) vision boxes into a detection list. **README only — no code files yet.**
- `sanitizer/` — visual redaction on a canvas copy (`visual-redact.js`) + DOM-rule detection and placeholders (`structural-redact.js`).
- `policy-gate/` — Allow / Human Approval / Block decision (`policy-gate.js`).

## Inputs

- Capture package: in-memory screenshot + elements + browser state.

## Outputs

- Detections list (engine) → sanitized screenshot + sanitized context (sanitizer) → gate decision (policy gate).

## Forbidden

- Training scripts, `.py` files, `.onnx` files, an `ml/` directory.
- Uploading raw screenshots anywhere.
- Inventing new architecture box names.
