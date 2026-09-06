// privacy/engine/vision/test-png.ts
// TEST-ONLY utility (never imported by extension source): minimal stdlib PNG
// reader for the Node test harnesses. 8-bit RGB / RGBA / grayscale,
// non-interlaced. The committed fixtures are RGB (color type 2).
// Shared by test-face-detector.ts (M6-C) and test-face-pipeline.ts (M6-D).

/// <reference types="node" />
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

/** Decode PNG bytes (Buffer) to RGBA. Shared core of the harness decoders. */
export function decodePngBufferRGBA(buf: Buffer): {
  width: number;
  height: number;
  data: Uint8ClampedArray;
} {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!buf.subarray(0, 8).equals(sig)) throw new Error("not a PNG");
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (bitDepth !== 8 || ![0, 2, 6].includes(colorType) || data[12] !== 0) {
        throw new Error(`unsupported PNG variant (bitDepth=${bitDepth}, colorType=${colorType})`);
      }
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") break;
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : 1;
  const bpp = channels;
  const stride = width * bpp;
  const out = new Uint8ClampedArray(width * height * 4);
  const prev = new Uint8Array(stride);
  const cur = new Uint8Array(stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    cur.set(raw.subarray(rp, rp + stride));
    rp += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = cur[x];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      cur[x] = v;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const s = x * bpp;
      if (channels === 1) {
        out[o] = out[o + 1] = out[o + 2] = cur[s];
      } else {
        out[o] = cur[s];
        out[o + 1] = cur[s + 1];
        out[o + 2] = cur[s + 2];
      }
      out[o + 3] = 255;
    }
    prev.set(cur);
  }
  return { width, height, data: out };
}

/** Decode a PNG file to RGBA. */
export function decodePngRGBA(path: string): {
  width: number;
  height: number;
  data: Uint8ClampedArray;
} {
  return decodePngBufferRGBA(readFileSync(path));
}
