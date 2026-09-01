// privacy/sanitizer/visual-redact.js — canvas redaction on the in-memory screenshot.
// FACE -> blur, PASSWORD -> black-out, other categories -> opaque mask.

// Returns a sanitized canvas/dataURL. Input dataUrl stays in memory; never written to disk.
async function redactVisual(dataUrl, detections) {
  // TODO: draw -> apply redactions per detection.bbox -> export
  return null;
}

export { redactVisual };
