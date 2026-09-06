// privacy/engine/vision/test-canvas-shim.ts
// TEST-ONLY (never imported by extension source): minimal Node shims for the
// browser canvas/bitmap/FileReader APIs that privacy/sanitizer/visual-redact.ts
// and privacy/engine/vision/face-pipeline.ts use, so the REAL redaction and
// decode code paths run under the Node test harness instead of being stubbed.
//
// What is real vs shimmed:
//   REAL: all redaction logic — fillRect blackouts, pixelate (downscale via
//         drawImage to a tiny canvas, upscale with imageSmoothingEnabled=false),
//         bbox clamping, CSS<->device-pixel scaling, draw ordering.
//   SHIM: the codec/transport layer only — OffscreenCanvas stores a raw RGBA
//         buffer; convertToBlob "encodes" it as the raw bytes (NOT a real PNG,
//         documented deviation); FileReader base64-encodes them; fetch handles
//         data: URLs by decoding the base64 payload; createImageBitmap decodes
//         PNG bytes via the shared stdlib decoder (test-png.ts).
//   Nearest-neighbor drawImage everywhere: exact for identity copies and for
//   the smoothing-disabled pixelate upscale (matches browsers); the only
//   deviation from a real browser is the smoothing-ENABLED downscale inside
//   pixelate (browsers average, we nearest-sample) — irrelevant to every
//   assertion here (regions changed / blacked / unchanged).
//
// fetch() falls through to the real Node fetch for non-data: URLs, so no
// legitimate dependency breaks; data: URLs never touch the network.

/// <reference types="node" />
import { Buffer } from "node:buffer";
import { decodePngBufferRGBA } from "./test-png.js";

export class StubBlob {
  constructor(public type: string, public bytes: Uint8Array) {}
}

export class StubFileReader {
  result: string | ArrayBuffer | null = null;
  onload: (() => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;
  readAsDataURL(blob: StubBlob): void {
    this.result = `data:${blob.type};base64,${Buffer.from(blob.bytes).toString("base64")}`;
    this.onload?.();
  }
}

export class StubImageBitmap {
  constructor(
    public width: number,
    public height: number,
    /** RGBA, length = width * height * 4. */
    public pixels: Uint8ClampedArray
  ) {}
  close(): void {}
}

function parseColor(style: string): [number, number, number] {
  const hex = style.trim();
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    return [
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
      parseInt(hex[3] + hex[3], 16),
    ];
  }
  if (/^#[0-9a-f]{6}$/i.test(hex)) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  }
  return [0, 0, 0];
}

class Stub2DContext {
  imageSmoothingEnabled = true;
  fillStyle = "#000";
  constructor(private canvas: StubOffscreenCanvas) {}

  fillRect(x: number, y: number, w: number, h: number): void {
    const [r, g, b] = parseColor(this.fillStyle);
    const { width: cw, height: ch, data } = this.canvas;
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(cw, Math.round(x + w));
    const y1 = Math.min(ch, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const o = (yy * cw + xx) * 4;
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        data[o + 3] = 255;
      }
    }
  }

  // 3-arg drawImage(img, dx, dy) and 9-arg drawImage(img, sx,sy,sw,sh, dx,dy,dw,dh).
  // Nearest-neighbor sampling (see file header).
  drawImage(
    src: StubImageBitmap | StubOffscreenCanvas,
    a1: number, a2: number, a3?: number, a4?: number,
    a5?: number, a6?: number, a7?: number, a8?: number
  ): void {
    const nine = a3 !== undefined && a8 !== undefined;
    const sx0 = nine ? a1 : 0;
    const sy0 = nine ? a2 : 0;
    const sw = nine ? a3! : src.width;
    const sh = nine ? a4! : src.height;
    const dx = nine ? a5! : a1;
    const dy = nine ? a6! : a2;
    const dw = nine ? a7! : src.width;
    const dh = nine ? a8! : src.height;
    const srcPixels = src instanceof StubImageBitmap ? src.pixels : src.data;
    const { width: cw, height: ch, data } = this.canvas;
    for (let v = 0; v < dh; v++) {
      const sy = Math.min(src.height - 1, Math.max(0, Math.round(sy0 + ((v + 0.5) * sh) / dh - 0.5)));
      for (let u = 0; u < dw; u++) {
        const sx = Math.min(src.width - 1, Math.max(0, Math.round(sx0 + ((u + 0.5) * sw) / dw - 0.5)));
        const tx = Math.round(dx) + u;
        const ty = Math.round(dy) + v;
        if (tx < 0 || ty < 0 || tx >= cw || ty >= ch) continue;
        const so = (sy * src.width + sx) * 4;
        const to = (ty * cw + tx) * 4;
        data[to] = srcPixels[so];
        data[to + 1] = srcPixels[so + 1];
        data[to + 2] = srcPixels[so + 2];
        data[to + 3] = srcPixels[so + 3];
      }
    }
  }

  getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } {
    const { width: cw, data } = this.canvas;
    const out = new Uint8ClampedArray(w * h * 4);
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const so = ((Math.round(y) + yy) * cw + Math.round(x) + xx) * 4;
        const to = (yy * w + xx) * 4;
        out[to] = data[so];
        out[to + 1] = data[so + 1];
        out[to + 2] = data[so + 2];
        out[to + 3] = data[so + 3];
      }
    }
    return { data: out };
  }
}

export class StubOffscreenCanvas {
  data: Uint8ClampedArray;
  private ctx: Stub2DContext | null = null;
  constructor(public width: number, public height: number) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
  getContext(type: string): Stub2DContext | null {
    if (type !== "2d") return null;
    if (this.ctx === null) this.ctx = new Stub2DContext(this);
    return this.ctx;
  }
  /** SHIM: "encodes" the raw RGBA buffer, not a real PNG (file header). */
  async convertToBlob(opts?: { type?: string }): Promise<StubBlob> {
    return new StubBlob(opts?.type ?? "image/png", new Uint8Array(this.data));
  }
}

/** Installs the shims on globalThis. Returns a restore function. */
export function installCanvasShims(): () => void {
  const g = globalThis as Record<string, unknown>;
  const prev = {
    OffscreenCanvas: g.OffscreenCanvas,
    createImageBitmap: g.createImageBitmap,
    FileReader: g.FileReader,
    fetch: g.fetch,
  };
  g.OffscreenCanvas = StubOffscreenCanvas;
  g.FileReader = StubFileReader;
  g.createImageBitmap = async (blob: StubBlob): Promise<StubImageBitmap> => {
    const img = decodePngBufferRGBA(Buffer.from(blob.bytes));
    return new StubImageBitmap(img.width, img.height, img.data);
  };
  const realFetch = g.fetch as typeof fetch;
  g.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("data:")) {
      const m = /^data:([^;,]*)?(;base64)?,(.*)$/s.exec(url);
      if (!m) return Promise.reject(new Error("test shim: malformed data URL"));
      const bytes = m[2]
        ? Buffer.from(m[3], "base64")
        : Buffer.from(decodeURIComponent(m[3]));
      const blob = new StubBlob(m[1] || "application/octet-stream", new Uint8Array(bytes));
      return Promise.resolve({ blob: () => Promise.resolve(blob) } as unknown as Response);
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;
  return () => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
  };
}
