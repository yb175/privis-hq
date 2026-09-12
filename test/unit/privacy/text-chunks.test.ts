// tests/test-text-chunks.ts
// Phase 01: the L2 offset table + chunker seam (SIH26171 port). Assert-based,
// Node-pure. Pins the three contracts the header calls the whole difficulty:
// one concatenated document with a per-run offset table, overlapping chunks
// with whitespace boundaries, and overlap de-duplication by span identity.

import {
  buildOffsetTable,
  runsForSpan,
  boxForSpan,
  chunkDocument,
  toDocumentSpan,
  dedupeSpans,
} from "../../../privacy/engine/vision/text-chunks.js";
import process from "node:process";

const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  PASS ${name}`);
  else {
    failures.push(name + (detail ? ` (${detail})` : ""));
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// --- buildOffsetTable ---------------------------------------------------------
const table = buildOffsetTable([
  {
    elementIndex: 0,
    runs: [
      { text: "Asha", box: { x: 0, y: 0, w: 40, h: 12 }, nodeIndex: 0 },
      { text: "", box: { x: 0, y: 20, w: 40, h: 12 }, nodeIndex: 1 }, // empty: skipped
    ],
  },
  {
    elementIndex: 1,
    runs: [{ text: "Menon", box: { x: 100, y: 0, w: 50, h: 12 }, nodeIndex: 0 }],
  },
]);
check("offset table: two runs joined by a newline", table.text === "Asha\nMenon", JSON.stringify(table.text));
check("offset table: entries record document offsets",
  table.entries.length === 2 && table.entries[1]?.start === 5 && table.entries[1]?.end === 10);
check("offset table: empty runs are not entries", table.entries.every((e) => e.end > e.start));

// --- runsForSpan / boxForSpan -------------------------------------------------
// The motivating case: a name split across two elements.
const both = runsForSpan(table, 0, 10);
check("span crossing a run boundary belongs to both runs", both.length === 2);
const union = boxForSpan(table, 0, 10);
check("box for a crossing span is the union of both runs' boxes",
  union !== null && union.x === 0 && union.w === 150,
  JSON.stringify(union));
check("box for a span touching nothing is null", boxForSpan(table, 20, 25) === null);

// --- chunkDocument -------------------------------------------------------------
check("short document: one chunk, offset 0",
  chunkDocument("small text").length === 1 && chunkDocument("small text")[0]?.offset === 0);
check("empty document: no chunks", chunkDocument("").length === 0);

const doc = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
const chunks = chunkDocument(doc, { maxTokens: 50, overlapTokens: 10 });
check("long document: more than one chunk", chunks.length > 1, `chunks=${chunks.length}`);
check("long document: chunks cover the whole document",
  chunks[chunks.length - 1] !== undefined &&
    chunks[chunks.length - 1].offset + chunks[chunks.length - 1].text.length >= doc.length);
check("long document: chunks are in order and non-degenerate",
  chunks.every((c) => c.text.length > 0) &&
  chunks.every((c, i) => i === 0 || c.offset > (chunks[i - 1]?.offset ?? -1)));
check("long document: chunk text is a real slice of the document",
  chunks.every((c) => doc.startsWith(c.text, c.offset) || doc.slice(c.offset, c.offset + c.text.length) === c.text));
const spaceTail = chunks.every((c) => !c.text.endsWith(" "));
check("long document: boundaries prefer whitespace (no fragment tails)", spaceTail);

// --- toDocumentSpan -----------------------------------------------------------
const chunk = { text: "xxxx", offset: 100, index: 2 };
const span = toDocumentSpan(chunk, { start: 1, end: 3, label: "NAME", score: 0.9 });
check("chunk span translated into document coordinates",
  span.start === 101 && span.end === 103);

// --- dedupeSpans ---------------------------------------------------------------
const deduped = dedupeSpans([
  { start: 0, end: 4, label: "NAME", score: 0.7 }, // exact dup, weaker
  { start: 0, end: 4, label: "NAME", score: 0.9 }, // exact dup, stronger — kept
  { start: 0, end: 10, label: "NAME", score: 0.8 }, // longer reading absorbs both
  { start: 20, end: 25, label: "NAME", score: 0.9 }, // separate entity
  { start: 20, end: 25, label: "PHONE", score: 0.9 }, // different label: not a dup
]);
check("dedupe: identical span keeps the more confident reading",
  deduped.some((s) => s.start === 0 && s.end === 10 && s.score === 0.8));
check("dedupe: containment — the longer reading wins",
  !deduped.some((s) => s.start === 0 && s.end === 4));
check("dedupe: different labels are different entities",
  deduped.filter((s) => s.start === 20).length === 2);
check("dedupe: output ordered by start", deduped.every((s, i) => i === 0 || s.start >= deduped[i - 1]!.start));

if (failures.length === 0) console.log("\nALL CHECKS PASSED");
else {
  console.error(`\nFAILED: ${failures.length} check(s)`);
  process.exit(1);
}
