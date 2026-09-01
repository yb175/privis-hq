# PRIVIS Agent Contract

This file is the human-readable contract every PRIVIS issue can build against, so
work stays parallel: no module waits on the Capture Layer or the vision model.
It mirrors `types/index.ts` (source of truth for shapes) and records the
non-negotiable privacy rules.

## Boxes (names are locked)

| # | Box | Role |
|---|-----|------|
| 1 | **Capture Layer** | Background service worker screenshots the tab (memory only) and reads DOM state. Background screenshots, content script reads DOM — these jobs are never swapped. |
| 2 | **Local Privacy Vision Engine** | Fuses DOM detections (now) with vision detections (later) into one detections list. |
| 3 | **Sanitizer** | Redacts pixels and replaces sensitive strings with stable placeholders. |
| 4 | **Policy Gate** | Allow / Human Approval / Block on the sanitized package. |
| 5 | **Remote Agent** | Receives only sanitized screenshot + sanitized JSON + goal; returns actions. |
| 6 | **Local Executor** | Content script resolves action targets against the real page DOM and clicks/types. |

## Data flow

```
Capture Layer ──CapturePackage──▶ Local Privacy Vision Engine ──Detection[]──▶ Sanitizer
    ──SanitizedPackage──▶ Policy Gate ──allow/human_approval/block──▶ Remote Agent
    ──Action[]──▶ Local Executor ──(real DOM over the wire, never over network)──▶ loop
```

## Types (mirrors `types/index.ts`)

### SensitiveCategory

```ts
type SensitiveCategory =
  | "EMAIL" | "PAN" | "AADHAAR" | "AMOUNT"
  | "PHONE" | "NAME" | "FACE" | "PASSWORD";
```

Detection categories use exactly these strings — nothing else.

### BoundingBox

`[x, y, width, height]` in CSS pixels relative to the top-left of the page viewport.

```ts
type BoundingBox = [number, number, number, number];
```

### Detection

One sensitive region, emitted by the Local Privacy Vision Engine.

```ts
interface Detection {
  element_id: string;
  category: SensitiveCategory;
  bbox: BoundingBox;       // [x, y, w, h]
  confidence: number;      // 0..1
  source: "dom" | "vision";
}
```

### ElementMeta

One page element as seen by the Capture Layer's content script.

```ts
interface ElementMeta {
  element_id: string;
  tag: string;
  type: string | null;     // input type, e.g. "email", "password"
  role: string | null;     // ARIA role
  label: string | null;    // accessible label / placeholder
  text: string;            // visible text (sensitive fields are values)
  bbox: BoundingBox;       // [x, y, w, h]
}
```

### BrowserState

```ts
interface Viewport { w: number; h: number; }

interface BrowserState {
  url: string;
  title: string;
  viewport: Viewport;
}
```

### CapturePackage

Output of the Capture Layer; the only thing the engine and Sanitizer consume.

```ts
interface CapturePackage {
  tabId: number;
  dataUrl: string;              // in-memory screenshot data URL
  elements: ElementMeta[];
  detections: Detection[];
  browserState: BrowserState;
}
```

### SanitizedContext / SanitizedPackage

Output of the Sanitizer. `sanitizedContext` keeps structure; sensitive `text`
values are replaced by placeholders. The SanitizedPackage is what reaches the
Policy Gate and (sanitized) the Remote Agent.

```ts
interface SanitizedContext {
  elements: ElementMeta[];
  browserState: BrowserState;
}

interface SanitizedPackage {
  goal: string;                 // human goal, filled by the orchestrator
  sanitizedScreenshot: string;  // redacted, in memory only
  sanitizedContext: SanitizedContext;
}
```

### Action / ActionResult

Output of the Remote Agent, executed by the Local Executor.

```ts
interface Action {
  type: string;                 // "click" | "type" | ...
  target: string;               // CSS selector resolved on the real page
  value?: string;
}

interface ActionResult {
  ok: boolean;
  error?: string;
}
```

### Policy Gate

```ts
type PolicyGateDecision = "allow" | "human_approval" | "block";

interface PolicyGateResult {
  decision: PolicyGateDecision;
  reason: string;
}

interface StepResult {
  decision: PolicyGateDecision;
  reason: string;
  actions?: ActionResult[];
}
```

## Placeholders

The Sanitizer replaces real values with stable, type-preserving placeholders so
layout and meaning survive while PII does not:

`EMAIL_1`, `PAN_1`, `AADHAAR_1`, `AMOUNT_1`, `PHONE_1`, `NAME_1`

- `PASSWORD` values are never extracted — the field is redacted by type, no placeholder.
- `FACE` is redacted as pixels only — no text placeholder.
- The Local Executor types **real** values from the on-device mapping table, never
  placeholder strings.

## Hard rules (never negotiable)

1. **Screenshot stays in memory.** `dataUrl` / `sanitizedScreenshot` exist only in
   memory during a step. Never write raw or sanitized screenshots to disk or storage.
2. **The mapping table never leaves the device.** The `element_id` → real-value map
   lives only inside the extension. Only placeholders and layout cross to the Remote Agent.
3. **The Remote Agent must never receive raw PAN, Aadhaar, password, or face pixels.**
   Anything below the Sanitizer is not network-visible.
4. **The Local Privacy Vision Engine has no code in this repo.** No `.py`, no `.onnx`,
   no training artifacts — the repo is TS/DOM only until the vision path lands (ML team issue).
5. **Name locking.** Boxes are exactly: Capture Layer, Local Privacy Vision Engine,
   Sanitizer, Policy Gate, Remote Agent, Local Executor. Don't rename.

## Fixtures

`fixtures/` contains one synthetic happy path — an employee portal
(`https://hr.internal.example/employee-portal`) with PAN, Aadhaar, email, amount,
phone, name, password, and a face avatar, plus a Submit button (`#submit`). All
values are synthetic; none are real teammate PII.

| File | Mirrors | Use |
|------|---------|-----|
| `fixtures/detections.json` | `Detection[]` | What the engine emits; input to the Sanitizer. |
| `fixtures/sanitized-context.json` | `SanitizedContext` | Expected Sanitizer output shape. |
| `fixtures/action-click-submit.json` | `Action` | What the Remote Agent returns; input to the Local Executor. |

An agent implementing any box can use `fixtures/` + `types/index.ts` as its only
inputs and outputs. See `fixtures/README.md`.