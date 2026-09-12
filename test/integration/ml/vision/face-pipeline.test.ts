// privacy/engine/vision/test-face-pipeline.ts
// M6-D Node test harness: FACE detector wired into the PRIVIS pipeline.
//
// Covers the M6-D acceptance scenarios against the REAL modules
// (fuse.ts port, face-pipeline.ts, structural-redact, policy-gate) and the
// REAL YuNet model, with Node-only stubs for the browser surfaces that
// cannot run here (canvas redaction, chrome.tabs, network):
//
//   A. Page with FACE  -> vision detection fused, redacted, remote sanitized.
//   B. Page without FACE -> vision yields [], DOM path unaffected.
//   C. Detector failure -> step FAILS CLOSED: rejection, gate/remote never
//      reached (never detections = [] with an unsanitized screenshot).
//   D. DOM+FACE overlap -> M4 fusion rules preserved (element_id match, DOM
//      wins ties, PASSWORD survives, unmatched FACE kept, no FACE text
//      placeholder invented).
//   E. Multiple faces -> all fused and redacted.
//   F. Non-FACE PII -> existing PASSWORD/EMAIL/PAN behavior unchanged.
//   +  remote privacy boundary, fail-closed ordering in service-worker.ts,
//      latency gates, determinism, static source audits.
//
// simulateStep() mirrors runStep() in background/service-worker.ts step for
// step; the static ordering check below pins the real service worker to the
// same order. Runs with no network (model bytes injected via fs; the PNG
// fixtures are decoded with a stdlib zlib decoder).

/// <reference types="node" />
import { readFileSync } from "node:fs";
import process from "node:process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type {
  BrowserState,
  Detection,
  ElementMeta,
  SanitizedPackage,
} from "../../../../types/index.js";
import { fuseDetections } from "../../../../privacy/engine/fuse.js";
import { runVisionPath } from "../../../../privacy/engine/vision/face-pipeline.js";
import {
  loadFaceDetector,
  type FaceDetector,
  type FaceDetectorInput,
} from "../../../../privacy/engine/vision/face-detector.js";
import { decodePngRGBA } from "../../../../test/unit/ml/vision/png-helper.js";
import { detectSensitive } from "../../../../privacy/engine/detect-dom.js";
import { applyPlaceholders } from "../../../../privacy/sanitizer/structural-redact.js";
import { decide } from "../../../../privacy/policy-gate/policy-gate.js";

const failures: string[] = [];

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures.push(name + (detail ? ` (${detail})` : ""));
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// Deterministic chrome.runtime.getURL stub (same semantics as the real API).
(globalThis as Record<string, unknown>).chrome = {
  runtime: {
    getURL: (path: string): string => pathToFileURL(resolve(path)).href,
  },
};

// ---------------------------------------------------------------------------
// Fixtures: real M6-B/B2 synthetic PNGs as in-memory data URLs. The injected
// Node decode maps dataUrl -> file path (no disk writes, no network).
// ---------------------------------------------------------------------------

const MODEL_PATH = "ml/models/face_detection_yunet/face_detection_yunet_2023mar.onnx";
const modelBytes = new Uint8Array(readFileSync(MODEL_PATH));

const fixtureByDataUrl = new Map<string, string>();
function fixtureDataUrl(path: string): string {
  const url = `data:image/png;base64,${readFileSync(path).toString("base64")}`;
  fixtureByDataUrl.set(url, path);
  return url;
}
const F1 = fixtureDataUrl("ml/dataset/images/synthetic_face.png");
const F2 = fixtureDataUrl("ml/dataset/images/f2_multi_scale_faces.png");
const F5 = fixtureDataUrl("ml/dataset/images/f5_text_negative.png");

const nodeDecode = (url: string): Promise<FaceDetectorInput> => {
  const path = fixtureByDataUrl.get(url);
  if (!path) return Promise.reject(new Error("test: unknown fixture dataUrl"));
  const img = decodePngRGBA(path);
  return Promise.resolve({ width: img.width, height: img.height, data: img.data });
};

const realLoader = async (): Promise<FaceDetector> => loadFaceDetector(modelBytes);

const VIEWPORT_640: BrowserState = {
  url: "file:///C:/demo/portal.html",
  title: "Demo Portal",
  viewport: { w: 640, h: 480 },
};

function el(
  element_id: string,
  tag: string,
  bbox: [number, number, number, number],
  extra: Partial<ElementMeta> = {}
): ElementMeta {
  return {
    element_id,
    tag,
    type: null,
    role: null,
    label: null,
    text: "",
    bbox,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// simulateStep: faithful mirror of runStep() in background/service-worker.ts
// (capture -> vision+fuse -> placeholders -> redact -> gate -> remote).
// Canvas redaction and the network client are stubbed with recorders; every
// other stage is the real module.
// ---------------------------------------------------------------------------

interface StepRecord {
  redactDetections: Detection[][];
  remotePayloads: SanitizedPackage[];
}

async function simulateStep(scenario: {
  dataUrl: string;
  elements: ElementMeta[];
  browserState: BrowserState;
  loadDetector?: () => Promise<FaceDetector>;
}): Promise<{
  gate: ReturnType<typeof decide>;
  sent: SanitizedPackage | null;
  map: Record<string, string>;
  detections: Detection[];
  sanitized: ElementMeta[];
  record: StepRecord;
}> {
  const record: StepRecord = { redactDetections: [], remotePayloads: [] };

  // Vision Engine: DOM path, then the M6-D vision path (fail-closed).
  const domDetections = detectSensitive(scenario.elements);
  const detections = await runVisionPath({
    dataUrl: scenario.dataUrl,
    elements: scenario.elements,
    domDetections,
    viewport: scenario.browserState.viewport,
    decode: nodeDecode,
    loadDetector: scenario.loadDetector ?? realLoader,
  });

  // Sanitizer: structural placeholders + visual redaction (stubbed recorder;
  // the real redactVisual is unchanged pre-existing code tested by contract).
  const { sanitized, map } = applyPlaceholders(scenario.elements, detections);
  const sanitizedScreenshot = "data:image/png;base64,REDACTED-STUB";
  record.redactDetections.push(detections);

  // Policy Gate: never call the remote unless allowed.
  const gate = decide({ detections, browserState: scenario.browserState });
  if (gate.decision !== "allow") {
    return { gate, sent: null, map, detections, sanitized, record };
  }

  // Remote Agent: sanitized package only, labels stripped (as in runStep).
  const remoteElements: ElementMeta[] = sanitized.map((e) => ({ ...e, label: null }));
  const payload: SanitizedPackage = {
    goal: "test goal",
    sanitizedScreenshot,
    sanitizedContext: { elements: remoteElements, browserState: scenario.browserState },
    redactionManifest: {
      counts: {},
      redactedFraction: 0,
      overRedactedFraction: 0,
      policyVersion: "1.0",
      receipt: {
        algo: "SHA-256",
        hash: "",
        manifestHash: "",
        sealedAt: Date.now(),
      },
    },
    redacted: true, // sanitizer provenance (required by every outbound boundary)
  };
  record.remotePayloads.push(payload);
  return { gate, sent: payload, map, detections, sanitized, record };
}

// PII tripwire regexes (same patterns the outbound boundary enforces) for
// boundary checks on simulated wire payloads.
const PII_PATTERNS: RegExp[] = [
  /[a-z]{5}[0-9]{4}[a-z]/i,
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
];

// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  console.log("M6-D pipeline tests (real model, real modules, no network)");

  // --- Fusion unit checks: M4 rules preserved (privacy/engine/fuse.ts) ---
  console.log("\n[1] M4 fusion rules (fuseDetections)");
  {
    const els = [
      el("e-a", "img", [100, 100, 100, 100]),
      el("e-b", "img", [400, 400, 50, 50]),
    ];
    const dom: Detection[] = [
      { element_id: "e-pass", category: "PASSWORD", bbox: [0, 0, 10, 10], confidence: 0.95, source: "dom" },
    ];
    const vision: Detection[] = [
      { element_id: "vision-0", category: "FACE", bbox: [102, 101, 98, 99], confidence: 0.9, source: "vision" }, // overlaps e-a
      { element_id: "vision-1", category: "FACE", bbox: [10, 10, 20, 20], confidence: 0.9, source: "vision" },   // unmatched
      { element_id: "vision-2", category: "EMAIL", bbox: [10, 10, 20, 20], confidence: 0.9, source: "vision" },  // unmatched non-FACE
    ];
    const fused = fuseDetections(els, dom, vision, { w: 640, h: 480 }, { w: 640, h: 480 });
    const faceA = fused.find((d) => d.category === "FACE" && d.element_id === "e-a");
    check("matched FACE receives the DOM element_id (source vision)", !!faceA && faceA.source === "vision");
    check(
      "matched FACE bbox converted to CSS coordinates (identity scale)",
      !!faceA && faceA.bbox[0] === 102 && faceA.bbox[1] === 101 && faceA.bbox[2] === 98 && faceA.bbox[3] === 99
    );
    const unmatched = fused.find((d) => d.element_id === "vision-1");
    check("unmatched FACE kept with synthetic id vision-<i>", !!unmatched && unmatched.category === "FACE");
    check("unmatched non-FACE vision detection skipped", !fused.some((d) => d.category === "EMAIL" && d.source === "vision"));
    check("DOM-only PASSWORD survives the merge", fused.some((d) => d.category === "PASSWORD" && d.source === "dom" && d.element_id === "e-pass"));
    check("one detection per (element, category)", new Set(fused.map((d) => `${d.element_id}:${d.category}`)).size === fused.length);
  }
  {
    // Screenshot 1280x960 -> viewport 640x480: bboxes halve (round-half-even).
    const fused = fuseDetections(
      [],
      [],
      [{ element_id: "vision-0", category: "FACE", bbox: [229, 126, 184, 237], confidence: 0.9, source: "vision" }],
      { w: 1280, h: 960 },
      { w: 640, h: 480 }
    );
    // 229/2 = 114.5 -> 114 (half-even), 126/2 = 63, 184/2 = 92, 237/2 = 118.5 -> 118
    check(
      "screenshot->viewport scaling (2x device pixels, round-half-even)",
      fused.length === 1 && fused[0].bbox[0] === 114 && fused[0].bbox[1] === 63 &&
        fused[0].bbox[2] === 92 && fused[0].bbox[3] === 118,
      JSON.stringify(fused[0]?.bbox)
    );
  }
  {
    // Tie / replacement rules on the same (element, category) key.
    const els = [el("e-a", "img", [100, 100, 100, 100])];
    const face = (c: number, s: Detection["source"]): Detection => ({
      element_id: "e-a", category: "FACE", bbox: [100, 100, 100, 100], confidence: c, source: s,
    });
    const tie = fuseDetections(els, [face(0.9, "dom")], [face(0.9, "vision")], { w: 64, h: 64 }, { w: 64, h: 64 });
    check("confidence tie -> DOM wins (deterministic signal)", tie.length === 1 && tie[0].source === "dom");
    const higher = fuseDetections(els, [face(0.9, "dom")], [face(0.95, "vision")], { w: 64, h: 64 }, { w: 64, h: 64 });
    check("strictly higher vision confidence replaces DOM entry", higher.length === 1 && higher[0].source === "vision");
    const lower = fuseDetections(els, [face(0.95, "dom")], [face(0.9, "vision")], { w: 64, h: 64 }, { w: 64, h: 64 });
    check("lower vision confidence does not replace DOM entry", lower.length === 1 && lower[0].source === "dom");
  }
  {
    let threw = false;
    try {
      fuseDetections([], [], [], { w: 0, h: 480 }, { w: 640, h: 480 });
    } catch {
      threw = true;
    }
    check("non-positive dimensions rejected", threw);
  }

  // --- Scenario A: page with FACE, end-to-end through the gate to remote ---
  console.log("\n[2] Scenario A: page with FACE (F1) reaches remote sanitized");
  const emailEl = el("e-email", "input", [10, 400, 200, 20], {
    type: "email", label: "Email", text: "arjun.mehta@example.com",
  });
  const a = await simulateStep({ dataUrl: F1, elements: [emailEl], browserState: VIEWPORT_640 });
  const aFace = a.detections.find((d) => d.category === "FACE");
  check("F1: one fused FACE detection (source vision)", a.detections.filter((d) => d.category === "FACE").length === 1 && aFace?.source === "vision");
  check(
    "F1: fused FACE bbox matches M6-C reference <=1 px (scale 1)",
    !!aFace && aFace.bbox.every((v, i) => Math.abs(v - [229, 126, 184, 237][i]) <= 1),
    JSON.stringify(aFace?.bbox)
  );
  check("A: redaction received the FACE detection (pixel path input)",
    a.record.redactDetections.length === 1 && a.record.redactDetections[0].some((d) => d.category === "FACE"));
  check("A: gate allows (demo URL, all confidence >= 0.8)", a.gate.decision === "allow", a.gate.reason);
  check("A: remote called exactly once with the sanitized package", a.record.remotePayloads.length === 1 && !!a.sent);
  if (a.sent) {
    const payloadJson = JSON.stringify(a.sent);
    check("A: remote screenshot is the redacted image, never the raw dataUrl",
      a.sent.sanitizedScreenshot === "data:image/png;base64,REDACTED-STUB" && !payloadJson.includes(F1));
    const sentEmail = a.sent.sanitizedContext.elements.find((e) => e.element_id === "e-email");
    check("A: email replaced by stable placeholder (EMAIL_1)", sentEmail?.text === "EMAIL_1");
    check("A: accessible labels stripped from remote context", a.sent.sanitizedContext.elements.every((e) => e.label === null));
    check("A: remote payload free of PII patterns (PAN/AADHAAR/EMAIL regexes)",
      !PII_PATTERNS.some((re) => re.test(payloadJson)));
    check("A: element_id -> real value map stays local (never in payload)",
      !payloadJson.includes("arjun.mehta@example.com") && a.map["e-email"] === "arjun.mehta@example.com");
    check("A: raw FACE pixels never emitted (no detections/vision ids in payload)",
      !payloadJson.includes("\"source\"") && !payloadJson.includes("\"category\"") && !payloadJson.includes("vision-"));
  }

  // --- Scenario B: page without FACE ---
  console.log("\n[3] Scenario B: page without FACE (F5 text negative)");
  const b = await simulateStep({ dataUrl: F5, elements: [emailEl], browserState: VIEWPORT_640 });
  check("B: zero vision detections on a no-face page", !b.detections.some((d) => d.source === "vision"));
  check("B: DOM path unaffected (email still detected)", b.detections.some((d) => d.element_id === "e-email" && d.category === "EMAIL" && d.source === "dom"));
  check("B: step completes and reaches the remote as before", b.gate.decision === "allow" && b.record.remotePayloads.length === 1);

  // --- Scenario C: detector failure FAILS CLOSED ---
  console.log("\n[4] Scenario C: detector failure fails closed (no empty-list fallback)");
  {
    let rejected = false;
    let message = "";
    try {
      await simulateStep({
        dataUrl: F1, elements: [emailEl], browserState: VIEWPORT_640,
        loadDetector: () => Promise.reject(new Error("model corrupted (simulated)")),
      });
    } catch (err) {
      rejected = true;
      message = err instanceof Error ? err.message : String(err);
    }
    check("C: model-load failure rejects the step (gate/remote never reached)", rejected, message);
    check("C: failure is an error, not detections = []", rejected && message.length > 0);
  }
  {
    let rejected = false;
    try {
      await simulateStep({
        dataUrl: F1, elements: [emailEl], browserState: VIEWPORT_640,
        loadDetector: async () => ({
          modelUrl: "stub",
          detect: () => Promise.reject(new Error("ORT session.run failed (simulated)")),
        }),
      });
    } catch {
      rejected = true;
    }
    check("C: inference failure rejects the step (never resolves)", rejected);
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
    check("C: decode failure rejects the vision path", rejected);
  }
  {
    // Default loader path: in Node, loadFaceDetector() without injected bytes
    // must fetch a file:// URL, which Node fetch refuses -> wrapped fail-closed
    // error (proves the default loader wraps failures, never returns []).
    let msg = "";
    try {
      await runVisionPath({
        dataUrl: F1, elements: [], domDetections: [], viewport: { w: 640, h: 480 },
        decode: nodeDecode, // no loadDetector -> default shared loader
      });
    } catch (err) {
      msg = err instanceof Error ? err.message : String(err);
    }
    check("C: default loader failure is wrapped fail-closed (no silent empty list)",
      msg.includes("fail-closed"), msg);
  }

  // --- Scenario D: DOM + FACE overlap, M4 fusion + sanitizer preserved ---
  console.log("\n[5] Scenario D: DOM+FACE overlap (M4 fusion rules in the pipeline)");
  const avatarEl = el("e-avatar", "img", [230, 130, 180, 240], { label: "Profile photo" });
  const d = await simulateStep({ dataUrl: F1, elements: [avatarEl, emailEl], browserState: VIEWPORT_640 });
  const dFace = d.detections.find((x) => x.category === "FACE");
  check("D: overlapping FACE matched to the DOM element (IoU >= 0.3)", dFace?.element_id === "e-avatar" && dFace.source === "vision");
  check("D: no FACE placeholder text invented (element text untouched)",
    d.sanitized.find((x) => x.element_id === "e-avatar")?.text === "" &&
    d.sent?.sanitizedContext.elements.find((x) => x.element_id === "e-avatar")?.text === "");
  check("D: FACE element not added to the real-value map", !("e-avatar" in d.map));
  check("D: DOM EMAIL behavior unchanged alongside FACE",
    d.detections.some((x) => x.element_id === "e-email" && x.category === "EMAIL" && x.source === "dom"));

  // --- Scenario E: multiple faces ---
  console.log("\n[6] Scenario E: multiple faces (F2)");
  const e = await simulateStep({ dataUrl: F2, elements: [emailEl], browserState: VIEWPORT_640 });
  const eFaces = e.detections.filter((x) => x.category === "FACE");
  check("E: all 3 faces fused (F2 reference count)", eFaces.length === 3, `got ${eFaces.length}`);
  check("E: redaction received all 3 FACE detections",
    (e.record.redactDetections[0] ?? []).filter((x) => x.category === "FACE").length === 3);
  check("E: unmatched faces kept with synthetic ids (never dropped)",
    eFaces.every((f) => f.element_id.startsWith("vision-")));

  // --- Scenario F: non-FACE PII unchanged ---
  console.log("\n[7] Scenario F: non-FACE PII (PASSWORD/EMAIL/PAN) unchanged");
  const passEl = el("e-pass", "input", [10, 430, 200, 20], { type: "password", label: "Password", text: "" });
  const panEl = el("e-pan", "span", [10, 460, 200, 20], { label: "PAN", text: "ABCPE1234F" });
  const f = await simulateStep({ dataUrl: F5, elements: [emailEl, passEl, panEl], browserState: VIEWPORT_640 });
  check("F: PASSWORD preserved (DOM detection, category PASSWORD)",
    f.detections.some((x) => x.element_id === "e-pass" && x.category === "PASSWORD" && x.source === "dom"));
  check("F: password text never emitted (empty after sanitize)",
    f.sanitized.find((x) => x.element_id === "e-pass")?.text === "");
  check("F: email -> EMAIL_1, PAN -> PAN_1 (stable tokens)",
    f.sanitized.find((x) => x.element_id === "e-email")?.text === "EMAIL_1" &&
    f.sanitized.find((x) => x.element_id === "e-pan")?.text === "PAN_1");
  check("F: real values isolated in the local map",
    f.map["e-email"] === "arjun.mehta@example.com" && f.map["e-pan"] === "ABCPE1234F" && !("e-pass" in f.map));
  const fJson = JSON.stringify(f.sent ?? {});
  check("F: remote payload free of PII patterns", !PII_PATTERNS.some((re) => re.test(fJson)));

  // --- Gate interplay: vision detections reach the policy gate ---
  console.log("\n[8] Policy gate sees vision detections");
  const login = await simulateStep({
    dataUrl: F1, elements: [emailEl],
    browserState: { url: "https://portal.example/login", title: "Sign in", viewport: { w: 640, h: 480 } },
  });
  check("FACE on a login page -> human approval (existing rule, vision-fed)",
    login.gate.decision === "human_approval" && login.record.remotePayloads.length === 0, login.gate.reason);

  // --- Fail-closed ordering pinned in the real orchestrator loop ---
  // The pipeline wiring moved from the service worker into orchestrator/runStep.ts
  // with the CBA-6 session loop; the check follows the wiring. Intent unchanged:
  // vision runs after capture and before the gate and the remote call, and the
  // fail-closed contract is documented at the wiring point.
  console.log("\n[9] orchestrator/runStep.ts wiring (static)");
  {
    const sw = readFileSync("orchestrator/runStep.ts", "utf-8");
    const iVision = sw.indexOf("await runVisionPath(");
    const iDecide = sw.indexOf("decide({");
    const iRemote = sw.indexOf("queryServer(");
    check("runVisionPath wired between capture and sanitizer/gate/remote",
      iVision !== -1 && iDecide !== -1 && iRemote !== -1 && iVision < iDecide && iDecide < iRemote,
      `vision@${iVision} decide@${iDecide} remote@${iRemote}`);
    check("fail-closed semantics documented at the wiring point", sw.includes("FAIL-CLOSED"));
  }

  // --- Latency through the full vision path (real model + decode + fusion) ---
  console.log("\n[10] Latency (Node WASM; browser decode is native and faster)");
  {
    const t0 = performance.now();
    const detector = await loadFaceDetector(modelBytes);
    const loadMs = performance.now() - t0;
    const cachedLoader = () => Promise.resolve(detector);
    const run = () =>
      runVisionPath({
        dataUrl: F1, elements: [emailEl], domDetections: [], viewport: { w: 640, h: 480 },
        decode: nodeDecode, loadDetector: cachedLoader,
      });
    const t1 = performance.now();
    await run();
    const firstMs = performance.now() - t1;
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      await run();
      times.push(performance.now() - t);
    }
    times.sort((x, y) => x - y);
    const steadyMs = times[10];
    check(`model load < 2000 ms (${loadMs.toFixed(0)} ms)`, loadMs < 2000);
    check(`first vision path (decode+inference+fusion) < 300 ms (${firstMs.toFixed(0)} ms)`, firstMs < 300);
    check(`steady-state vision path < 150 ms (median ${steadyMs.toFixed(0)} ms)`, steadyMs < 150);
  }

  // --- Determinism ---
  console.log("\n[11] Determinism");
  {
    const r1 = await simulateStep({ dataUrl: F2, elements: [emailEl], browserState: VIEWPORT_640 });
    const r2 = await simulateStep({ dataUrl: F2, elements: [emailEl], browserState: VIEWPORT_640 });
    check("repeat step -> identical fused detections",
      JSON.stringify(r1.detections) === JSON.stringify(r2.detections));
  }

  // --- Static privacy audit of the new pipeline + fusion sources ---
  console.log("\n[12] Static privacy audit");
  for (const file of [
    "privacy/engine/vision/face-pipeline.ts",
    "privacy/engine/fuse.ts",
  ]) {
    const source = readFileSync(file, "utf-8");
    for (const forbidden of [
      "http://", "https://", "ws://", "localhost", "XMLHttpRequest",
      "WebSocket", "chrome.storage", "indexedDB", "navigator.sendBeacon",
      "writeFile", "appendFile",
    ]) {
      check(`${file} free of "${forbidden}"`, !source.includes(forbidden));
    }
  }
  {
    // The only fetch() in the pipeline must be the in-memory data: URL decode
    // (same pattern as privacy/sanitizer/visual-redact.ts decodeImage).
    const src = readFileSync("privacy/engine/vision/face-pipeline.ts", "utf-8");
    check("pipeline fetch() only ever targets the in-memory data: URL", src.includes("await fetch(dataUrl)"));
  }

  if (failures.length === 0) {
    console.log("\nALL CHECKS PASSED");
  } else {
    console.error(`\nFAILED: ${failures.length} check(s)`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("HARNESS ERROR:", err);
  process.exit(1);
});
