// tests/test-geometry.ts
// Phase 01: the geometry helpers the gate's manifest leans on — unionArea
// (sweep-line, correct for overlaps), areaOutside (pairwise clipping), IoU,
// pad/clamp. Getting these wrong makes the honesty metrics lies.

import { box, iouBoxes, unionArea, areaOutside, padBox, clampToViewport } from "../../../utils/coords.js";
import process from "node:process";

const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  PASS ${name}`);
  else {
    failures.push(name + (detail ? ` (${detail})` : ""));
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

// --- unionArea -----------------------------------------------------------------
check("union: disjoint boxes sum", near(unionArea([box([0, 0, 10, 10]), box([20, 0, 10, 10])]), 200));
check("union: identical boxes counted once", near(unionArea([box([0, 0, 10, 10]), box([0, 0, 10, 10])]), 100));
check("union: half-overlap", near(unionArea([box([0, 0, 10, 10]), box([5, 0, 10, 10])]), 150));
check("union: containment", near(unionArea([box([0, 0, 20, 20]), box([5, 5, 5, 5])]), 400));
check("union: three-way overlap", near(unionArea([box([0, 0, 10, 10]), box([5, 0, 10, 10]), box([8, 0, 10, 10])]), 180));
check("union: empty list is 0", unionArea([]) === 0);
check("union: touching boxes (no area overlap)", near(unionArea([box([0, 0, 10, 10]), box([10, 0, 10, 10])]), 200));

// --- areaOutside ----------------------------------------------------------------
// How much of `boxes` lies outside `cover` — the over-redaction numerator.
check("outside: fully covered box contributes 0", near(areaOutside([box([0, 0, 10, 10])], [box([0, 0, 10, 10])]), 0));
check("outside: half-outside box contributes its half",
  near(areaOutside([box([0, 0, 10, 10])], [box([5, 0, 5, 10])]), 50));
check("outside: disjoint box contributes everything",
  near(areaOutside([box([0, 0, 10, 10])], [box([50, 50, 5, 5])]), 100));
check("outside: two cover pieces covering the box",
  near(areaOutside([box([0, 0, 10, 10])], [box([0, 0, 5, 10]), box([5, 0, 5, 10])]), 0));

// --- IoU -------------------------------------------------------------------------
check("iou: identical boxes = 1", iouBoxes(box([0, 0, 10, 10]), box([0, 0, 10, 10])) === 1);
check("iou: disjoint = 0", iouBoxes(box([0, 0, 10, 10]), box([20, 20, 5, 5])) === 0);
check("iou: half overlap = 1/3", near(iouBoxes(box([0, 0, 10, 10]), box([5, 0, 10, 10])), 50 / 150));

// --- pad / clamp ------------------------------------------------------------------
const padded = padBox(box([10, 10, 10, 10]), 5);
check("padBox grows by px on each side", padded.x === 5 && padded.w === 20 && padded.h === 20);

const clamped = clampToViewport(box([-10, -10, 30, 30]), { w: 100, h: 100 });
check("clampToViewport clips to the viewport",
  clamped !== null && clamped.x === 0 && clamped.y === 0 && clamped.w === 20 && clamped.h === 20);
check("clampToViewport drops fully-outside boxes",
  clampToViewport(box([200, 200, 10, 10]), { w: 100, h: 100 }) === null);

if (failures.length === 0) console.log("\nALL CHECKS PASSED");
else {
  console.error(`\nFAILED: ${failures.length} check(s)`);
  process.exit(1);
}
