# PRIVIS

**PS ID:** SIH26171 — On-device Visual Perception for Light-weight Browser Agents
**Organization:** ISRO / Department of Space

PRIVIS is a browser extension that lets an AI agent operate a web page without ever seeing the user's raw personal data. A local Capture Layer takes an in-memory screenshot plus DOM state. The Local Privacy Vision Engine (DOM rules now, ONNX/WebGPU vision later) finds sensitive items. The Sanitizer redacts pixels and replaces strings with stable placeholders (`EMAIL_1`, `PAN_1`, `AADHAAR_1`, `AMOUNT_1`, `PHONE_1`, `NAME_1`). The Policy Gate allows, asks the human, or blocks. Only the sanitized view reaches the Remote Agent; its actions are executed locally by the Local Executor.

**One-liner:** local eyes, local eraser, remote brain.

## Architecture

![PRIVIS architecture](docs/architecture.png)

## End-to-End Execution Flow

```
[ Real Page DOM + Screenshot ]
             │
             ▼
1. Capture Layer (On-Device Extension)
   - Background worker captures viewport screenshot into memory.
   - Content script extracts interactive DOM elements.
             │
             ▼
2. Local Privacy Engine & Sanitizer (On-Device)
   - Detects PII (PAN, Aadhaar, Email, Faces, Phone, etc.) locally.
   - Visually redacts screenshot pixels (pixelates faces, blacks out sensitive boxes).
   - Replaces real values with stable placeholders: `PAN_1`, `EMAIL_1`.
   - Real-to-placeholder map stays isolated in local memory.
   - Stamps payload with `redacted: true`.
             │
             ▼
3. Policy Gate (On-Device)
   - Evaluates risk: `allow`, `human_approval`, or `block`.
             │
             ▼
4. Packager (`remote-agent/packager.ts`)
   - Verifies redaction provenance stamp.
   - Combines `goal` + `sanitizedContext` + `screenshot` + `lastStepResult`.
   - Strips sensitive metadata (like unredacted labels).
   - Generates placeholder allowlist (`["PAN_1", "EMAIL_1"]`).
             │
             ▼
5. Model Router & Cloud Brain (`remote-agent/router.ts`)
   - Operator server holds LLM keys (no keys stored in browser extension).
   - Dispatches packaged prompt to OpenAI (GPT-4o-mini) or Gemini (3.5 Flash).
   - Receives single candidate action (e.g. `type target="#pan" placeholder="PAN_1"`).
             │
             ▼
6. Guard (`remote-agent/guard.ts`)
   - Pre-execution lock before browser runs anything:
     - Verifies single action and schema conformance.
     - Enforces URL schemes (`http:`, `https:` only for `navigate`).
     - Enforces placeholder allowlist (rejects hallucinated `PAN_2`).
     - Scans output against deep PII registry (rejects raw PAN/SSN/Card strings).
     - Fail-closed: if anything is invalid, falls back safely to `ask_human`.
             │
             ▼
7. Local Executor (`executor/local-executor.ts` On-Device)
   - Resolves target selector against real DOM on page.
   - Swaps placeholder `PAN_1` back to real PAN from on-device map.
   - Performs real browser click/type action.
             │
             ▼
[ Next step loop repeats until goal is done ]
```

### Stage Summary

1. **Capture Layer** — background service worker screenshots the tab (memory only); content script reads DOM, a11y, visible text, element bounding boxes, and browser state.
2. **Local Privacy Vision Engine** — fuses DOM detections with local vision models (e.g. YuNet face detection); emits `{element_id, category, bbox, confidence, source}`.
3. **Sanitizer** — visual redaction on a canvas copy + type-preserving structural placeholders (`PAN_1`, `EMAIL_1`); layout and non-sensitive text are preserved.
4. **Policy Gate** — Allow / Human Approval / Block decision on the sanitized package.
5. **Packager** — validates provenance, compiles sanitized DOM, screenshot, and step history into structured prompts, and builds the placeholder allowlist.
6. **Remote Agent & Model Router** — server dispatches sanitized prompt to OpenAI or Gemini with server-held keys (zero client keys).
7. **Guard** — strict pre-execution lock verifying single action, URL schemes, placeholder allowlist, and PII exclusion before execution.
8. **Local Executor** — content script resolves target selectors, swaps placeholders back to real values using the on-device map, and executes the action on the real page.

## Development

```bash
# 1. Install dependencies
npm install

# 2. Typecheck (no emit)
npm run typecheck

# 3. Build extension bundles to dist/
npm run build

# Or watch mode
npm run watch
```

### Load the extension in Chrome

1. Run `npm install && npm run build` (a fresh clone has no `dist/` yet).
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** and select **this repository root** — `manifest.json` lives here and points at the compiled `dist/` output.

Notes:

- `dist/` is git-ignored by design; it is a build artifact, never committed. Load unpacked always targets the repo root, never `dist/` itself.
- `npm run typecheck` is `tsc --noEmit` and is the CI type gate; `npm run build` uses **esbuild**.
- esbuild bundles each entry as a classic (IIFE) script. Content scripts cannot be ES modules in Chrome MV3, so stripping the top-level `export`/`import` via bundling is what makes them load at all. Service worker and content scripts are all plain classic scripts — no `"type": "module"` needed.

## Testing the pipeline end-to-end

There is no hosted CI yet — the test pipeline is the two local gates below plus a manual E2E run in Chrome. Run the gates first; every change must pass both.

### 1. Local gates (automated)

```bash
npm install
npm run typecheck   # tsc --noEmit — TS type gate (the CI type gate)
npm run build       # esbuild → dist/ — bundle gate, must exit 0 and emit dist/
```

Both must exit 0. `typecheck` catches type drift; `build` catches import/bundle breakage in the MV3 entry points.

### 2. Manual E2E (Chrome)

1. **Load the extension**: open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select **this repository root** (`manifest.json`). The service worker should start with no errors.
2. **Serve the demo portal** (content scripts only run on http/https; `file://` won't match):
   ```bash
   cd demo-portal && python3 -m http.server 8000
   ```
   Open `http://localhost:8000`. The content script (`dist/content/capture-content.js`) must inject cleanly — no errors in the page console.
3. **Trigger the manual capture hook** from the service worker console: `chrome://extensions` → **PRIVIS** → **service worker** link → DevTools console:
   ```js
   chrome.tabs.query({ active: true }, ([t]) =>
     chrome.runtime.sendMessage({ type: "PRIVIS_CAPTURE_SCREENSHOT", tabId: t.id }, (r) =>
       console.log(r?.dataUrl?.startsWith("data:image/png;base64,") ? "PASS: screenshot captured in-memory" : r))
   );
   ```
   The active tab must be the demo portal. **Pass** = a PNG `dataUrl` comes back and it is the portal page; the raw screenshot never touches disk or extension storage.
4. **When the full `runStep` pipeline is implemented**, run one complete step (Capture → Sanitizer → Policy Gate → Remote Agent → Executor) and diff the output against `test/fixtures/`: `detections.json` (vision-engine output), `sanitized-context.json` (sanitizer output — every sensitive value must be a placeholder like `EMAIL_1`/`PAN_1`), and `action-click-submit.json` (the remote agent's action that the executor must apply to `#submit`). The demo portal's fake PII is the stable target for this check.

## Demo script for judges (CBA-2 model router: privacy-first remote brain)

The full product now runs end-to-end: extension → your remote-agent server →
cloud LLM (chatgpt or Gemini) → local executor — with zero PII and zero API
keys ever leaving the user's device.

### Step 0 — One-time setup (before the demo)

```bash
npm install
npm run build

# 1. Server keys (never committed; .env is git-ignored)
cp remote-agent/.env.example remote-agent/.env
# edit remote-agent/.env:
#   PRIVIS_MODEL=gemini          # or chatgpt
#   GEMINI_API_KEY=AIza...       # or OPENAI_API_KEY=sk-...
#   AGENT_AUTH_TOKEN=$(openssl rand -hex 32)

# 2. Load the extension (see "Load the extension in Chrome" above)
# 3. Serve the demo portal
cd demo-portal && python3 -m http.server 8000
```

### Step 1 — Start the remote brain

```bash
npm run serve:agent
# [PRIVIS Remote Agent (Hono)] listening on http://0.0.0.0:3201 (auth: bearer token required)
```

Point out: all LLM keys live **here**, on the operator server — the extension
ships with zero keys.

### Step 2 — Point the extension at the server (once)

`chrome://extensions` → **PRIVIS** → **service worker** → DevTools console:

```js
const KEY = "privis_model_settings";
const cur = (await chrome.storage.local.get(KEY))[KEY] ?? {};
await chrome.storage.local.set({
  [KEY]: {
    ...cur,
    serverUrl: "http://localhost:3201",
    agentAuthToken: "<same token as remote-agent/.env>",
    model: "gemini",            // preference only — server decides with its keys
  },
});
console.log("settings saved");
```

### Step 3 — Run one full agent step

1. Open `http://localhost:8000` (the demo portal with synthetic PAN / Aadhaar /
   email / amount / phone / name fields).
2. Click the **PRIVIS toolbar icon**. The HUD walks the judges through all six
   stages live:
   1. **Capture** — raw screenshot + DOM package (in memory only)
   2. **Vision Engine** — sensitive regions detected (DOM rules + YuNet face model)
   3. **Sanitizer** — pixels blacked out, values swapped to `PAN_1`, `EMAIL_1`, …
   4. **Policy Gate** — allow / human-approval / block decision with reason
   5. **Remote Agent** — only the redacted screenshot + placeholder tokens cross the wire
   6. **Executor** — the real values are typed back from the on-device map; form submits
3. The agent loops until it returns `done` — the form is filled and submitted
   with real values, but the cloud model never saw a single one of them.

### Step 4 — The proof points (what to show the judges)

- **Keys stay server-side**: the extension's storage (`chrome.storage.local` →
  `privis_model_settings`) contains no `OPENAI_API_KEY` / `GEMINI_API_KEY` —
  show it in DevTools.
- **Nothing raw crosses the wire**: in the service worker's DevTools → Network,
  the only outbound POST is to `http://localhost:3201/plan`. Its body shows
  `PAN_1`-style tokens and a visibly redacted screenshot — no PAN, no Aadhaar,
  no face pixels.
- **Model switch without code changes**: flip `PRIVIS_MODEL=chatgpt` ↔
  `gemini` in `remote-agent/.env`, restart the server, rerun — same demo, same
  AgentAction schema, different brain. (Or send a `model` preference from the
  extension settings above.)
- **Fail-safety**: stop the server and click PRIVIS — the step fails closed
  (no crash loop, no partial send). Remove the key from `.env` — the server
  answers `ask_human` with a `no_api_key` reason instead of crashing.
- **Automated QA (offline, no paid API)**: `npm test` runs typecheck + the
  CBA-1 PII-guard suite (38 real-world PII patterns), the router/server tests
  (auth, CORS, no-keys-on-wire), and the privacy boundary suite (real
  redaction on synthetic fixtures, fail-closed vision, static leak audits).

### Troubleshooting

| Symptom | Fix |
|---|---|
| Server logs `auth: OFF` | `AGENT_AUTH_TOKEN` not set in `.env` — restart the server |
| Extension step errors with `401` | `agentAuthToken` in extension storage doesn't match `AGENT_AUTH_TOKEN` |
| `Remote agent server error` / connection refused | Server not running, or `serverUrl` mismatch (default `http://localhost:3201`) |
| `ask_human` with `no_api_key` | Key for the selected model missing in `remote-agent/.env` |
| Content scripts not injecting | Open `http://localhost:8000` (http/https only, not `file://`) |

## Contributing

1. **Fork** the repository to your GitHub account.
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/your-user-name/privis-hq.git
   cd privis-hq
   ```
3. **Create a branch** for your change:
   ```bash
   git checkout -b feature/your-feature-name
   ```
4. **Make your changes** and commit with a clear message:
   ```bash
   git commit -m "feat: brief description of change"
   ```
5. **Push** to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```
6. **Open a Pull Request**: Navigate to the original repository on GitHub, click **Compare & pull request**, describe your changes, and submit.

## Research

Idea lock and research brief: [privis-idea-research](https://github.com/yb175/privis-idea-research).
