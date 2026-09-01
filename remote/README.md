# remote/

**Owner:** background (only network path in the extension).

## Responsibility

- Remote Agent client: sends the sanitized package (sanitized screenshot + sanitized JSON + goal) to the remote reasoning server.
- Receives the action plan back (e.g. `{ "type": "click", "target": "#submit" }`).
- Fires only after the Policy Gate allows; a "block" decision means nothing is sent.

## Inputs

- Sanitized screenshot + sanitized context + goal (from the pipeline).

## v0 status (stub)

`sendSanitized(pkg)` makes no network call yet. It:

1. Asserts the package is a `SanitizedPackage` (rejects raw capture fields like
   `tabId`, `dataUrl`, `elements`, `detections`) and that
   `sanitizedScreenshot` + `sanitizedContext` are present.
2. Guards against Sanitizer leaks: if any text crossing the wire matches a PAN,
   Aadhaar, or email pattern, it throws — nothing is sent.
3. Returns the fixture action `[{ "type": "click", "target": "#submit" }]`.

A real VLM plugs in at the marked point in `client.ts`: POST the package, parse
`Action[]` from the response. No OpenAI/Anthropic keys, no raw screenshot
upload.

## Outputs

- Action plan JSON for the Local Executor.

## Forbidden

- Receiving raw PAN / Aadhaar / salary / password / face pixels — ever.
- Contacting the server before a Policy Gate "allow".
- Storing server responses with unsanitized values.
