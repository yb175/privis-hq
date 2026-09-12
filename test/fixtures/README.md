# fixtures/

Synthetic data so every other issue can implement its box before the Capture
Layer or vision model exist. Everything here is one happy path — an employee
portal at `https://hr.internal.example/employee-portal` with PAN, Aadhaar,
email, amount, phone, name, password, and a face avatar, plus a Submit button
(`#submit`). All values are fake; the shapes match `types/index.ts` exactly
(see `CONTRACT.md` for the human-readable contract).

## Files

| File | Shape | What it stands in for |
|------|-------|-----------------------|
| `detections.json` | `Detection[]` | Output of the Local Privacy Vision Engine (DOM path). |
| `sanitized-context.json` | `SanitizedContext` | Expected output of the Sanitizer: same structure, sensitive values swapped for placeholders. |
| `action-click-submit.json` | `Action` | Output of the Remote Agent — click the Submit button. |

## The scenario

The happy path covers every `SensitiveCategory`:

- **EMAIL** `user@company.in` → placeholder `EMAIL_1`
- **PAN** `ABCDE1234F` → placeholder `PAN_1`
- **AADHAAR** `2341 5678 9012` → placeholder `AADHAAR_1`
- **AMOUNT** `1240000` → placeholder `AMOUNT_1`
- **PHONE** `98765 43210` → placeholder `PHONE_1`
- **NAME** `Priya Sharma` → placeholder `NAME_1`
- **PASSWORD** field — value never read; redacted by input type, no placeholder
- **FACE** avatar — redacted as pixels only, no text placeholder

The Remote Agent's reply is `{ "type": "click", "target": "#submit" }`, which the
Local Executor resolves against the live page DOM.

## How to use

1. Build your box's input from these files (or the shapes in `types/index.ts`).
2. Compare your output against the matching fixture.
3. Remember: the screenshot is memory-only and the element_id → real value map
   never leaves the device.

There is no real PII in this folder — nothing here can leak a teammate.