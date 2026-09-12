# Privis — Cross-Repo Differential Runtime & Mapping Audit

## Executive Summary

A deep differential audit was performed between:
* **Reference Implementation**: `yb175/privis-hq` on branch `main` (`ee654daca561d1eeb1c86ef964ffaaefb12e285f`)
* **Current Implementation**: `yj13273/privis-hq` on branch `main` (`90b89f645a57a12559a6b2a305de6cd7760ee9e8`)

### Key Finding: Why automated tests passed while the real Chrome extension failed
Automated tests in Node.js and simulated test harnesses passed 100% because test harnesses mock Chrome APIs and execute single-turn happy paths with pre-formed placeholder tokens (`PAN_1`, `EMAIL_1`). However, in a real Chrome browser runtime:
1. **Dynamic Content Script Re-injection Failure**: `utils/messaging.ts` invoked `chrome.scripting.executeScript` targeting files `dist/utils/dom-extractor.js` and `dist/privacy/sanitizer/structural-redact.js` that did not exist in `dist/` (they were bundled into `dist/content/capture-content.js`), causing immediate breakage on tabs opened prior to extension reload.
2. **Chat Popup UI Deadlock on `waiting_human`**: `extension/src/popup/Chat.ts` locked the chat input when `session.status === "waiting_human"`, deadlocking the UI so users could not answer human approval prompts or provide required input.
3. **Planner Non-Token Value Rejection**: `remote-agent/types.ts` `validateAgentAction` strictly rejected any type action placeholder not matching `^[A-Z]+_\d+$`. When a model planned a typing action using a literal text value from the user's prompt (e.g. searching for a name or product), the plan was rejected as invalid.
4. **Executor Non-Token Typing Drop**: `executor/agent-action.ts` dropped the `goal` argument and returned empty actions `[]` for any type action where the placeholder was not in the local secret map.
5. **Restricted `chrome://` URL Access**: Interacting with the popup while on `chrome://` URLs threw uncaught Chrome security errors instead of graceful user guidance.

---

## 1. Repository SHAs & Metadata

| Repository | Remote / Branch | Commit SHA | Role |
|---|---|---|---|
| **`yb175/privis-hq`** | `upstream/main` | `ee654daca561d1eeb1c86ef964ffaaefb12e285f` | Reference Architecture & Invariants |
| **`yj13273/privis-hq`** | `origin/main` (`HEAD`) | `90b89f645a57a12559a6b2a305de6cd7760ee9e8` | Current Working Tree |

---

## 2. Architecture Comparison

### Real Runtime Architecture Map

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        Popup UI (popup.html)                          │
│   ┌──────────────────┐  ┌──────────────────────┐  ┌────────────────┐   │
│   │     Chat.ts      │  │   Transparency.ts    │  │  Settings.ts   │   │
│   └────────┬─────────┘  └──────────┬───────────┘  └───────┬────────┘   │
└────────────┼───────────────────────┼──────────────────────┼────────────┘
             │ chrome.runtime.sendMessage                   │ chrome.storage
             ▼                       ▼                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                MV3 Background Service Worker (service-worker.ts)       │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │                 Orchestrator Loop (runGoal / runStep)          │   │
│   │                                                                │   │
│   │   1. Capture (capture.ts + screenshot.ts)                      │   │
│   │   2. Offscreen ML Vision (offscreen.ts -> ort-runtime.ts)      │   │
│   │   3. Fusion & Normalization (fuse.ts + normalize.ts)           │   │
│   │   4. Sanitizer (structural-redact.ts + visual-redact.ts)       │   │
│   │   5. Policy Gate & Receipt (policy-gate.ts + receipt.ts)       │   │
│   │   6. Remote Agent Router (assert.ts -> router.ts -> HTTP)      │   │
│   │   7. Local Executor Dispatch (agent-action.ts)                 │   │
│   └────────────────────────────────────────────────────────────────┘   │
└────────────┬──────────────────────────────────────────────┬────────────┘
             │ chrome.tabs.sendMessage                      │ chrome.offscreen
             ▼                                              ▼
┌───────────────────────────────┐           ┌────────────────────────────┐
│ Content Script                │           │ Offscreen Document         │
│ (dist/content/capture-content)│           │ (dist/offscreen/offscreen) │
│                               │           │                            │
│ - DOM extraction & a11y       │           │ - ONNX WebAssembly Runtime │
│ - Bounding box computation    │           │ - YuNet Face Detection     │
│ - Local real-value execution  │           │ - Canvas Pixel Manipulation│
│ - Settle watch & scrolling    │           │                            │
└───────────────────────────────┘           └────────────────────────────┘
```

---

## 3. Build & Package Comparison

| Asset / Entrypoint | Reference (`yb175/main`) | Current (`yj13273/main`) | Status | Impact / Finding |
|---|---|---|---|---|
| `manifest.json` `content_scripts.js` | 3 files: `dist/utils/dom-extractor.js`, `dist/privacy/sanitizer/structural-redact.js`, `dist/content/capture-content.js` | 1 file: `dist/content/capture-content.js` | INTENTIONAL REFACTOR | Current consolidates all content script dependencies into one bundle. |
| `package.json` `build` script | Built 8 separate entrypoints into `dist/` | Bundled `background`, `content`, `vision`, `popup`, and `offscreen` | INTENTIONAL REFACTOR | Clean module isolation. |
| Model Packaging | `dist/models/face_detection_yunet_2023mar.onnx` | `dist/models/face_detection_yunet_2023mar.onnx` | IDENTICAL | Checksum verified (SHA-256 pinned). |
| WASM Packaging | `dist/ort/ort-wasm-simd-threaded.wasm` + `.mjs` | `dist/ort/ort-wasm-simd-threaded.wasm` + `.mjs` | IDENTICAL | Packaged and loaded via `chrome.runtime.getURL`. |

---

## 4. Import / Export & Mapping Analysis

| Reference Module & Export | Current Module & Export | Callers in Runtime | Status |
|---|---|---|---|
| `extension/src/settings/models.ts` (`loadModelSettings`, `saveModelSettings`) | `shared/settings.ts` (`loadModelSettings`, `saveModelSettings`) | `popup/Settings.ts`, `orchestrator/runStep.ts` | **OK** (Clean shared import) |
| `orchestrator/runStep.ts` (`capturePackage`) | `orchestrator/capture.ts` (`capturePackage`) | `background/service-worker.ts`, `orchestrator/runStep.ts` | **OK** (Modularized) |
| `orchestrator/runStep.ts` (`getLiveSteps`) | `orchestrator/hud.ts` (`getLiveSteps`) | `background/service-worker.ts` | **OK** (Modularized) |
| `orchestrator/session.ts` (`resumeSession`) | *Removed in refactor* | `background/service-worker.ts` | **DIVERGENCE** (Human follow-up resume path was missing) |

---

## 5. Detailed Function Signature & Behavior Mismatches

### 1. `extension/src/popup/Chat.ts` $\rightarrow$ `isBusy` Lock
* **Reference**:
  ```ts
  const isBusy = session.status === "running";
  this.setInputDisabled(isBusy);
  ```
* **Current**:
  ```ts
  const isBusy = session.status === "running" || session.status === "waiting_human";
  this.setInputDisabled(isBusy);
  ```
* **Impact**: UI Deadlock. When the agent asks the user for confirmation or input (`waiting_human`), the input field was disabled, preventing the user from typing a response.

---

### 2. `remote-agent/types.ts` $\rightarrow$ `validateAgentAction`
* **Reference**:
  ```ts
  // Category-token format is NOT enforced here: a literal phrase from the user's own goal is legal.
  if (trimmedPlaceholder.length > 300) {
    return { ok: false, error: "'placeholder' exceeds 300 characters" };
  }
  ```
* **Current**:
  ```ts
  if (!PLACEHOLDER_TOKEN_REGEX.test(trimmedPlaceholder)) {
    return {
      ok: false,
      error: `Invalid placeholder token format: "${obj.placeholder}". Must match CATEGORY_N format.`,
    };
  }
  ```
* **Impact**: Blocks all natural typing actions. When a user requests typing non-sensitive or user-specified text (e.g., search terms or usernames), the planner's action was rejected by the schema validator.

---

### 3. `executor/agent-action.ts` $\rightarrow$ Goal Literal Value Resolution
* **Reference**:
  ```ts
  export function agentActionToExecutorActions(
    action: AgentAction,
    sanitized: ElementMeta[],
    map: Record<string, string>,
    goal?: string
  ): Action[] { ... }
  ```
  Allows goal-derived literal strings when verified on-device.
* **Current**:
  Dropped `goal` parameter; only resolves placeholders existing in the sensitive `map`.
* **Impact**: Non-PII user inputs from the goal failed to execute.

---

### 4. `utils/messaging.ts` $\rightarrow$ `chrome.scripting.executeScript` File List
* **Reference**:
  Tried to inject `dist/utils/dom-extractor.js` and `dist/privacy/sanitizer/structural-redact.js`.
* **Current (Fixed)**:
  Injects `dist/content/capture-content.js`.
* **Impact**: Resolved missing file runtime exception when reloading extension with open tabs.

---

## 6. Ranked Defect List

| ID | Severity | Subsystem | Description | Likely Chrome Symptom |
|---|---|---|---|---|
| **DEF-01** | **P0** | Extension Frontend (`Chat.ts`) | `isBusy` disabling input on `waiting_human` | User cannot respond to agent questions or OTP prompts; popup freezes. |
| **DEF-02** | **P0** | Remote Agent (`types.ts`) | Strict `CATEGORY_N` check on all type action placeholders | User typing goals (e.g. search queries, normal text) fail plan validation. |
| **DEF-03** | **P1** | Executor (`agent-action.ts`) | Missing `goal` string in `agentActionToExecutorActions` | Non-PII literal values in user goals produce empty actions (`[]`). |
| **DEF-04** | **P1** | Orchestrator (`session.ts`) | Missing `resumeSession` implementation | Answering human prompt cannot resume the active step loop. |
| **DEF-05** | **P2** | Navigation / Messaging | Unchecked `chrome://` page interactions | Hard Chrome exception `Cannot access a chrome:// URL`. |

---

## 7. Recommended Targeted Remediation Plan

1. **Popup Chat Responsiveness**:
   Restore `isBusy = session.status === "running"` in `extension/src/popup/Chat.ts` so the input box and send button are interactive during `waiting_human`.
2. **Planner Action Validation**:
   In `remote-agent/types.ts`, allow type action placeholders to be valid tokens (`PLACEHOLDER_TOKEN_REGEX`) OR goal literal strings capped at 300 characters.
3. **Executor Action Mapping**:
   In `executor/agent-action.ts`, pass `goal` to `agentActionToExecutorActions` and verify that non-token placeholders match substrings of the user's prompt before emitting `{ type: "type", target, value }`.
4. **Session Resume Protocol**:
   Re-integrate `resumeSession(session, humanReply)` in `orchestrator/session.ts` and ensure `RUN_GOAL` resumes paused sessions seamlessly.
5. **Restricted URL Guards**:
   Keep the pre-validation in `orchestrator/runGoal.ts` and `utils/messaging.ts` to guide users to standard web pages when on `chrome://` tabs.