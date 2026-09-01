# utils/

**Owner:** both background and content (pure helpers, no page or tab APIs of their own).

## Responsibility

- `screenshot.js` — wraps `tabs.captureVisibleTab` for the background; memory only.
- `dom-extractor.js` — DOM/a11y/label/bbox extraction helpers for the content script.
- `browser-state.js` — builds the BrowserState object (URL, title, form structure).
- `messaging.js` — typed request/response helpers between background and content.

## Inputs

- Standard browser APIs (via the calling side) and DOM nodes (content side).

## Outputs

- In-memory screenshot data, element lists, browser state objects, message envelopes.

## Forbidden

- Disk or storage writes of screenshots.
- Any network calls.
- Pipeline logic (that belongs to background / privacy/ folders).
