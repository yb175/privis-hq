// tests/test-ocr-regions.ts
// Phase 01: the OCR-over-opaque-regions seam (SIH26171 port). Assert-based,
// Node-pure. The three contracts worth pinning: which regions qualify, the
// pixel-hash cache (hit/miss/LRU/copy-out), and crop→viewport translation.

import {
  opaqueRegions,
  createOcrCache,
  linesToViewport,
  MIN_OCR_SIDE,
  type OcrLine,
} from "../../../privacy/engine/vision/ocr-regions.js";
import type { ElementMeta } from "../../../types/index.js";
import process from "node:process";

const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  PASS ${name}`);
  else {
    failures.push(name + (detail ? ` (${detail})` : ""));
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function el(id: string, tag: string, x: number, y: number, w: number, h: number): ElementMeta {
  return {
    element_id: id,
    tag,
    type: null,
    role: null,
    label: null,
    text: "",
    bbox: [x, y, w, h],
  };
}

// --- opaqueRegions -----------------------------------------------------------
const regions = opaqueRegions([
  el("doc", "img", 10, 20, 800, 600), // qualifies
  el("p", "p", 0, 0, 400, 400), // DOM-described: never a region
  el("icon", "img", 0, 0, 20, 20), // below MIN_OCR_SIDE
  el("wide", "canvas", 5, 5, 200, 30), // too short
  el("frame", "iframe", 0, 0, 640, 480), // qualifies
]);
check("opaque regions: img + iframe kept, DOM text and small boxes dropped",
  regions.length === 2 && regions[0]?.elementId === "doc" && regions[1]?.elementId === "frame",
  JSON.stringify(regions.map((r) => r.elementId)));
check("opaque regions: region indices are batch order",
  regions[0]?.region === 0 && regions[1]?.region === 1);
check("opaque regions: box carries the element bbox",
  regions[0]?.box.x === 10 && regions[0]?.box.w === 800);
check("opaque regions: minimum side is " + MIN_OCR_SIDE,
  regions.every((r) => r.box.w >= MIN_OCR_SIDE && r.box.h >= MIN_OCR_SIDE));

// --- cache -------------------------------------------------------------------
const cache = createOcrCache(2);
const line = (text: string, x: number): OcrLine => ({ text, box: { x, y: 0, w: 10, h: 10 }, score: 0.9, region: 0 });

cache.set("a", [line("alpha", 0)], 1);
cache.set("b", [line("beta", 0)], 2);
cache.get("a", 3); // hit — a is now most recently used
cache.set("c", [line("gamma", 0)], 4); // limit 2: evicts b, not a
check("cache: LRU evicts least-recently-used", cache.size === 2 && cache.get("a", 5) !== undefined);
check("cache: hit and miss counted", cache.hits === 2 && cache.misses === 0,
  `hits=${cache.hits} misses=${cache.misses}`);
const cached = cache.get("a", 6);
if (cached?.[0]) cached[0].box.x = 999;
check("cache: reads are copies — a caller cannot rewrite the cache",
  (cache.get("a", 7)?.[0]?.box.x ?? -1) !== 999);

// --- linesToViewport ----------------------------------------------------------
const region = { region: 3, box: { x: 100, y: 200, w: 50, h: 50 }, reason: "tag-img" };
const placed = linesToViewport([line("text", 10)], region, 2 /* image px per CSS px */);
check("linesToViewport: crop coords scaled and anchored to the region",
  placed[0]?.box.x === 105 && placed[0]?.box.y === 200 && placed[0]?.box.w === 5,
  JSON.stringify(placed[0]?.box));
check("linesToViewport: line re-attributed to its region", placed[0]?.region === 3);

if (failures.length === 0) console.log("\nALL CHECKS PASSED");
else {
  console.error(`\nFAILED: ${failures.length} check(s)`);
  process.exit(1);
}
