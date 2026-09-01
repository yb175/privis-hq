# PRIVIS — Architecture Block Diagram (with technologies)

```
                        PRIVIS — END-TO-END ARCHITECTURE
                    (local eyes · local eraser · remote brain)

  ╔══════════════════════════════════════════════════════════════════════╗
  ║  ON-DEVICE — Chrome Extension (TypeScript · Manifest V3 · esbuild)    ║
  ╚══════════════════════════════════════════════════════════════════════╝

  ┌────────────────────────────────────┐
  │  1. CAPTURE LAYER                  │
  │  • Background service worker:      │
  │    chrome.tabs.captureVisibleTab   │
  │    -> in-memory PNG screenshot     │
  │  • Content script (DOM extractor): │
  │    elements · bbox · browser state │
  └─────────────────┬──────────────────┘
                    │  CapturePackage { dataUrl, elements, browserState }
                    ▼
  ┌────────────────────────────────────┐
  │  2. LOCAL PRIVACY VISION ENGINE    │
  │  • DOM perception rules:           │
  │    regex · input[type] · aria label│
  │  • ML inference (ON-DEVICE):       │
  │    ONNX Runtime Web + WebGPU       │
  │    faces, cards, signatures        │
  └─────────────────┬──────────────────┘
                    │  Detection[] { element_id, category, bbox, confidence }
                    ▼
  ┌────────────────────────────────────┐
  │  3. SANITIZER                      │
  │  • Visual redaction (Canvas API):  │
  │    blackout + pixelate FACE        │
  │  • Structural redaction:           │
  │    strings -> EMAIL_1 · PAN_1 ·    │
  │    AADHAAR_1 · AMOUNT_1 · PHONE_1  │
  │    NAME_1 (PASSWORD/FACE destroyed)│
  └─────────┬───────────────┬──────────┘
            │               │ writes map (element_id -> real value)
            │               ▼
            │   ┌──────────────────────────────┐
            │   │  MAPPING TABLE (in-memory)   │
            │   │  element_id -> real value    │
            │   │  NEVER leaves the device     │
            │   └──────────────┬───────────────┘
            │  SanitizedPackage│ reads real value
            ▼                  ▼
  ┌────────────────────────────────────┐
  │  4. POLICY GATE                    │
  │  Deterministic rules engine:       │
  │    allow / human_approval / block  │
  │  (demo exception · PASSWORD block ·│
  │   low-confidence · FACE on login)  │
  └─────────────────┬──────────────────┘
                    │  ONLY IF allow: sanitized screenshot + placeholders + goal
                    ▼
  ══════════════════ DEVICE / NETWORK BOUNDARY ══════════════════
                    │
                    ▼
  ┌────────────────────────────────────┐
  │  5. REMOTE AGENT          (NETWORK)│
  │  Multimodal VLM API:               │
  │    Gemini 2.5 / GPT-4o (HTTPS)     │
  │  Sees ONLY sanitized data          │
  │  -> returns Action[]               │
  └─────────────────┬──────────────────┘
                    │  Action[] { type, target, value? }
                    ▼
  ┌────────────────────────────────────┐
  │  6. LOCAL EXECUTOR      (ON-DEVICE)│
  │  Content script:                   │
  │  resolve target on real DOM        │
  │  click / type real values          │
  │  (from on-device mapping table)    │
  └─────────────────┬──────────────────┘
                    │  loop: capture next state
                    └────────────▶ back to 1. Capture Layer


  ┌────────────────────────────────────┐
  │  HUD POPUP (side channel)          │
  │  HTML + CSS + vanilla JS           │
  │  live 6-step pipeline view:        │
  │  raw vs sanitized screenshots,     │
  │  detection chips, mapping table    │
  │  (receives hud.liveStep events)    │
  └────────────────────────────────────┘
```

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
