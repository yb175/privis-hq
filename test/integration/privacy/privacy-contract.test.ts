// tests/test-privacy-contract.ts
// Phase 01: pins the canonical privacy contract — finding normalization,
// placeholder lifecycle, visual-redaction geometry hardening, and the
// outbound boundary (providers refuse unsanitized packages).
//
// All data is synthetic. Style matches the other suites: assert-based checks,
// exit 1 on any failure, "ALL CHECKS PASSED" on success.
//
// What is REAL here: normalizeDetections/assertValidBBox (the canonical
// contract), applyPlaceholders/resetPlaceholderTokens (real sanitizer),
// redactVisual (real redaction logic via the TEST-ONLY canvas shim),
// assertSanitizedPackage, queryOpenAI/queryGemini/queryServer boundary
// assertions (fetch is a spy — nothing crosses the network).

import { readFileSync } from "node:fs";

import type {
  BrowserState,
  Detection,
  ElementMeta,
  SanitizedPackage,
} from "../../../types/index.js";
import {
  normalizeDetection,
  normalizeDetections,
  assertValidBBox,
  PrivacyError,
  type PrivacyErrorCode,
} from "../../../privacy/engine/normalize.js";
import {
  applyPlaceholders,
  resetPlaceholderTokens,
} from "../../../privacy/sanitizer/structural-redact.js";
import { redactVisual } from "../../../privacy/sanitizer/redaction-gate.js";
import { scaledClampedRect } from "../../../utils/coords.js";
import { assertSanitizedPackage } from "../../../remote-agent/assert.js";
import { queryOpenAI } from "../../../remote-agent/client-openai.js";
import { queryGemini } from "../../../remote-agent/client-gemini.js";
import { queryServer } from "../../../remote-agent/client-server.js";
import { runVisionPath } from "../../../privacy/engine/vision/face-pipeline.js";
import type { FaceDetector } from "../../../privacy/engine/vision/face-detector.js";
import { installCanvasShims } from "../../../test/unit/ml/vision/canvas-shim.js";
import { decodePngRGBA } from "../../../test/unit/ml/vision/png-helper.js";

const failures: string[] = [];

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures.push(name + (detail ? ` (${detail})` : ""));
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Runs fn expecting a PrivacyError with the given code. */
function expectPrivacyError(
  name: string,
  code: PrivacyErrorCode,
  fn: () => unknown,
  mustNotContain?: string
): void {
  try {
    fn();
    check(name, false, "did not throw");
  } catch (err) {
    const e = err as PrivacyError;
    const okCode = e instanceof PrivacyError && e.code === code;
    const leak = mustNotContain && String(e.message).includes(mustNotContain);
    check(name, okCode && !leak, `code=${e.code ?? "?"}${leak ? " ERROR LEAKED RAW VALUE" : ""}`);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const F1_PATH = "ml/dataset/images/synthetic_face.png";
const F1 = `data:image/png;base64,${readFileSync(F1_PATH).toString("base64")}`;
const F1_DIMS = { w: decodePngRGBA(F1_PATH).width, h: decodePngRGBA(F1_PATH).height };

const VIEWPORT: BrowserState = {
  url: "https://portal.example/form",
  title: "Form",
  viewport: { w: F1_DIMS.w, h: F1_DIMS.h }, // scale 1: CSS px == screenshot px
};

function el(
  id: string,
  tag: string,
  bbox: [number, number, number, number],
  extra: Partial<ElementMeta> = {}
): ElementMeta {
  return {
    element_id: id,
    tag,
    type: null,
    role: null,
    label: null,
    text: "",
    bbox,
    ...extra,
  };
}

function det(
  element_id: string,
  category: Detection["category"],
  bbox: [number, number, number, number],
  source: Detection["source"] = "dom",
  confidence = 0.95
): Detection {
  return { element_id, category, bbox, confidence, source };
}

function validPackage(overrides: Partial<SanitizedPackage> = {}): SanitizedPackage {
  return {
    goal: "test goal",
    sanitizedScreenshot: "data:image/png;base64,AAAA",
    sanitizedContext: {
      elements: [el("e-1", "input", [0, 0, 10, 10], { text: "PAN_1" })],
      browserState: VIEWPORT,
    },
    redacted: true,
    ...overrides,
  };
}

// Deterministic RNG (mulberry32) so adversarial cases are reproducible.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main(): Promise<void> {
  // ------------------------------------------------------------------ [1]
  console.log("\n[1] Canonical finding model — normalizeDetection");
  {
    const good = det("e-1", "PAN", [1, 2, 30, 40]);
    const n = normalizeDetection(good);
    check("valid detection round-trips",
      n.element_id === "e-1" && n.category === "PAN" && n.confidence === 0.95 &&
      n.source === "dom" && n.bbox.join(",") === "1,2,30,40");

    const smuggled = { ...det("e-2", "EMAIL", [0, 0, 5, 5]), text: "arjun@example.com" } as unknown;
    const n2 = normalizeDetection(smuggled);
    const keys = Object.keys(n2).sort().join(",");
    check("rebuild drops smuggled extra fields (no value rides along)",
      keys === "bbox,category,confidence,element_id,source" && !("text" in n2),
      `keys=${keys}`);

    check("'ocr' source accepted (reserved document-pipeline seam)",
      normalizeDetection(det("d-1", "PAN", [0, 0, 5, 5], "ocr")).source === "ocr");

    expectPrivacyError("null finding rejected", "INVALID_DETECTION", () => normalizeDetection(null));
    expectPrivacyError("array finding rejected", "INVALID_DETECTION", () => normalizeDetection([1, 2]));
    expectPrivacyError("missing element_id rejected", "INVALID_DETECTION",
      () => normalizeDetection({ category: "PAN", bbox: [0, 0, 1, 1], confidence: 0.9, source: "dom" }));
    expectPrivacyError("unknown category rejected", "INVALID_CATEGORY",
      () => normalizeDetection(det("e-3", "SOMETHING" as Detection["category"], [0, 0, 1, 1])));
    expectPrivacyError("unknown source rejected", "INVALID_SOURCE",
      () => normalizeDetection(det("e-4", "PAN", [0, 0, 1, 1], "satellite" as Detection["source"])));
    expectPrivacyError("confidence > 1 rejected", "INVALID_CONFIDENCE",
      () => normalizeDetection(det("e-5", "PAN", [0, 0, 1, 1], "dom", 2)));
    expectPrivacyError("confidence NaN rejected", "INVALID_CONFIDENCE",
      () => normalizeDetection(det("e-6", "PAN", [0, 0, 1, 1], "dom", NaN)));
    expectPrivacyError("missing geometry rejected (geometry is mandatory)", "INVALID_GEOMETRY",
      () => normalizeDetection({ element_id: "e-7", category: "PAN", confidence: 0.9, source: "dom" }));
    expectPrivacyError("NaN coordinate rejected", "INVALID_GEOMETRY",
      () => normalizeDetection(det("e-8", "PAN", [0, NaN, 1, 1])));
    expectPrivacyError("Infinity dimension rejected", "INVALID_GEOMETRY",
      () => normalizeDetection(det("e-9", "PAN", [0, 0, Infinity, 1])));
    expectPrivacyError("zero width rejected", "INVALID_GEOMETRY",
      () => normalizeDetection(det("e-10", "PAN", [0, 0, 0, 1])));
    expectPrivacyError("negative height rejected", "INVALID_GEOMETRY",
      () => normalizeDetection(det("e-11", "PAN", [0, 0, 1, -5])));
    expectPrivacyError("non-array bbox rejected", "INVALID_GEOMETRY",
      () => normalizeDetection(det("e-12", "PAN", "0,0,1,1" as unknown as [number, number, number, number])));

    // Error hygiene: a finding carrying a raw PAN value must never leak it in
    // the error message.
    expectPrivacyError("error message carries no raw value", "INVALID_CATEGORY",
      () => normalizeDetection({ ...det("e-13", "WEIRD" as Detection["category"], [0, 0, 1, 1]), text: "ABCDE1234F" }),
      "ABCDE1234F");

    // Batch: one malformed entry fails the whole list (fail closed).
    expectPrivacyError("batch fails closed on one malformed finding", "INVALID_GEOMETRY",
      () => normalizeDetections([det("e-a", "PAN", [0, 0, 1, 1]), det("e-b", "PAN", [0, 0, 0, 1])]));
    check("empty batch normalizes to empty list", normalizeDetections([]).length === 0);
  }

  // ------------------------------------------------------------------ [2]
  console.log("\n[2] Placeholder lifecycle — determinism, collisions, session reset");
  {
    resetPlaceholderTokens();
    const elements = [
      el("e-pan", "input", [0, 0, 100, 20], { text: "ABCDE1234F" }),
      el("e-pan2", "input", [0, 30, 100, 20], { text: "ABCDE1234F" }),
      el("e-mail", "input", [0, 60, 100, 20], { text: "arjun@example.com", type: "email" }),
      el("e-name", "input", [0, 90, 100, 20], { text: "Arjun Mehta", label: "Full name" }),
    ];
    const detections = [
      det("e-pan", "PAN", [0, 0, 100, 20]),
      det("e-pan2", "PAN", [0, 30, 100, 20]),
      det("e-mail", "EMAIL", [0, 60, 100, 20]),
      det("e-name", "NAME", [0, 90, 100, 20]),
    ];
    const r1 = applyPlaceholders(elements, detections);
    check("all sensitive values placeholdered",
      r1.sanitized.map((e) => e.text).join("/") === "PAN_1/PAN_1/EMAIL_1/NAME_1",
      r1.sanitized.map((e) => e.text).join("/"));
    check("same logical value -> same token (value-keyed)",
      r1.sanitized[0].text === r1.sanitized[1].text);
    check("real values isolated in local map only",
      r1.map["e-pan"] === "ABCDE1234F" && r1.map["e-mail"] === "arjun@example.com");
    check("tokens unique per category counter",
      new Set(Object.values(r1.sanitized.map((e) => e.text))).size >= 3);

    // Deterministic: identical inputs -> identical outputs.
    const r2 = applyPlaceholders(elements, detections);
    check("assignment deterministic for identical input",
      JSON.stringify(r1.sanitized) === JSON.stringify(r2.sanitized) &&
      JSON.stringify(r1.map) === JSON.stringify(r2.map));

    // Duplicate detection entries (same element+category twice).
    const dup = applyPlaceholders(elements, [...detections, det("e-pan", "PAN", [0, 0, 100, 20])]);
    check("duplicate detections collapse deterministically",
      JSON.stringify(dup.sanitized) === JSON.stringify(r1.sanitized));

    // Detection-input order must not change the sanitized output.
    const shuffled = applyPlaceholders(elements, [...detections].reverse());
    check("detection input order does not affect output",
      JSON.stringify(shuffled.sanitized) === JSON.stringify(r1.sanitized));

    // Mixed sources: DOM + vision FACE (synthetic id, no element) + OCR
    // finding on a real element. Every text-bearing finding must end
    // placeholdered; the elementless FACE must pass through untouched.
    const mixedElements = [
      ...elements,
      el("e-aadhaar", "input", [0, 120, 100, 20], { text: "1234 5678 9012" }),
    ];
    const mixed = applyPlaceholders(mixedElements, [
      ...detections,
      det("vision-0", "FACE", [10, 10, 50, 50], "vision", 0.9),
      det("e-aadhaar", "AADHAAR", [0, 120, 100, 20], "ocr", 0.8),
    ]);
    const aadhaar = mixed.sanitized.find((e) => e.element_id === "e-aadhaar");
    check("mixed DOM+vision+FACE+OCR sources all placeholdered",
      aadhaar?.text === "AADHAAR_1" &&
      mixed.map["e-aadhaar"] === "1234 5678 9012" &&
      mixed.sanitized[3].text === "NAME_1",
      `aadhaar=${aadhaar?.text}`);

    // Session reset: tokens restart, map cleared.
    resetPlaceholderTokens();
    const r3 = applyPlaceholders(elements, detections);
    check("resetPlaceholderTokens restarts counters (session scoping)",
      r3.sanitized[0].text === "PAN_1" && Object.keys(r3.map).length === 4);

    // Empty input.
    const empty = applyPlaceholders([], []);
    check("empty input -> empty output, no throw",
      empty.sanitized.length === 0 && Object.keys(empty.map).length === 0);

    // Malformed findings fail closed — never silently skipped.
    expectPrivacyError("malformed finding (NaN bbox) fails closed", "INVALID_GEOMETRY",
      () => applyPlaceholders(elements, [det("e-pan", "PAN", [0, NaN, 1, 1])]));

    // Stale detection: non-FACE finding without a backing element.
    expectPrivacyError("stale non-FACE detection fails closed (no un-placeholdered leak)", "INVALID_DETECTION",
      () => applyPlaceholders(elements, [det("e-ghost", "PAN", [0, 0, 1, 1])]),
      "ABCDE1234F");

    // FACE without element is the documented vision exception (pixel-only).
    const faceOnly = applyPlaceholders(elements, [det("vision-7", "FACE", [0, 0, 10, 10], "vision", 0.9)]);
    check("vision FACE without element accepted (pixel-only redaction)",
      faceOnly.sanitized.length === elements.length);
  }

  // ------------------------------------------------------------------ [3]
  console.log("\n[3] Visual redaction — pathological geometry");
  {
    const restore = installCanvasShims();
    try {
      const faceD = (bbox: unknown) =>
        [{ element_id: "v-0", category: "FACE", bbox, confidence: 0.9, source: "vision" } as Detection];

      // Normal box: output differs from input (something was painted).
      const normal = await redactVisual(F1, faceD([10, 10, 60, 60]), VIEWPORT.viewport);
      check("normal box paints (output != input)", normal !== F1);

      // Deterministic rounding: same fractional input -> identical output.
      const a = await redactVisual(F1, faceD([10.5, 10.5, 60.5, 60.5]), VIEWPORT.viewport);
      const b = await redactVisual(F1, faceD([10.5, 10.5, 60.5, 60.5]), VIEWPORT.viewport);
      check("fractional coordinates deterministic", a === b);

      // Fully outside canvas: nothing to paint, no throw.
      const outside = await redactVisual(F1, faceD([5000, 5000, 50, 50]), VIEWPORT.viewport);
      check("fully-outside box: clamped to no-op, no throw, no corruption", outside.length > 0);

      // Negative origin partially inside: clamps, no throw.
      const neg = await redactVisual(F1, faceD([-30, -30, 60, 60]), VIEWPORT.viewport);
      check("negative-origin box clamps, no throw", neg !== F1);

      // Overlapping boxes: both painted, no throw.
      const overlap = await redactVisual(
        F1,
        faceD([10, 10, 60, 60]).concat(faceD([30, 30, 60, 60])),
        VIEWPORT.viewport
      );
      check("overlapping boxes both painted, no throw", overlap !== F1);

      // Malformed geometry: FAIL CLOSED — throw, never a silently skipped
      // region (a skipped region means raw sensitive pixels cross the boundary).
      await (async () => {
        try {
          await redactVisual(F1, faceD([0, NaN, 10, 10]), VIEWPORT.viewport);
          check("NaN bbox fails closed", false, "did not throw");
        } catch (e) {
          check("NaN bbox fails closed", e instanceof PrivacyError && e.code === "INVALID_GEOMETRY");
        }
      })();
      await (async () => {
        try {
          await redactVisual(F1, faceD([0, 0, Infinity, 10]), VIEWPORT.viewport);
          check("Infinity bbox fails closed", false, "did not throw");
        } catch (e) {
          check("Infinity bbox fails closed", e instanceof PrivacyError && e.code === "INVALID_GEOMETRY");
        }
      })();
      await (async () => {
        try {
          await redactVisual(F1, faceD([0, 0, 0, 10]), VIEWPORT.viewport);
          check("zero-width bbox fails closed (not silently skipped)", false, "did not throw");
        } catch (e) {
          check("zero-width bbox fails closed (not silently skipped)",
            e instanceof PrivacyError && e.code === "INVALID_GEOMETRY");
        }
      })();
      await (async () => {
        try {
          await redactVisual(F1, faceD([0, 0, 10, -4]), VIEWPORT.viewport);
          check("negative-height bbox fails closed", false, "did not throw");
        } catch (e) {
          check("negative-height bbox fails closed",
            e instanceof PrivacyError && e.code === "INVALID_GEOMETRY");
        }
      })();
    } finally {
      restore();
    }
  }

  // ------------------------------------------------------------------ [4]
  console.log("\n[4] Trust boundary — vision path output is normalized");
  {
    const elements = [el("e-mail", "input", [0, 0, 100, 20], { text: "a@b.co", type: "email" })];

    const fakeDetector = (detections: unknown): FaceDetector => ({
      detect: async () => detections as Detection[],
      modelUrl: "",
    });

    // Malformed detector output (NaN bbox on a FACE) must reject the whole
    // path — never degrade to a partial/empty detection list.
    await (async () => {
      try {
        await runVisionPath({
          dataUrl: F1,
          elements,
          domDetections: [],
          viewport: VIEWPORT.viewport,
          loadDetector: () => Promise.resolve(fakeDetector([
            { element_id: "v-0", category: "FACE", bbox: [0, NaN, 10, 10], confidence: 0.9, source: "vision" },
          ])),
          decode: async () => ({ width: F1_DIMS.w, height: F1_DIMS.h, data: new Uint8ClampedArray(4) }),
        });
        check("malformed vision finding rejects the path (fail closed)", false, "did not throw");
      } catch (e) {
        check("malformed vision finding rejects the path (fail closed)",
          e instanceof PrivacyError && e.code === "INVALID_GEOMETRY");
      }
    })();

    // Smuggled extra field on an otherwise valid finding is dropped.
    const fused = await runVisionPath({
      dataUrl: F1,
      elements,
      domDetections: [],
      viewport: VIEWPORT.viewport,
      loadDetector: () => Promise.resolve(fakeDetector([
        { element_id: "v-0", category: "FACE", bbox: [10, 10, 40, 40], confidence: 0.9, source: "vision", text: "secret" },
      ])),
      decode: async () => ({ width: F1_DIMS.w, height: F1_DIMS.h, data: new Uint8ClampedArray(4) }),
    });
    check("vision output normalized: extra fields dropped",
      fused.every((d) => Object.keys(d).length === 5 && !("text" in d)) &&
      fused.some((d) => d.category === "FACE"),
      JSON.stringify(fused.map((d) => Object.keys(d))));
  }

  // ------------------------------------------------------------------ [5]
  console.log("\n[5] Outbound boundary — providers refuse unsanitized packages");
  {
    // assertSanitizedPackage rejections.
    const mustThrow = (name: string, pkg: unknown) => {
      try {
        assertSanitizedPackage(pkg as SanitizedPackage);
        check(name, false, "did not throw");
      } catch {
        check(name, true);
      }
    };
    mustThrow("raw CapturePackage fields refused", {
      ...validPackage(),
      tabId: 1, dataUrl: "data:image/png;base64,AAAA", detections: [],
    } as unknown);
    mustThrow("missing redacted provenance stamp refused",
      validPackage({ redacted: undefined as unknown as true }));
    mustThrow("PII in context element text refused",
      validPackage({
        sanitizedContext: {
          elements: [el("e-x", "input", [0, 0, 1, 1], { text: "ABCDE1234F" })],
          browserState: VIEWPORT,
        },
      }));
    mustThrow("PII in goal refused",
      validPackage({ goal: "type my PAN ABCDE1234F into the form" }));
    mustThrow("missing goal refused", validPackage({ goal: "" }));
    mustThrow("missing screenshot refused",
      validPackage({ sanitizedScreenshot: "" }));

    // Valid package passes.
    let ok = true;
    try {
      assertSanitizedPackage(validPackage());
    } catch {
      ok = false;
    }
    check("valid sanitized package accepted", ok);

    // A package constructed directly from a raw capture is refused.
    mustThrow("package built straight from CapturePackage refused", {
      goal: "g",
      sanitizedScreenshot: "data:image/png;base64,AAAA",
      sanitizedContext: {
        elements: [el("e-1", "input", [0, 0, 10, 10], { text: "arjun@example.com" })],
        browserState: VIEWPORT,
      },
      redacted: true,
    } as unknown); // PII tripwire catches the un-placeholdered value

    // Providers: unsanitized package must throw BEFORE any fetch happens.
    const rawPkg = {
      goal: "g",
      sanitizedScreenshot: "data:image/png;base64,AAAA",
      sanitizedContext: { elements: [], browserState: VIEWPORT },
      dataUrl: F1, // raw capture field
    } as unknown as SanitizedPackage;

    const providerCases: Array<[string, (fetchFn: typeof fetch) => Promise<unknown>]> = [
      ["queryOpenAI refuses unsanitized before fetch", (fetchFn) => queryOpenAI(rawPkg, { apiKey: "k", fetchFn })],
      ["queryGemini refuses unsanitized before fetch", (fetchFn) => queryGemini(rawPkg, { apiKey: "k", fetchFn })],
      ["queryServer refuses unsanitized before fetch", (fetchFn) => queryServer(rawPkg, { serverUrl: "http://x", fetchFn })],
    ];
    for (const [name, call] of providerCases) {
      let fetched = false;
      const fetchFn = (async () => {
        fetched = true;
        throw new Error("network must never be touched by an unsanitized package");
      }) as unknown as typeof fetch;
      try {
        await call(fetchFn);
        check(name, false, "did not throw");
      } catch {
        check(name, true);
      }
      check(`${name} — network never touched`, !fetched);
    }
  }

  // ------------------------------------------------------------------ [6]
  console.log("\n[6] Error semantics — stable codes, no raw values");
  {
    const e = new PrivacyError("INVALID_GEOMETRY", "detection e-x: bbox width must be positive");
    check("PrivacyError carries stable code + name",
      e.code === "INVALID_GEOMETRY" && e.name === "PrivacyError" && e.message.startsWith("PRIVIS_"));
    check("codes are a closed set for tests to assert on",
      ["INVALID_DETECTION", "INVALID_GEOMETRY", "INVALID_CATEGORY", "INVALID_SOURCE", "INVALID_CONFIDENCE"]
        .includes(e.code));

    // No raw value ever appears in a normalization error message.
    const rawPan = "ABCDE1234F";
    let leaked = false;
    try {
      normalizeDetection({ ...det("e-z", "PAN", [0, 0, 0, 0]), label: rawPan });
    } catch (err) {
      leaked = String((err as Error).message).includes(rawPan);
    }
    check("normalization errors never contain the raw value", !leaked);
  }

  // ------------------------------------------------------------------ [7]
  console.log("\n[7] Adversarial property checks (seeded, reproducible)");
  {
    const rand = rng(42); // fixed seed: adversarial cases are reproducible
    let geomContractHolds = true;
    let clampContractHolds = true;
    let normalizeContractHolds = true;
    const CANVAS = { w: F1_DIMS.w, h: F1_DIMS.h };

    for (let i = 0; i < 500; i++) {
      // Arbitrary box: possibly negative, fractional, huge, NaN-ish, reversed.
      const box: number[] = [
        (rand() - 0.5) * 3000,
        (rand() - 0.5) * 3000,
        (rand() - 0.5) * 2000,
        (rand() - 0.5) * 2000,
      ];
      if (rand() < 0.1) box[rand() < 0.5 ? 0 : 1] = NaN;
      if (rand() < 0.05) box[2] = Infinity;

      // Contract 1: assertValidBBox throws iff the box is structurally invalid.
      const finite = box.every((v) => typeof v === "number" && Number.isFinite(v));
      const positive = finite && box[2] > 0 && box[3] > 0;
      let threw = false;
      try {
        assertValidBBox(box);
      } catch {
        threw = true;
      }
      if (threw === (finite && positive)) geomContractHolds = false;

      // Contract 2: scaledClampedRect output is null or a positive rect fully
      // inside the canvas — for ANY input numbers (invalid ones are caught by
      // the assert first; here we only probe the pure clamp math).
      if (finite && positive) {
        const rect = scaledClampedRect(box, 1, 1, CANVAS.w, CANVAS.h);
        if (rect !== null) {
          if (!(rect.x >= 0 && rect.y >= 0 && rect.w > 0 && rect.h > 0 &&
                rect.x + rect.w <= CANVAS.w && rect.y + rect.h <= CANVAS.h)) {
            clampContractHolds = false;
          }
        }
      }

      // Contract 3: normalizeDetection either throws PrivacyError or returns
      // an exactly-5-field canonical Detection.
      const finding = {
        element_id: `e-${i}`,
        category: rand() < 0.5 ? "PAN" : "MYSTERY",
        bbox: box,
        confidence: rand() * 2 - 0.5,
        source: rand() < 0.5 ? "dom" : "nope",
      };
      try {
        const d = normalizeDetection(finding);
        if (Object.keys(d).length !== 5) normalizeContractHolds = false;
      } catch (err) {
        if (!(err instanceof PrivacyError)) normalizeContractHolds = false;
      }
    }
    check("500 random boxes: geometry contract holds exactly", geomContractHolds);
    check("500 random boxes: clamp output always within canvas or null", clampContractHolds);
    check("500 random findings: normalize throws PrivacyError or returns canonical shape", normalizeContractHolds);
  }

  if (failures.length === 0) {
    console.log("\nALL CHECKS PASSED");
  } else {
    console.error(`\nFAILED: ${failures.length} check(s)`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
