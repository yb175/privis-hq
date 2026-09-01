// privacy/sanitizer/visual-redact.js — canvas redaction on the in-memory screenshot.
// PASSWORD -> black-out, FACE -> pixelate (vision path supplies FACE boxes later),
// other categories -> opaque mask. Runs in the service worker via OffscreenCanvas.

// redactVisual(dataUrl, detections, viewport) -> sanitized dataUrl (memory only).
function redactVisual(dataUrl, detections, viewport) {
  return fetch(dataUrl)
    .then((r) => r.blob())
    .then(createImageBitmap)
    .then(async (bmp) => {
      const scale = bmp.width / viewport.w; // HiDPI: screenshot px != CSS px
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bmp, 0, 0);
      for (const d of detections) {
        const [x, y, w, h] = d.bbox.map((v) => Math.round(v * scale));
        if (d.category === "PASSWORD") {
          ctx.fillStyle = "#000";
          ctx.fillRect(x, y, w, h);
        } else if (d.category === "FACE") {
          ctx.drawImage(canvas, x, y, w, h, x, y, Math.max(1, w / 16), Math.max(1, h / 16));
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(canvas, x, y, Math.max(1, w / 16), Math.max(1, h / 16), x, y, w, h);
        } else {
          ctx.fillStyle = "rgba(30,30,30,0.88)";
          ctx.fillRect(x, y, w, h);
        }
      }
      const blob = await canvas.convertToBlob({ type: "image/png" });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return "data:image/png;base64," + btoa(bin);
    });
}
