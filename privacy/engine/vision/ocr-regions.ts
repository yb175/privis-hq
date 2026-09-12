// privacy/engine/vision/ocr-regions.ts
// OCR-over-DOM-opaque-regions seam.
//
// PROVENANCE: ported from the approved reference repo PravAl2028/SIH26171,
// extension/src/offscreen/tasks/ocr.ts (author-granted permission, Phase 01),
// adapted to PRIVIS's ElementMeta (tuple bbox; element_id instead of index).
// The `createOcrRunner` stub was NOT ported — PRIVIS keeps its own working
// EasyOCR pipeline (ml/inference/ocr_reader.py); this module is the seam the
// DOM-side capture path will use to decide WHERE on-device OCR is needed.
//
// "Opaque" means the DOM has nothing to say: an img, a canvas, a video, an
// iframe, an embedded PDF. Everywhere else the DOM already handed over the
// text, and re-deriving it from pixels costs ~500 ms to learn what was free.
// Never OCR the whole screenshot.
//
// Phase 01 status: seam + tests landed; not yet wired into the capture path
// (the vision pipeline currently runs the face path only). Node-pure.

import type { ElementMeta } from "../../../types/index.js";
import type { Box } from "../../../utils/coords.js";

/** Tags whose contents the DOM cannot describe. */
const OPAQUE_TAGS: ReadonlySet<string> = new Set([
  "img",
  "canvas",
  "video",
  "iframe",
  "embed",
  "object",
]);

/** Smaller than this and there is no text to find: an icon, a spacer, a tracking pixel. */
export const MIN_OCR_SIDE = 48;

/** How many crops to keep. A scanned document across a long session is a few entries. */
export const OCR_CACHE_LIMIT = 32;

export interface OcrLine {
  text: string;
  /** CSS px of the visual viewport, like every other box in the project. */
  box: Box;
  score: number;
  /** Which crop this line came from, so batched results can be re-attributed. */
  region: number;
}

export interface OcrRegion {
  /** Index into the batch, and the value that comes back as OcrLine.region. */
  region: number;
  box: Box;
  elementId?: string;
  /** Why this region is opaque, for the trace. */
  reason: string;
}

/**
 * The regions worth reading. An element the DOM described is not one of them,
 * however much text is painted inside it.
 */
export function opaqueRegions(elements: ElementMeta[]): OcrRegion[] {
  const regions: OcrRegion[] = [];

  for (const el of elements) {
    const tag = el.tag.toLowerCase();
    if (!OPAQUE_TAGS.has(tag)) continue;

    const box: Box = { x: el.bbox[0], y: el.bbox[1], w: el.bbox[2], h: el.bbox[3] };
    if (box.w < MIN_OCR_SIDE || box.h < MIN_OCR_SIDE) continue;

    regions.push({
      region: regions.length,
      box,
      elementId: el.element_id,
      reason: `tag-${tag}`,
    });
  }

  return regions;
}

export interface CacheEntry {
  lines: OcrLine[];
  lastUsed: number;
}

export interface OcrCache {
  get(hash: string, now: number): OcrLine[] | undefined;
  set(hash: string, lines: OcrLine[], now: number): void;
  readonly size: number;
  readonly hits: number;
  readonly misses: number;
  clear(): void;
}

/**
 * Keyed by a hash of the crop's pixels, not by its position or its element id.
 *
 * A scanned document on screen across six steps is the same pixels six times,
 * and reading it once is the difference between 40 ms and 240 ms of the
 * latency budget. The position is deliberately not part of the key: the page
 * scrolling does not change what the document says.
 */
export function createOcrCache(limit = OCR_CACHE_LIMIT): OcrCache {
  const entries = new Map<string, CacheEntry>();
  let hits = 0;
  let misses = 0;

  function evict(): void {
    while (entries.size > limit) {
      let oldestKey: string | null = null;
      let oldest = Infinity;
      for (const [key, entry] of entries) {
        if (entry.lastUsed < oldest) {
          oldest = entry.lastUsed;
          oldestKey = key;
        }
      }
      if (oldestKey === null) return;
      entries.delete(oldestKey);
    }
  }

  return {
    get(hash, now) {
      const entry = entries.get(hash);
      if (!entry) {
        misses += 1;
        return undefined;
      }
      entry.lastUsed = now;
      hits += 1;
      // Copies: a caller re-boxing lines for a new scroll position must not
      // rewrite the cached ones.
      return entry.lines.map((line) => ({ ...line, box: { ...line.box } }));
    },

    set(hash, lines, now) {
      entries.set(hash, {
        lines: lines.map((line) => ({ ...line, box: { ...line.box } })),
        lastUsed: now,
      });
      evict();
    },

    get size() {
      return entries.size;
    },
    get hits() {
      return hits;
    },
    get misses() {
      return misses;
    },
    clear() {
      entries.clear();
    },
  };
}

/**
 * Lines come back in crop coordinates — pixels within the cropped image. This
 * puts them where they belong on screen.
 *
 * `cropScale` is image px per CSS px of the crop, which is not the frame's
 * scale: a region is often resized before it goes to the recogniser.
 */
export function linesToViewport(
  lines: OcrLine[],
  region: OcrRegion,
  cropScale: number
): OcrLine[] {
  return lines.map((line) => ({
    ...line,
    region: region.region,
    box: {
      x: region.box.x + line.box.x / cropScale,
      y: region.box.y + line.box.y / cropScale,
      w: line.box.w / cropScale,
      h: line.box.h / cropScale,
    },
  }));
}
