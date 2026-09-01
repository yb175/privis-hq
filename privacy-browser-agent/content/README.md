# content/

**Owner:** content script only (runs on the page, not in the service worker).

## Responsibility

- Reads the page DOM: visible text, a11y tree, labels, and element bounding boxes.
- Reports element metadata (never raw sensitive values upstream) for the Capture Layer.
- Hosts the Local Executor half: resolves targets and clicks/types on the real page.
- Returns capture data to the background on request.

## Inputs

- Messages from the background service worker (capture request, execute action).
- The live page DOM.

## Outputs

- Elements + bounding boxes `[x,y,w,h]` + labels + browser state (to background).
- Real DOM actions (clicks, typing) executed for the Local Executor.

## Forbidden

- Taking screenshots (`captureVisibleTab` is background-only, a Chrome rule).
- Sending raw PII values off-device or to the background for upload.
- Writing anything to disk.
