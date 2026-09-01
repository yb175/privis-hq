# privacy/sanitizer/

**Owner:** background (canvas work happens off-screen in the service worker context).

## Responsibility

- Visual redaction: blur FACE boxes, black-out PASSWORD fields, mask PII text boxes on a canvas copy of the in-memory screenshot.
- Structural redaction: replace sensitive strings with stable session placeholders (`EMAIL_1`, `PAN_1`, `AADHAAR_1`, `AMOUNT_1`, `PHONE_1`, `NAME_1`).
- Preserve layout, button labels, form structure, and all non-sensitive text.
- Keep the placeholder→real-value mapping table on-device only.

## Inputs

- In-memory screenshot + detections list from the Local Privacy Vision Engine + element metadata.

## Outputs

- Sanitized screenshot (canvas data) + sanitized context (JSON with placeholders).

## Forbidden

- Writing the canvas or mapping table to disk/storage.
- Sending the mapping table off-device.
- Redacting button labels or form structure — the Remote Agent must still be able to navigate.
