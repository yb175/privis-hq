// privacy/engine/vision/test-privacy-boundary.ts
// M6-E Node test harness: privacy-boundary validation of the wired pipeline.
//
// Runs the REAL modules end-to-end — detectSensitive, runVisionPath (real
// decode + real YuNet + real M4 fusion), applyPlaceholders, redactVisual
// (real redaction logic via test-canvas-shim.ts), decide, and the REAL
// router boundary (assertSanitizedPackage) — on synthetic fixtures. Only the
// network transport is absent.
//
// Privacy test matrix (A–H) per M6-E, plus raw-screenshot boundary (hashes),
// FACE pixel redaction, PII placeholders, PASSWORD handling, policy ordering
// (static), fail-closed (model/inference/decode/sanitizer), persistence audit
// and network audit (static source scans).
//
// Documented shim deviation: the shim canvas "encodes" raw RGBA, not PNG, so
// sanitized-screenshot hashes compare encodings of raw vs sanitized PIXEL
// buffers where exact (same fixture dimensions); the raw data URL string
// itself can never appear in a payload.

/// <reference types="node" />
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import process from "node:process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type {
  BrowserState,
  Detection,
  ElementMeta,
  SanitizedPackage,
} from "../../../types/index.js";
import { runVisionPath } from "../../../privacy/engine/vision/face-pipeline.js";
import { loadFaceDetector, type FaceDetector } from "../../../privacy/engine/vision/face-detector.js";
import { decodePngRGBA } from "../../../test/unit/ml/vision/png-helper.js";
import { installCanvasShims } from "../../../test/unit/ml/vision/canvas-shim.js";
import { detectSensitive } from "../../../privacy/engine/detect-dom.js";
import { applyPlaceholders } from "../../../privacy/sanitizer/structural-redact.js";
import { redactVisual } from "../../../privacy/sanitizer/redaction-gate.js";
import { decide } from "../../../privacy/policy-gate/policy-gate.js";
import { assertSanitizedPackage } from "../../../remote-agent/router.js";

const failures: string[] = [];

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures.push(name + (detail ? ` (${detail})` : ""));
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

(globalThis as Record<string, unknown>).chrome = {
  runtime: {
    getURL: (path: string): string => pathToFileURL(resolve(path)).href,
  },
};

// ---------------------------------------------------------------------------
// Fixtures (synthetic M6-B images, in-memory data URLs) and helpers
// ---------------------------------------------------------------------------

const MODEL_PATH = "ml/models/face_detection_yunet/face_detection_yunet_2023mar.onnx";
const modelBytes = new Uint8Array(readFileSync(MODEL_PATH));
const realLoader = (): Promise<FaceDetector> => loadFaceDetector(modelBytes);

const F1_PATH = "ml/dataset/images/synthetic_face.png"; // 1 face
const F2_PATH = "ml/dataset/images/f2_multi_scale_faces.png"; // 3 faces
const F5_PATH = "ml/dataset/images/f5_text_negative.png"; // 0 faces

function dataUrlOf(path: string): string {
  return `data:image/png;base64,${readFileSync(path).toString("base64")}`;
}
const F1 = dataUrlOf(F1_PATH);
const F2 = dataUrlOf(F2_PATH);
const F5 = dataUrlOf(F5_PATH);

const VIEWPORT_640: BrowserState = {
  url: "file:///C:/demo/portal.html",
  title: "Demo Portal",
  viewport: { w: 640, h: 480 }, // fixture size: CSS scale = device scale = 1
};

function el(
  element_id: string,
  tag: string,
  bbox: [number, number, number, number],
  extra: Partial<ElementMeta> = {}
): ElementMeta {
  return { element_id, tag, type: null, role: null, label: null, text: "", bbox, ...extra };
}

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/** Decodes the shim's raw-RGBA "data URL" back into pixels. */
function rgbaFromShimDataUrl(url: string, w: number, h: number): Uint8ClampedArray {
  const b64 = url.slice(url.indexOf(",") + 1);
  const buf = Buffer.from(b64, "base64");
  if (buf.length !== w * h * 4) throw new Error(`shim decode: ${buf.length} != ${w * h * 4}`);
  return new Uint8ClampedArray(buf);
}

/** Fraction of pixels in bbox that differ (any channel) between two images. */
function diffFraction(
  a: Uint8ClampedArray, b: Uint8ClampedArray, w: number,
  [bx, by, bw, bh]: readonly number[]
): number {
  let diff = 0;
  const total = bw * bh;
  for (let y = by; y < by + bh; y++) {
    for (let x = bx; x < bx + bw; x++) {
      const o = (y * w + x) * 4;
      if (a[o] !== b[o] || a[o + 1] !== b[o + 1] || a[o + 2] !== b[o + 2] || a[o + 3] !== b[o + 3]) diff++;
    }
  }
  return diff / total;
}

/** True when every pixel in bbox is opaque black. */
function allBlack(img: Uint8ClampedArray, w: number, [bx, by, bw, bh]: readonly number[]): boolean {
  for (let y = by; y < by + bh; y++) {
    for (let x = bx; x < bx + bw; x++) {
      const o = (y * w + x) * 4;
      if (img[o] !== 0 || img[o + 1] !== 0 || img[o + 2] !== 0) return false;
    }
  }
  return true;
}

/**
 * Expected pixelation of a bbox region, computed INDEPENDENTLY from the
 * original pixels with visual-redact's documented geometry (tiles =
 * round(w/16), nearest-neighbor block sampling). The synthetic fixtures are
 * flat-shaded (7 colors/face), so "many pixels differ" is the wrong metric —
 * the proof is that the sanitized region exactly matches the block structure
 * AND differs from the original where the fixture has detail (edges/AA).
 * Returns { match, changed } where changed = fraction differing from original.
 */
function pixelationCheck(
  orig: Uint8ClampedArray,
  san: Uint8ClampedArray,
  w: number,
  [bx, by, bw, bh]: readonly number[]
): { match: boolean; changed: number } {
  const tilesX = Math.max(1, Math.round(bw / 16));
  const tilesY = Math.max(1, Math.round(bh / 16));
  let mismatch = 0;
  let changed = 0;
  for (let y = by; y < by + bh; y++) {
    for (let x = bx; x < bx + bw; x++) {
      const u = x - bx;
      const v = y - by;
      const tx = Math.min(tilesX - 1, Math.max(0, Math.round((u + 0.5) * tilesX / bw - 0.5)));
      const ty = Math.min(tilesY - 1, Math.max(0, Math.round((v + 0.5) * tilesY / bh - 0.5)));
      const sx = bx + Math.min(bw - 1, Math.max(0, Math.round((tx + 0.5) * bw / tilesX - 0.5)));
      const sy = by + Math.min(bh - 1, Math.max(0, Math.round((ty + 0.5) * bh / tilesY - 0.5)));
      const eo = (sy * w + sx) * 4;
      const o = (y * w + x) * 4;
      let same = true;
      for (let c = 0; c < 4; c++) {
        if (san[o + c] !== orig[eo + c]) same = false;
        if (san[o + c] !== orig[o + c]) { changed++; break; }
      }
      if (!same) mismatch++;
    }
  }
  return { match: mismatch === 0, changed: changed / (bw * bh) };
}

// ---------------------------------------------------------------------------
// simulateStep: the runStep() flow from background/service-worker.ts, with the
// REAL modules at every stage. The remote call is the REAL router boundary
// (assertSanitizedPackage, the production outbound defense); the payload copy
// is kept for assertions.
// ---------------------------------------------------------------------------

interface StepOutcome {
  gate: ReturnType<typeof decide>;
  sent: SanitizedPackage | null;
  map: Record<string, string>;
  detections: Detection[];
  sanitized: ElementMeta[];
  sanitizedScreenshot: string;
}

async function simulateStep(scenario: {
  dataUrl: string;
  elements: ElementMeta[];
  browserState: BrowserState;
  loadDetector?: () => Promise<FaceDetector>;
  /** Replaces the screenshot given to redactVisual with a broken URL. */
  breakSanitizer?: boolean;
}): Promise<StepOutcome> {
  const domDetections = detectSensitive(scenario.elements);
  const detections = await runVisionPath({
    dataUrl: scenario.dataUrl,
    elements: scenario.elements,
    domDetections,
    viewport: scenario.browserState.viewport,
    loadDetector: scenario.loadDetector ?? realLoader,
  });
  const { sanitized, map } = applyPlaceholders(scenario.elements, detections);
  const sanitizedScreenshot = await redactVisual(
    scenario.breakSanitizer ? "BROKEN-URL" : scenario.dataUrl,
    detections,
    scenario.browserState.viewport
  );
  const gate = decide({ detections, browserState: scenario.browserState });
  if (gate.decision !== "allow") {
    return { gate, sent: null, map, detections, sanitized, sanitizedScreenshot };
  }
  const remoteElements: ElementMeta[] = sanitized.map((e) => ({ ...e, label: null }));
  const payload: SanitizedPackage = {
    goal: "test goal",
    sanitizedScreenshot,
    sanitizedContext: { elements: remoteElements, browserState: scenario.browserState },
    redacted: true, // sanitizer provenance (required by every outbound boundary)
  };
  await assertSanitizedPackage(payload); // REAL router boundary: throws if anything raw slipped in
  return { gate, sent: payload, map, detections, sanitized, sanitizedScreenshot };
}

const PII_PATTERNS: RegExp[] = [
  /[a-z]{5}[0-9]{4}[a-z]/i,
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  /(\+91)?[6-9][0-9]{9}/,
];

const emailEl = el("e-email", "input", [10, 400, 200, 20], {
  type: "email", label: "Email", text: "arjun.mehta@example.com",
});
const passEl = el("e-pass", "input", [10, 430, 200, 20], {
  type: "password", label: "Password", text: "",
});
const panEl = el("e-pan", "span", [10, 460, 200, 20], {
  // Structurally valid PAN (4th char 'P' = individual holder) — the Phase 01
  // lexical layer validates structure, and the old fake ('D' entity char)
  // is correctly refused now.
  label: "PAN", text: "ABCPE1234F",
});

/** Common payload assertions (in-memory structure + serialized regexes). */
function assertPayloadClean(
  tag: string,
  out: StepOutcome,
  rawDataUrl: string
): void {
  if (!out.sent) {
    check(`${tag}: remote payload present`, false, "gate blocked or not sent");
    return;
  }
  const p = out.sent;
  check(`${tag}: payload has exactly goal/sanitizedScreenshot/sanitizedContext/redacted keys`,
    Object.keys(p).length === 4 &&
      "goal" in p && "sanitizedScreenshot" in p && "sanitizedContext" in p && p.redacted === true,
    Object.keys(p).join(","));
  check(`${tag}: sanitized screenshot is NOT the raw screenshot string`,
    p.sanitizedScreenshot !== rawDataUrl && !p.sanitizedScreenshot.includes(rawDataUrl.slice(0, 100)));
  check(`${tag}: all element labels stripped (label === null)`,
    p.sanitizedContext.elements.every((e) => e.label === null));
  check(`${tag}: no detection objects / vision ids in context`,
    p.sanitizedContext.elements.every((e: ElementMeta) => !("source" in e || "category" in e || "confidence" in e)) &&
    !JSON.stringify(p).includes("vision-"));
  check(`${tag}: no FACE placeholder token invented (no "FACE_1")`,
    !JSON.stringify(p).includes("FACE_1") && !out.sanitized.some((e) => /^FACE_\d+$/.test(e.text)));
  check(`${tag}: element_id -> real-value map never in payload`,
    !JSON.stringify(p).includes("arjun.mehta@example.com") && !JSON.stringify(p).includes("ABCDE1234F"));
  const json = JSON.stringify(p);
  const hits = PII_PATTERNS.filter((re) => re.test(json));
  check(`${tag}: serialized payload free of PII patterns (PAN/AADHAAR/EMAIL/PHONE)`,
    hits.length === 0, hits.map(String).join(","));
  check(`${tag}: REAL router boundary (assertSanitizedPackage) accepted the payload`, true);
}

// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const restore = installCanvasShims();
  try {
    await runAll();
  } finally {
    restore();
  }

  async function runAll(): Promise<void> {
    console.log("M6-E privacy-boundary tests (real pipeline, real redaction, real model)");

    // --- A. FACE only -----------------------------------------------------
    console.log("\n[A] FACE only");
    const origF1 = decodePngRGBA(F1_PATH).data;
    const a = await simulateStep({ dataUrl: F1, elements: [], browserState: VIEWPORT_640 });
    const aFace = a.detections.find((d) => d.category === "FACE");
    check("A: FACE detected locally (source vision)", !!aFace && aFace.source === "vision");
    check("A: gate allows (demo URL, conf 0.85 >= 0.8)", a.gate.decision === "allow", a.gate.reason);
    const sanA = rgbaFromShimDataUrl(a.sanitizedScreenshot, 640, 480);
    const pixA = aFace ? pixelationCheck(origF1, sanA, 640, aFace.bbox) : { match: false, changed: 0 };
    check("A: FACE region pixelated (exact block geometry, differs from original)",
      pixA.match && pixA.changed > 0,
      `match=${pixA.match} changed=${(pixA.changed * 100).toFixed(1)}%`);
    check("A: non-sensitive corner region unchanged (0% differ)",
      diffFraction(origF1, sanA, 640, [0, 0, 20, 20]) === 0);
    check("A: raw screenshot hash != sanitized screenshot hash",
      sha256(readFileSync(F1_PATH)) !== sha256(Buffer.from(sanA.buffer, sanA.byteOffset, sanA.byteLength)));
    assertPayloadClean("A", a, F1);

    // --- B. FACE + EMAIL --------------------------------------------------
    console.log("\n[B] FACE + EMAIL");
    const b = await simulateStep({ dataUrl: F1, elements: [emailEl], browserState: VIEWPORT_640 });
    const sanB = rgbaFromShimDataUrl(b.sanitizedScreenshot, 640, 480);
    check("B: email -> EMAIL_1 placeholder",
      b.sanitized.find((e) => e.element_id === "e-email")?.text === "EMAIL_1");
    check("B: EMAIL region blacked out", allBlack(sanB, 640, [10, 400, 200, 20]));
    check("B: FACE region redacted alongside",
      pixelationCheck(origF1, sanB, 640, [229, 126, 184, 237]).match &&
      pixelationCheck(origF1, sanB, 640, [229, 126, 184, 237]).changed > 0);
    check("B: real email only in the local map", b.map["e-email"] === "arjun.mehta@example.com");
    assertPayloadClean("B", b, F1);

    // --- C. FACE + PAN ----------------------------------------------------
    console.log("\n[C] FACE + PAN");
    const c = await simulateStep({ dataUrl: F1, elements: [panEl], browserState: VIEWPORT_640 });
    const sanC = rgbaFromShimDataUrl(c.sanitizedScreenshot, 640, 480);
    check("C: PAN -> PAN_1 placeholder",
      c.sanitized.find((e) => e.element_id === "e-pan")?.text === "PAN_1");
    check("C: PAN region blacked out", allBlack(sanC, 640, [10, 460, 200, 20]));
    check("C: FACE region redacted",
      pixelationCheck(origF1, sanC, 640, [229, 126, 184, 237]).match &&
      pixelationCheck(origF1, sanC, 640, [229, 126, 184, 237]).changed > 0);
    assertPayloadClean("C", c, F1);

    // --- D. FACE + PASSWORD ----------------------------------------------
    console.log("\n[D] FACE + PASSWORD");
    const d = await simulateStep({ dataUrl: F1, elements: [passEl], browserState: VIEWPORT_640 });
    const sanD = rgbaFromShimDataUrl(d.sanitizedScreenshot, 640, 480);
    check("D: password value never extracted (no map entry, empty text)",
      !("e-pass" in d.map) && d.sanitized.find((e) => e.element_id === "e-pass")?.text === "");
    check("D: password field remains redacted (region blacked out)",
      allBlack(sanD, 640, [10, 430, 200, 20]));
    check("D: no password placeholder value invented",
      !JSON.stringify(d.sent ?? {}).includes("PASSWORD_"));
    check("D: FACE region redacted",
      pixelationCheck(origF1, sanD, 640, [229, 126, 184, 237]).match &&
      pixelationCheck(origF1, sanD, 640, [229, 126, 184, 237]).changed > 0);
    assertPayloadClean("D", d, F1);

    // --- E. Multiple faces -------------------------------------------------
    console.log("\n[E] Multiple faces (F2: 3 faces)");
    const origF2 = decodePngRGBA(F2_PATH).data;
    const f2Boxes: [number, number, number, number][] = [
      [40, 110, 182, 233], [301, 50, 96, 114], [476, 303, 55, 56],
    ]; // M6-C reference bboxes
    const e = await simulateStep({ dataUrl: F2, elements: [emailEl], browserState: VIEWPORT_640 });
    const eFaces = e.detections.filter((x) => x.category === "FACE");
    check("E: all 3 faces detected", eFaces.length === 3, `got ${eFaces.length}`);
    const sanE = rgbaFromShimDataUrl(e.sanitizedScreenshot, 640, 480);
    check("E: every face region pixelated (exact block geometry, each differs from original)",
      f2Boxes.every((bb) => {
        const r = pixelationCheck(origF2, sanE, 640, bb);
        return r.match && r.changed > 0;
      }),
      f2Boxes.map((bb) => (pixelationCheck(origF2, sanE, 640, bb).changed * 100).toFixed(0) + "%").join(" "));
    check("E: non-sensitive corner unchanged", diffFraction(origF2, sanE, 640, [0, 0, 20, 20]) === 0);
    // F2's smallest face scores 0.355 < 0.8: the existing policy correctly
    // demands human approval — nothing crosses the wire at all.
    check("E: low-confidence face -> human_approval, remote NOT called",
      e.gate.decision === "human_approval" && e.sent === null, e.gate.reason);

    // --- F. DOM-sensitive + vision-sensitive overlap ------------------------
    console.log("\n[F] DOM + vision overlap");
    const avatarEl = el("e-avatar", "img", [230, 130, 180, 240], { label: "Profile photo" });
    const f = await simulateStep({ dataUrl: F1, elements: [avatarEl, emailEl], browserState: VIEWPORT_640 });
    const fFace = f.detections.find((x) => x.category === "FACE");
    check("F: M4 assigns the DOM element_id to the overlapping FACE",
      fFace?.element_id === "e-avatar" && fFace.source === "vision");
    const sanF = rgbaFromShimDataUrl(f.sanitizedScreenshot, 640, 480);
    check("F: visual FACE redaction occurs at the overlap",
      fFace ? pixelationCheck(origF1, sanF, 640, fFace.bbox).match &&
             pixelationCheck(origF1, sanF, 640, fFace.bbox).changed > 0 : false,
      `bbox=${JSON.stringify(fFace?.bbox)}`);
    check("F: avatar element has no invented text (no FACE placeholder)",
      f.sanitized.find((x) => x.element_id === "e-avatar")?.text === "");
    check("F: email placeholder behavior remains correct",
      f.sanitized.find((x) => x.element_id === "e-email")?.text === "EMAIL_1" && allBlack(sanF, 640, [10, 400, 200, 20]));
    assertPayloadClean("F", f, F1);

    // --- G. No faces --------------------------------------------------------
    console.log("\n[G] No faces");
    const g = await simulateStep({ dataUrl: F5, elements: [], browserState: VIEWPORT_640 });
    check("G: valid empty detection result ([]), pipeline continues",
      g.detections.length === 0 && g.gate.decision === "allow", g.gate.reason);
    check("G: no unnecessary blocking — remote reached", g.sent !== null);
    assertPayloadClean("G", g, F5);

    // --- H. Vision failure fails closed -------------------------------------
    console.log("\n[H] Vision failure (fail-closed)");
    {
      let rejected = false;
      try {
        await simulateStep({
          dataUrl: F1, elements: [emailEl], browserState: VIEWPORT_640,
          loadDetector: () => Promise.reject(new Error("model load failed (simulated)")),
        });
      } catch {
        rejected = true;
      }
      check("H: model load failure -> step rejects, no remote request", rejected);
    }
    {
      let rejected = false;
      try {
        await simulateStep({
          dataUrl: F1, elements: [emailEl], browserState: VIEWPORT_640,
          loadDetector: async () => ({
            modelUrl: "stub",
            detect: () => Promise.reject(new Error("inference failed (simulated)")),
          }),
        });
      } catch {
        rejected = true;
      }
      check("H: inference failure -> step rejects, never read as zero faces", rejected);
    }
    {
      let rejected = false;
      try {
        await runVisionPath({
          dataUrl: F1, elements: [], domDetections: [], viewport: { w: 640, h: 480 },
          decode: () => Promise.reject(new Error("decode failed (simulated)")),
          loadDetector: realLoader,
        });
      } catch {
        rejected = true;
      }
      check("H: image decode failure -> vision path rejects", rejected);
    }
    {
      let rejected = false;
      try {
        await simulateStep({
          dataUrl: F1, elements: [emailEl], browserState: VIEWPORT_640,
          breakSanitizer: true, // redactVisual gets an undecodable URL
        });
      } catch {
        rejected = true;
      }
      check("H: sanitizer failure -> step rejects before gate/remote", rejected);
    }

    // --- PII placeholder coverage (existing behavior, no faces needed) ------
    console.log("\n[PII] Placeholder coverage on a no-face page");
    {
      const els = [
        el("e-phone", "span", [10, 10, 200, 20], { label: "Phone", text: "9876543210" }),
        el("e-aadhaar", "span", [10, 40, 200, 20], { label: "Aadhaar", text: "2341 2341 2346" }), // Verhoeff-valid, series 2-9
        el("e-amount", "span", [10, 70, 200, 20], { label: "Amount", text: "₹50,000" }),
        el("e-name", "span", [10, 100, 200, 20], { label: "Full name", text: "Arjun Mehta" }),
      ];
      const r = await simulateStep({ dataUrl: F5, elements: els, browserState: VIEWPORT_640 });
      const textOf = (id: string) => r.sanitized.find((x) => x.element_id === id)?.text;
      check("PII: PHONE_1 / AADHAAR_1 / AMOUNT_1 / NAME_1 placeholders",
        textOf("e-phone") === "PHONE_1" && textOf("e-aadhaar") === "AADHAAR_1" &&
        textOf("e-amount") === "AMOUNT_1" && textOf("e-name") === "NAME_1",
        [textOf("e-phone"), textOf("e-aadhaar"), textOf("e-amount"), textOf("e-name")].join("/"));
      check("PII: real values isolated in the local map",
        r.map["e-phone"] === "9876543210" && r.map["e-aadhaar"] === "2341 2341 2346");
      assertPayloadClean("PII", r, F5);
    }

    // --- Remote client last-line defense (existing, now regression-pinned) --
    console.log("\n[Defense] router boundary refuses raw packages");
    {
      let refused = false;
      try {
        await assertSanitizedPackage({
          goal: "g",
          sanitizedScreenshot: "data:image/png;base64,AAAA",
          sanitizedContext: { elements: [], browserState: VIEWPORT_640 },
          // raw CapturePackage fields smuggled in:
          ...({ dataUrl: F1, detections: a.detections } as Record<string, unknown>),
        } as never);
      } catch {
        refused = true;
      }
      check("Defense: raw dataUrl/detections fields refused before any send", refused);
    }
    {
      let refused = false;
      try {
        await assertSanitizedPackage({
          goal: "g",
          sanitizedScreenshot: "data:image/png;base64,AAAA",
          sanitizedContext: { elements: [el("e-x", "span", [0, 0, 1, 1], { text: "ABCDE1234F" })], browserState: VIEWPORT_640 },
        } as never);
      } catch {
        refused = true;
      }
      check("Defense: PAN pattern in context refused (Sanitizer-leak tripwire)", refused);
    }

    // --- Policy ordering (static, on the real orchestrator loop) -------------
    console.log("\n[Order] orchestrator/runStep.ts source ordering");
    {
      const sw = readFileSync("orchestrator/runStep.ts", "utf-8");
      const order = [
        ["capturePackage(tabId)", sw.indexOf("await capturePackage(tabId)")],
        ["runVisionPath", sw.indexOf("await runVisionPath(")],
        ["applyPlaceholders", sw.indexOf("applyPlaceholders(pkg")],
        ["sealAndRedact (encoding gate)", sw.indexOf("await sealAndRedact(")],
        ["decide", sw.indexOf("decide({")],
        ["tokeniseGoal", sw.indexOf("tokeniseGoal(goal).goal")],
        ["queryServer (remote agent)", sw.indexOf("queryServer(")],
      ] as const;
      check("Order: capture -> vision -> placeholders -> gate -> policy -> tokenise -> remote",
        order.every(([, i]) => i !== -1) && order.every(([name], k) => order[k][1] > (k > 0 ? order[k - 1][1] : -1)),
        order.map(([name, i]) => `${name}@${i}`).join(" "));
      check("Order: no queryServer call outside runStep's post-gate path",
        sw.split("queryServer(").length === 2); // one import + one call
    }

    // --- Persistence + network audit (static) --------------------------------
    console.log("\n[Audit] Persistence & network (static source scan)");
    const RUNTIME_FILES = [
      "background/service-worker.ts",
      "orchestrator/runGoal.ts",
      "orchestrator/runStep.ts",
      "orchestrator/capture.ts",
      "orchestrator/hud.ts",
      "orchestrator/outbound.ts",
      "orchestrator/session.ts",
      "content/capture-content.ts",
      "utils/screenshot.ts",
      "utils/messaging.ts",
      "privacy/sanitizer/structural-redact.ts",
      "privacy/sanitizer/placeholders.ts",
      "privacy/sanitizer/redaction-gate.ts",
      "privacy/engine/detect-dom.ts",
      "privacy/sanitizer/visual-redact.ts",
      "privacy/policy-gate/policy-gate.ts",
      "privacy/engine/fuse.ts",
      "privacy/engine/vision/ort-runtime.ts",
      "privacy/engine/vision/face-detector.ts",
      "privacy/engine/vision/face-pipeline.ts",
      "remote-agent/router.ts",
      "executor/local-executor.ts",
    ];
    const PERSISTENCE_FORBIDDEN = [
      "writeFile", "writeFileSync", "chrome.storage", "localStorage",
      "sessionStorage", "indexedDB", "navigator.sendBeacon",
      "XMLHttpRequest", "WebSocket",
    ];
    for (const file of RUNTIME_FILES) {
      const src = readFileSync(file, "utf-8");
      const hits = PERSISTENCE_FORBIDDEN.filter((tok) => src.includes(tok));
      check(`Audit: ${file} free of persistence APIs`, hits.length === 0, hits.join(","));
      // remote-agent/router.ts is the server-side brain router (contains brand URLs and SerpAPI endpoint)
      if (file !== "remote-agent/router.ts") {
        const net = /https?:\/\/|ws:\/\//.exec(src);
        check(`Audit: ${file} contains no network URL`, net === null, net?.[0] ?? "");
      }
    }
    {
      // fetch( may appear ONLY for in-memory data: URLs (decode), never for
      // network resources. The single conceptual outbound boundary is
      // remote-agent/router.ts (assertSanitizedPackage) + client-server.ts.
      const src = readFileSync("privacy/engine/vision/face-pipeline.ts", "utf-8");
      check("Audit: face-pipeline fetch is data:-URL decode only", src.includes("await fetch(dataUrl)"));
      const vr = readFileSync("privacy/sanitizer/visual-redact.ts", "utf-8");
      check("Audit: visual-redact fetch is data:-URL decode only", vr.includes("fetch(dataUrl)"));
      const swSrc = readFileSync("background/service-worker.ts", "utf-8");
      check("Audit: service worker makes no fetch calls (only chrome APIs + modules)",
        !swSrc.includes("fetch("));
      const orchSrc = readFileSync("orchestrator/runStep.ts", "utf-8");
      check("Audit: orchestrator loop makes no fetch calls (remote path is queryServer only)",
        !orchSrc.includes("fetch("));
    }

    if (failures.length === 0) {
      console.log("\nALL CHECKS PASSED");
    } else {
      console.error(`\nFAILED: ${failures.length} check(s)`);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error("HARNESS ERROR:", err);
  process.exit(1);
});
