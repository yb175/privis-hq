# remote/

**Owner:** background (only network path in the extension).

## Responsibility

- Remote Agent client: sends the sanitized package (sanitized screenshot + sanitized JSON + goal) to the remote reasoning server.
- Receives the action plan back (e.g. `{ "type": "click", "target": "#submit" }`).
- Fires only after the Policy Gate allows; a "block" decision means nothing is sent.

## Inputs

- Sanitized screenshot + sanitized context + goal (from the pipeline).

## Outputs

- Action plan JSON for the Local Executor.

## Forbidden

- Receiving raw PAN / Aadhaar / salary / password / face pixels — ever.
- Contacting the server before a Policy Gate "allow".
- Storing server responses with unsanitized values.
