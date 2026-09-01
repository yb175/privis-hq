# background/

**Owner:** background (MV3 service worker) only.

## Responsibility

- Owns the Capture Layer screenshot step: `tabs.captureVisibleTab`, in memory only.
- Coordinates the pipeline: capture → privacy engine → sanitizer → policy gate → remote → executor.
- Holds no DOM access; it never reads page content itself.
- Sends capture packages to content scripts and receives sanitized results.
- Never persists raw screenshots to disk or storage.

## Inputs

- User goal (from UI / keyboard command).
- Capture messages from content scripts.

## Outputs

- Capture package: in-memory screenshot + browser state, handed to the pipeline.
- Action requests to `content/capture-content.js` for the Local Executor.

## Forbidden

- Writing raw screenshots to disk or extension storage.
- Sending anything unsanitized to the Remote Agent.
- Reading or scraping DOM (that is the content script's job).
