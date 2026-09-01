# PRIVIS — Architecture Block Diagram (with technologies)

## Block diagram

```mermaid
flowchart TB
    subgraph DEVICE["🟢 ON-DEVICE — PRIVIS Chrome Extension (TypeScript · Manifest V3 · esbuild)"]
        direction TB

        subgraph CAPTURE["1 · Capture Layer"]
            BG["Background Service Worker<br/>chrome.tabs.captureVisibleTab() → in-memory PNG"]
            DOM["Content Script<br/>DOM extractor → elements · bbox · browserState"]
        end

        subgraph VISION["2 · Local Privacy Vision Engine"]
            RULES["DOM perception rules<br/>regex · input[type] · aria labels"]
            ONNX["ONNX Runtime Web + WebGPU<br/>on-device visual inference"]
        end

        subgraph SAN["3 · Sanitizer"]
            PIXEL["Visual redaction<br/>Canvas API — blackout + pixelate FACE"]
            STRUCT["Structural redaction<br/>strings → EMAIL_1 · PAN_1 · NAME_1 · ..."]
        end

        GATE["4 · Policy Gate<br/>deterministic rules — allow / human_approval / block"]
        MAP[("On-device mapping table<br/>element_id → real value<br/>in-memory · never leaves device")]
        EXEC["6 · Local Executor<br/>content script — resolves targets · clicks · types"]
        HUD["HUD popup<br/>HTML + CSS + vanilla JS · live pipeline view"]
    end

    subgraph NETWORK["🔴 NETWORK — Remote Brain"]
        AGENT["5 · Remote Agent<br/>multimodal VLM API<br/>(Gemini 2.5 / GPT-4o) over HTTPS"]
    end

    BG -->|"CapturePackage: dataUrl + elements + browserState"| VISION
    DOM --> VISION
    RULES -->|fuse| DET{"Detection[]"}
    ONNX -->|fuse| DET
    DET -->|"element_id · category · bbox · confidence"| SAN
    SAN -->|"SanitizedPackage"| GATE
    GATE -->|"only if allow — sanitized img + placeholders + goal"| AGENT
    AGENT -->|"Action[] { type, target, value? }"| EXEC
    SAN -.->|"writes map"| MAP
    MAP -.->|"reads real value"| EXEC
    EXEC -->|"loop: capture next state"| BG
    GATE -.->|"live step events"| HUD
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
