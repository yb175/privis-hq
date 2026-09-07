// extension/src/offscreen/offscreen.ts
// Offscreen execution host for ONNX Runtime Web WASM face detector.
// Chrome MV3 Service Workers disallow dynamic import() on ServiceWorkerGlobalScope.
// The Offscreen document provides a full Window environment with WASM & dynamic import support.

import { runVisionPath } from "../../../privacy/engine/vision/face-pipeline.js";
import type { Detection, ElementMeta, Viewport } from "../../../types/index.js";

interface VisionRequest {
  type: "privis.offscreen.detectFaces";
  payload: {
    dataUrl: string;
    elements: ElementMeta[];
    domDetections: Detection[];
    viewport: Viewport;
  };
}

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  if (
    msg &&
    typeof msg === "object" &&
    (msg as VisionRequest).type === "privis.offscreen.detectFaces"
  ) {
    const request = msg as VisionRequest;
    runVisionPath(request.payload)
      .then((detections: Detection[]) => {
        sendResponse({ ok: true, detections });
      })
      .catch((err: unknown) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        sendResponse({ ok: false, error: errorMsg });
      });
    return true; // Keep channel open for async response
  }
  return false;
});
