# PRIVIS

**PS ID:** SIH26171 — On-device Visual Perception for Light-weight Browser Agents
**Organization:** ISRO / Department of Space

PRIVIS is a browser extension that lets an AI agent operate a web page without ever seeing the user's raw personal data. A local Capture Layer takes an in-memory screenshot plus DOM state. The Local Privacy Vision Engine (DOM rules now, ONNX/WebGPU vision later) finds sensitive items. The Sanitizer redacts pixels and replaces strings with stable placeholders (`EMAIL_1`, `PAN_1`, `AADHAAR_1`, `AMOUNT_1`, `PHONE_1`, `NAME_1`). The Policy Gate allows, asks the human, or blocks. Only the sanitized view reaches the Remote Agent; its actions are executed locally by the Local Executor.

**One-liner:** local eyes, local eraser, remote brain.

## Architecture

![PRIVIS architecture](docs/architecture.png)

## Flow

1. **Capture Layer** — background service worker screenshots the tab (memory only); content script reads DOM, a11y, visible text, element bounding boxes, and browser state.
2. **Local Privacy Vision Engine** — fuses DOM detections (now) with vision boxes (later); emits `{element_id, category, bbox, confidence, source}`.
3. **Sanitizer** — visual redaction on a canvas copy + type-preserving structural placeholders; layout, button labels, and non-sensitive text are preserved.
4. **Policy Gate** — Allow / Human Approval / Block on the sanitized package.
5. **Remote Agent** — receives only sanitized screenshot + sanitized JSON + goal; returns actions like `{ "type": "click", "target": "#submit" }`.
6. **Local Executor** — content script resolves targets and clicks/types on the real page, then loops back to Capture.

## Development

```bash
# 1. Install dependencies
npm install

# 2. Typecheck (no emit)
npm run typecheck

# 3. Compile TypeScript to dist/
npm run build

# Or watch mode
npm run watch
```

### Load the extension in Chrome

1. Run `npm install && npm run build` (a fresh clone has no `dist/` yet).
2. Open `chrome://extensions`, enable **Developer mode**.
3. Click **Load unpacked** and select **this repository root** — `manifest.json` lives here and points at the compiled `dist/` output.
4. Chrome 91+ loads the background service worker as an ES module (`"type": "module"`).

Notes:

- `dist/` is git-ignored by design; it is a build artifact, never committed. Load unpacked always targets the repo root, never `dist/` itself.
- Output is plain `tsc` — no bundler. Modules currently only use `import type` (erased at compile time), so each emitted file is self-contained. Any runtime cross-file imports between content scripts will need a bundler or dynamic `import()`; that comes with the capture pipeline (issues #3/#4).

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
