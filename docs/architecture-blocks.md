# PRIVIS — Architecture Block Diagram (with technologies)

```
                         PRIVIS — END-TO-END ARCHITECTURE
                     (local eyes · local eraser · remote brain)

  ╔════════════════════════════════════════════════════════════════════════╗
  ║  ON-DEVICE — Chrome Extension (TypeScript · Manifest V3 · esbuild)      ║
  ╚════════════════════════════════════════════════════════════════════════╝

  ┌───────────────────────────────────────────────┐
  │  1. CAPTURE LAYER                             │
  │  • BG service worker: chrome.tabs.            │
  │    captureVisibleTab -> in-memory PNG         │
  │  • Content script: DOM extractor              │
  │  INPUT : target web tab (the real page)       │
  │  OUTPUT: CapturePackage {                     │
  │            dataUrl · elements · browserState }│
  └──────────────────────┬────────────────────────┘
                         │  = CapturePackage =
                         ▼
  ┌───────────────────────────────────────────────┐
  │  2. LOCAL PRIVACY VISION ENGINE               │
  │  • DOM rules: regex · input[type] · aria      │
  │  • ML: ONNX Runtime Web + WebGPU (on-device)  │
  │  INPUT : CapturePackage (elements)            │
  │  OUTPUT: Detection[] {                        │
  │            element_id · category · bbox       │
  │            confidence · source }              │
  └──────────────────────┬────────────────────────┘
                         │  = Detection[] =
                         ▼
  ┌───────────────────────────────────────────────┐
  │  3. SANITIZER                                 │
  │  • Visual: Canvas API redaction               │
  │    (blackout + pixelate FACE)                 │
  │  • Structural: strings -> EMAIL_1 · PAN_1 ·   │
  │    AADHAAR_1 · AMOUNT_1 · PHONE_1 · NAME_1    │
  │  INPUT : dataUrl (screenshot) + Detection[]   │
  │  OUTPUT: SanitizedPackage {                   │
  │            sanitizedScreenshot                │
  │            sanitizedContext }                 │
  │          + writes mapping table               │
  └───────┬──────────────────────────┬────────────┘
          │                          │ writes: element_id -> real value
          │                          ▼
          │        ┌──────────────────────────────────────────┐
          │        │  MAPPING TABLE (in-memory, on-device)    │
          │        │  INPUT : element_id -> real value        │
          │        │  OUTPUT: real value for Executor typing  │
          │        │  NEVER leaves the device                 │
          │        └────────────────────┬─────────────────────┘
          │  = SanitizedPackage =       │ reads: real value
          ▼                             ▼
  ┌───────────────────────────────────────────────┐
  │  4. POLICY GATE                               │
  │  Deterministic rules engine (NO ML):          │
  │    allow / human_approval / block             │
  │  INPUT : detections + browserState (URL)      │
  │  OUTPUT: decision { allow | human_approval    │
  │            | block, reason }                  │
  └──────────────────────┬────────────────────────┘
                         │  ONLY IF allow:
                         │  sanitizedScreenshot + placeholders + goal
                         ▼
  ════════════════════ DEVICE / NETWORK BOUNDARY ════════════════════
                         │
                         ▼
  ┌───────────────────────────────────────────────┐
  │  5. REMOTE AGENT                    (NETWORK) │
  │  Multimodal VLM API:                          │
  │    Gemini 2.5 / GPT-4o (HTTPS)                │
  │  INPUT : sanitized img + tokens + goal        │
  │          (ONLY sanitized data)                │
  │  OUTPUT: Action[] { type, target, value? }    │
  └──────────────────────┬────────────────────────┘
                         │  = Action[] =
                         ▼
  ┌───────────────────────────────────────────────┐
  │  6. LOCAL EXECUTOR                  (ON-DEVICE)│
  │  Content script + chrome.scripting             │
  │  INPUT : Action[] + mapping table              │
  │          (reads real value from table)         │
  │  OUTPUT: ActionResult[] { ok, error? }         │
  │          (real click/type on the page DOM)     │
  └──────────────────────┬────────────────────────┘
                         │  = loop: capture next state =
                         └────────────────▶ back to 1. Capture Layer


  ┌───────────────────────────────────────────────┐
  │  HUD POPUP (side channel)                     │
  │  HTML + CSS + vanilla JS                      │
  │  INPUT : hud.liveStep events (live pipeline)  │
  │  OUTPUT: visual 6-step view — raw/sanitized   │
  │          screenshots, detection chips,        │
  │          mapping table                        │
  └───────────────────────────────────────────────┘
```

## Input → Output summary

| # | Module | INPUT | OUTPUT |
|---|--------|-------|--------|
| 1 | Capture Layer | target web tab (real page) | `CapturePackage` — `dataUrl` + `elements[]` + `browserState` |
| 2 | Vision Engine | `CapturePackage` (elements) | `Detection[]` — element_id, category, bbox, confidence, source |
| 3 | Sanitizer | screenshot (`dataUrl`) + `Detection[]` | `SanitizedPackage` — sanitized screenshot + sanitized context (+ mapping table write) |
| 4 | Policy Gate | detections + browserState (URL) | decision — `allow` / `human_approval` / `block` + reason |
| 5 | Remote Agent | sanitized img + placeholders + goal | `Action[]` — type, target, value? |
| 6 | Local Executor | `Action[]` + on-device mapping table | `ActionResult[]` — real click/type on page DOM |
| — | Mapping table | element_id → real value (from Sanitizer) | real value (to Executor) |
| — | HUD popup | `hud.liveStep` events | live 6-step visual pipeline |

## Technology stack per module

| # | Module | Technology | What it does |
|---|--------|-----------|--------------|
| — | Language / build | **TypeScript**, **esbuild**, **Chrome Manifest V3** | Type-safe modules, IIFE-bundled content scripts & service worker |
| 1 | Capture Layer | `chrome.tabs.captureVisibleTab()` (background), content-script **DOM extractor** (`querySelectorAll`, `getBoundingClientRect`) | In-memory screenshot + element metadata with bounding boxes |
| 2 | Vision Engine (DOM) | **regex + `input[type]` + ARIA label rules** | Detect EMAIL, PAN, AADHAAR, AMOUNT, PHONE, NAME, PASSWORD, FACE with confidence |
| 2 | Vision Engine (ML) | **ONNX Runtime Web + WebGPU** | On-device visual inference — faces, cards, signatures (no data leaves device) |
| 3 | Sanitizer (pixels) | **Canvas API / OffscreenCanvas** | Black-out sensitive regions, pixelate FACE on a canvas copy |
| 3 | Sanitizer (text) | stable placeholder tokens (`EMAIL_1`, `PAN_1`…) | Swap real strings for stable placeholders; PASSWORD/FACE destroyed |
| 4 | Policy Gate | deterministic **TypeScript rules engine** | allow / human_approval / block — auditable, no ML |
| 5 | Remote Agent | **HTTPS fetch → VLM API** (Gemini/GPT-4o) | Receives ONLY sanitized screenshot + placeholders + goal; returns `Action[]` |
| 6 | Local Executor | **content script + `chrome.scripting`** | Resolve targets on real DOM, click/type real values from on-device map |
| — | Messaging | `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage` | Typed, validated messages between worker ↔ content script ↔ HUD |
| — | HUD | **HTML + CSS + vanilla JS** popup | Live 6-step pipeline view with raw/sanitized screenshots + mapping table |
| — | Mapping table | in-memory `Record<element_id, value>` | Real values stay on-device; only placeholders cross the wire |

## Privacy invariant

> Raw PII, raw screenshots, and the mapping table never cross the device boundary.
> Only sanitized pixels + placeholders + goal leave; `Action[]` returns and runs locally.
