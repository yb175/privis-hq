# PRIVIS Browser Agent: Current Limitations and Production System Design

**Status:** Proposed
**Scope:** Browser-agent execution, perception, planning, privacy, reliability, and production operations
**Repository:** `privis-hq`
**Core promise:** Local eyes, local eraser, remote brain

## 1. Executive Summary

PRIVIS already has a strong privacy boundary:

```text
Capture Layer
  -> Local Privacy Vision Engine
  -> Sanitizer
  -> Policy Gate
  -> Remote Agent
  -> Local Executor
  -> recapture and repeat
```

The main problem is not Puppeteer, Playwright, or the LLM. The current limitations are architectural:

1. The remote planner receives no previous action history.
2. The agent can return only one action per model call.
3. The action vocabulary is too small for modern websites.
4. The DOM extractor sees only a narrow set of elements.
5. The executor uses basic synthetic DOM operations rather than browser-native interaction semantics.
6. Sessions are bound to one tab.
7. Waiting is page-load based, not application-state based.
8. Session state exists only in the Manifest V3 service worker's memory.
9. Safety is stronger than a normal prototype, but domain, action, and prompt-injection controls need to be expanded before production autonomy.

These gaps directly explain why the current agent struggles with real form filling, cab booking, shopping-cart flows, and multiple tabs.

The recommended direction is to keep the privacy-first extension architecture and replace the narrow browser-control layer with a richer, versioned browser interaction protocol. Playwright or Puppeteer is not required for the first production upgrade. The extension already controls the user's real Chrome tab and authenticated session. The priority is to improve perception, actions, state, synchronization, recovery, and durable session management.

## 2. Current System

### 2.1 Current runtime flow

`orchestrator/runStep.ts` implements the following loop:

```text
1. Capture DOM package
2. Capture screenshot
3. Verify DOM did not change between snapshots
4. Run local vision detection
5. Apply structural placeholders
6. Redact screenshot pixels
7. Run policy gate
8. Send sanitized package to remote server
9. Receive one AgentAction
10. Resolve the action against sanitized elements
11. Execute locally in the content script
12. Wait for tab status to settle
13. Recapture
14. Stop on done, ask_human, block, error, or step limit
```

The configured maximum is 25 steps in `orchestrator/session.ts`.

### 2.2 Current components

| Component | Current implementation | Current responsibility |
|---|---|---|
| Capture Layer | Chrome screenshot API plus content script | Captures visible screenshot, interactive DOM metadata, URL, title, viewport |
| Local Privacy Vision Engine | DOM detection plus local YuNet face pipeline | Detects sensitive values and faces before network transmission |
| Sanitizer | `structural-redact.ts`, `visual-redact.ts` | Replaces detected values with placeholders and redacts screenshot regions |
| Policy Gate | `privacy/policy-gate/policy-gate.ts` | Allows, blocks, or requests human approval |
| Remote Agent | Hono server plus OpenAI/Gemini clients | Chooses the next action from sanitized context |
| Guard | `remote-agent/guard.ts` | Validates model output and rejects raw PII or invalid actions |
| Local Executor | Content script and messaging bridge | Performs click, type, and scroll on the real tab |
| Session loop | `orchestrator/session.ts` | Maintains per-tab in-memory history and step budget |
| Transparency log | Chrome local storage | Stores sanitized outbound request and response metadata |

### 2.3 Current action contract

The remote agent can return:

```text
navigate
click
 type
scroll
search
done
ask_human
```

The remote model must return exactly one action per request. This restriction is explicit in `remote-agent/prompt.md` and enforced by `remote-agent/guard.ts`.

## 3. What the Current Agent Can Perform

The current implementation can perform these tasks when the page is simple, same-tab, visible, and compatible with the extractor:

- Navigate the current tab to an HTTP or HTTPS URL.
- Click a discovered button or element.
- Type a locally available sensitive value through a placeholder such as `EMAIL_1` or `PAN_1`.
- Type an exact non-sensitive phrase copied from the user's goal.
- Scroll the current page vertically.
- Detect selected classes of PII in DOM values.
- Detect faces locally and redact them from screenshots.
- Block or pause selected risky pages.
- Continue a sequence of steps after each action.
- Ask a human to handle passwords, OTPs, CAPTCHA, or ambiguous situations.

This is enough for a controlled demo form. It is not enough for arbitrary modern web applications.

## 4. Current Limitations, With Code Facts

### 4.1 Form filling is slow and fragile

**Fact:** The prompt requires exactly one action per model call.

**Evidence:** `remote-agent/prompt.md` rule 1 says the model must return one JSON action and never an array. `remote-agent/guard.ts` rejects arrays and `actions` arrays.

**Impact:** A form with eight fields requires approximately eight planning round trips, plus capture, redaction, policy, network, and execution overhead for every field. If the model call takes several seconds, a normal form becomes slow enough to appear broken.

**Additional issue:** There is a `lastStepResult` formatter in `remote-agent/packager.ts`, but `client-openai.ts` calls `buildUserPrompt(pkg)` without passing it. `client-gemini.ts` uses the same path. Therefore the model receives the current page and goal, but not the actual prior action result.

**Recommendation:** Add a guarded `batch` or `actions` contract for independent operations. Keep sensitive values as placeholders. Execute sequentially with per-action results and stop on the first failure.

Example contract:

```json
{
  "type": "batch",
  "actions": [
    { "type": "type", "target": { "ref": "v3:12" }, "placeholder": "NAME_1" },
    { "type": "type", "target": { "ref": "v3:13" }, "placeholder": "EMAIL_1" },
    { "type": "click", "target": { "ref": "v3:18" } }
  ]
}
```

The batch must not include actions that depend on intermediate page state unless the executor explicitly marks them as conditional.

### 4.2 The executor cannot perform real browser interactions

`content/capture-content.ts` currently executes:

- `window.scrollBy()` for scrolling
- `element.click()` for clicking
- direct `.value` assignment followed by `input` and `change` events for typing

This omits important browser behavior:

- focus and blur transitions
- keydown and keyup events
- Enter, Escape, Tab, and arrow keys
- pointerdown, pointerup, mouseover, and mousemove
- hover-only menus
- native select interaction
- drag and drop
- file attachment
- dialogs
- browser back and forward
- browser tab creation and switching

Many React, Vue, Angular, and custom widgets depend on event sequences rather than only the final `.value`.

**Recommendation:** Introduce action-specific executor methods and use native DOM APIs where possible:

```text
focus
click
fill
press
selectOption
check
uncheck
hover
drag
upload
waitFor
```

The executor must return structured error categories, not only a string:

```text
TARGET_NOT_FOUND
STALE_REFERENCE
NOT_INTERACTABLE
VALIDATION_FAILED
TIMEOUT
PERMISSION_REQUIRED
UNSUPPORTED_CONTROL
```

### 4.3 Dropdowns and selection controls are missing

The extractor includes `select`, but the remote `AgentAction` schema has no `select_option` action. The executor also has no selection branch.

This blocks:

- country and city selection
- vehicle type selection
- date and time controls
- quantity selectors
- sort and filter controls
- accessible listboxes
- radio groups and custom comboboxes

Cab booking commonly uses custom comboboxes rather than plain HTML `select` elements. The agent needs to type a location, wait for suggestions, choose a suggestion, and verify that the selected value was accepted.

**Recommendation:** Add:

```text
select_option
check
uncheck
choose_combobox_option
```

Represent the option by a versioned element reference and a sanitized visible label. Never trust an arbitrary model-generated CSS selector when a captured reference is available.

### 4.4 Keyboard actions are missing

There is no `press_key` action. This blocks common workflows:

- press Enter to submit a search
- press ArrowDown and Enter in autocomplete
- press Tab to move through a form
- press Escape to close a modal
- use Ctrl+A before replacing text
- use Backspace to clear a control
- operate keyboard-accessible date pickers

**Recommendation:** Add a constrained key enum rather than accepting arbitrary key strings:

```text
Enter, Tab, Shift+Tab, Escape, ArrowUp, ArrowDown,
ArrowLeft, ArrowRight, Backspace, Delete, Control+A
```

The policy gate should reject clipboard reads and key combinations that could exfiltrate data unless explicitly approved.

### 4.5 No reliable waiting for SPA state

`waitForTabSettled()` polls `chrome.tabs.get(tabId)` until `tab.status === "complete"`. That handles a full navigation, but it does not handle React/Vue/Angular state transitions after the document is already loaded.

Examples:

- Add-to-cart updates a cart badge without navigation.
- Uber suggestions arrive through an API call after typing.
- A booking button becomes enabled after validation.
- A loading spinner disappears without changing the URL.
- A modal is inserted into the DOM after a click.

The agent can recapture too early, see an incomplete state, and choose the wrong next action.

**Recommendation:** Add explicit synchronization actions and executor-side waits:

```text
wait_for_text
wait_for_element
wait_for_element_gone
wait_for_url
wait_for_network_quiet
wait_for_stable_dom
```

The default should be bounded and fail with a timeout. The agent should never use unbounded sleeps.

### 4.6 The captured DOM is too narrow

`utils/dom-extractor.ts` uses:

```text
input, textarea, select, button, [role='button'], img
```

It excludes or poorly handles many common interactive elements:

- anchors and links
- `[role=link]`
- tabs
- menu items
- options
- checkboxes and radios represented by custom elements
- comboboxes
- contenteditable areas
- elements with click handlers but no semantic role
- summary/details controls
- custom date-picker cells
- dynamically rendered overlays

The extractor also returns a flat list instead of a semantic accessibility tree. It does not preserve parent-child relationships, accessible descriptions, expanded state, checked state, selected state, disabled state, focused state, or z-order.

**Recommendation:** Use a layered capture strategy:

1. Accessibility tree as the primary structured representation.
2. DOM metadata for privacy detection and exact local mapping.
3. Screenshot for visual context and non-DOM surfaces.
4. Targeted visual detection only when accessibility and DOM representations are insufficient.

The browser agent research supports this hybrid approach. Microsoft Playwright MCP exposes structured accessibility snapshots, while production browser-agent research recommends accessibility structure plus selective vision instead of screenshot-only or flat DOM-only control.

### 4.7 No iframe support

The manifest content script does not set `all_frames: true`. The current message protocol targets the top-level tab and does not identify a frame.

This prevents reliable control of:

- Stripe and other payment widgets
- embedded maps
- authentication widgets
- third-party address selectors
- CAPTCHA frames
- embedded booking providers

**Recommendation:** Add frame-aware capture and execution. Every element reference should contain:

```text
{ tabId, frameId, snapshotVersion, elementRef }
```

Use `chrome.webNavigation` or CDP frame information to track frame lifecycle. Apply stricter policy rules to cross-origin frames because privacy and authorization boundaries are different there.

### 4.8 No Shadow DOM support

`document.querySelectorAll()` in the current content script does not traverse closed or open shadow roots automatically. Web components and design-system controls can therefore be invisible.

**Recommendation:** Traverse open shadow roots where permitted, include the shadow-root path in references, and use CDP or browser automation APIs for controls that cannot be reached safely from the content script. Closed shadow roots should produce an explicit unsupported-control result rather than a silent failure.

### 4.9 Single-tab execution only

`AgentSession` is keyed by one `tabId`. `navigateTab()` explicitly calls `chrome.tabs.update()` on that same tab. The code comment states that creating a new tab is intentionally not implemented.

The action contract has no `new_tab`, `switch_tab`, `close_tab`, or `list_tabs` action.

This blocks:

- opening a product page in a new tab while preserving search results
- comparing products across tabs
- copying an order number from one page to another
- OAuth flows that open a new tab or popup
- checkout pages opened by `target="_blank"`
- research workflows that maintain several sources

**Recommendation:** Add a browser context manager:

```text
BrowserContext
  tabs: Map<TabId, TabState>
  activeTabId
  focusedFrameByTab
  sessionId
```

Add actions:

```text
open_tab
switch_tab
close_tab
list_tabs
focus_tab
```

A tab switch must force a fresh capture. A tab reference must be validated against the current session and allowed domain set.

### 4.10 No durable session state

The session registry is an in-memory `Map<number, AgentSession>`. Manifest V3 service workers can be suspended and restarted. When that happens, in-memory sessions, pending approvals, action history, and local loop state can disappear.

This is a production reliability risk for:

- long checkout flows
- human approval pauses
- OTP handoffs
- slow pages
- extension restarts
- browser sleep and resume

**Recommendation:** Persist only non-sensitive control state in `chrome.storage.session` or `chrome.storage.local`:

- session identifier
- goal hash or sanitized goal
- tab IDs
- action history without raw values
- snapshot versions
- current state-machine phase
- approval status
- retry counters

Keep raw screenshots, raw DOM values, and placeholder maps in memory only unless a separately approved encrypted design is introduced.

### 4.11 No robust failure recovery

A failed action is recorded, but the planner is not given the last action result by the current client path. The agent therefore cannot reliably diagnose:

- stale target
- missing element
- disabled button
- validation error
- wrong page
- modal obstruction
- delayed content

The system often reaches `ask_human` or repeats an unproductive plan until the step limit.

**Recommendation:** Define a recovery loop:

```text
execute
  -> classify result
  -> recapture
  -> compare state
  -> choose recovery strategy
```

The model should receive a sanitized result such as:

```text
Previous action: click ref=v3:18
Result: FAILED
Category: NOT_INTERACTABLE
Detail: element covered by modal
Suggested recovery: inspect visible dialog controls
```

The executor should prevent identical retries unless the page state has changed.

### 4.12 No explicit completion verification

The remote agent can return `done`, but the system does not require a deterministic success condition for important tasks.

For example, “booking cab” should not be considered complete merely because a model says done. The system should verify one or more of:

- booking confirmation visible
- booking ID captured
- cart contains requested item and quantity
- form success message present
- URL matches a known completion state
- a domain adapter reports success

**Recommendation:** Add a verification phase:

```text
plan -> execute -> verify
```

The verifier should use deterministic DOM assertions first and model interpretation only as a fallback.

## 5. Why the Requested Use Cases Fail

### 5.1 Filling a form

Typical failure sequence:

```text
1. The agent captures only visible, narrowly selected controls.
2. It chooses one field.
3. One model call plans one type action.
4. Direct .value assignment may not trigger the site's expected event sequence.
5. The agent does not press Tab or Enter.
6. Validation or autocomplete state is not awaited.
7. The next capture may occur before the UI updates.
8. The model receives no previous result and may lose task progress.
9. A dropdown, radio button, custom widget, iframe, or hidden field stops progress.
```

The root cause is the combination of insufficient actions, no stateful planner context, and weak synchronization—not the absence of Puppeteer.

### 5.2 Booking a cab

Cab booking typically requires:

```text
open service
login or restore session
enter pickup
wait for suggestions
select pickup suggestion
enter destination
wait for suggestions
select destination suggestion
choose vehicle
choose payment method
confirm booking
handle OTP or human confirmation
verify booking ID
```

The current system is blocked by several independent constraints:

- password and OTP values are intentionally not automated
- custom combobox selection is unsupported
- keyboard actions are unsupported
- dynamic suggestion lists are not awaited
- vehicle/payment controls may be custom roles or iframes
- sensitive external pages may require policy approval or be blocked
- final booking needs a deterministic confirmation step
- a full flow may exceed the step budget once each action is a separate model round trip

A safe production version should treat cab booking as a domain-specific workflow with explicit confirmation before the irreversible booking action.

### 5.3 Adding products to cart

Typical failure sequence:

```text
1. Search input requires typing and Enter; Enter is unavailable.
2. Product links may be anchors, but anchors are not captured.
3. Product cards may use div click handlers or custom roles.
4. Add-to-cart changes SPA state without navigation.
5. The agent captures before the cart state is updated.
6. There is no wait-for-cart-badge or cart-state verification.
7. Quantity selectors and variants require unsupported select/keyboard actions.
8. Product comparisons across tabs are impossible.
```

The minimal fix is not a new browser engine. It is a richer action set, better capture, state-aware waits, and completion verification.

### 5.4 Opening multiple tabs

This currently cannot happen through the agent contract or executor:

- no tab action type
- session keyed to one tab
- navigation uses `tabs.update`, not `tabs.create`
- no tab lifecycle listeners
- no active-tab switching protocol
- no cross-tab memory model

Chrome itself provides the necessary primitives. The missing work is orchestration and safety policy.

## 6. Production Browser-Agent Research

### 6.1 Common implementation choices

Production browser agents generally combine several layers:

| Layer | Common technologies | Purpose |
|---|---|---|
| Browser control | Playwright, Puppeteer, Chrome DevTools Protocol | Reliable browser-native interaction |
| Page perception | Accessibility tree, DOM snapshot, screenshot, OCR/vision | Grounding actions in current state |
| Planner | OpenAI, Gemini, Claude, or specialized model | Chooses next action or action batch |
| Tool contract | Typed function/tool calls | Constrains model output |
| State | Rolling recent history plus compressed memory | Prevents amnesia and context growth |
| Synchronization | Locator waits, network/state waits, DOM stability | Prevents race conditions |
| Recovery | Error classification and alternate strategies | Handles dynamic pages and stale targets |
| Safety | Domain allowlist, action policy, confirmation gates | Limits blast radius |
| Operations | Queue, worker, checkpoints, logs, metrics, retries | Makes long-running execution reliable |

### 6.2 Playwright MCP and accessibility-first control

Microsoft Playwright MCP uses structured accessibility snapshots instead of requiring a vision model for every action. Its documented tool family includes navigation, screenshot, find, and browser lifecycle operations, while the broader production-browser-agent research describes interaction primitives such as:

- click, including double-click and right-click
- type with clear support
- hover
- press key
- select option
- upload file
- drag
- focus
- wait for condition
- browser tabs
- back navigation
- screenshot and snapshot
- native dialog handling
- bulk actions

The key design idea is not that screenshots are useless. It is that semantic browser state should be primary, with screenshots used when the accessibility representation is missing or misleading.

### 6.3 Stagehand and browser-agent primitives

Stagehand popularizes a small set of higher-level primitives:

- `observe`: inspect available actions
- `act`: execute a natural-language or structured action
- `extract`: return structured page data
- `agent`: run a higher-level agent loop

This is useful because it separates observation, action, extraction, and planning rather than forcing every task through one undifferentiated loop.

### 6.4 Production infrastructure patterns

Browser-use's published production architecture separates task acceptance from task execution:

```text
API -> database task row -> queue -> browser worker -> checkpoint storage -> result
```

The production system uses queues, worker isolation, checkpoints, retry semantics, dead-letter handling, and persisted artifacts. The key lesson for PRIVIS is that an in-memory extension loop is acceptable for a demo but insufficient for recoverable long-running tasks.

### 6.5 Research findings relevant to PRIVIS

The Firecrawl-retrieved production browser-agent paper, *Building Browser Agents: Architecture, Security, and Practical Solutions*, reports these relevant conclusions:

- Architecture is a stronger limiting factor than raw model capability.
- Hybrid accessibility-tree and vision context is more robust than either alone.
- Versioned element references prevent stale actions from targeting changed elements.
- Bulk actions significantly reduce round trips for form filling.
- Structured waits and rich error feedback are required for dynamic pages.
- Compressed history is needed for long-running workflows.
- Programmatic safety rules must not rely only on model judgment.
- Domain specialization and least privilege reduce security risk.
- General browser agents remain weak on real-time interaction, precise visual controls, canvas applications, and highly dynamic interfaces.

Sources:

- [Building Browser Agents: Architecture, Security, and Practical Solutions](https://arxiv.org/html/2511.19477v1)
- [Browser-use production architecture](https://browser-use.com/posts/production-architecture-browser-use)
- [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp)
- [Playwright MCP documentation](https://playwright.dev/mcp/introduction)
- [Stagehand](https://www.browserbase.com/stagehand)

## 7. Target Production Architecture

### 7.1 Architecture diagram

```text
                                     PRIVIS PRODUCTION SYSTEM

┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ USER'S CHROME                                                                             │
│                                                                                             │
│  ┌───────────────┐   ┌─────────────────┐   ┌─────────────────┐   ┌──────────────────────┐ │
│  │ Capture Layer │──>│ Privacy Vision  │──>│ Sanitizer       │──>│ Policy Gate          │ │
│  │               │   │ Engine          │   │                 │   │                      │ │
│  │ A11y tree     │   │ DOM PII         │   │ placeholders    │   │ domain policy        │ │
│  │ DOM metadata  │   │ face detector   │   │ image redaction │   │ action policy        │ │
│  │ screenshot    │   │ fusion          │   │ provenance      │   │ human approval       │ │
│  └───────┬───────┘   └─────────────────┘   └─────────────────┘   └───────────┬──────────┘ │
│          │                                                                    │            │
│          │                         sanitized state + refs + memory             │            │
│          │                                                                    ▼            │
│  ┌───────┴──────────────────────────────────────────────────────────────────────────────┐ │
│  │ Local Session and Browser Context Manager                                               │ │
│  │ tabs, frames, snapshot versions, action history, human approvals, recovery state       │ │
│  └───────┬──────────────────────────────────────────────────────────────────────────────┘ │
│          │                                                                                  │
│          │ sanitized request                                                                │
└──────────┼──────────────────────────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ OPERATOR AGENT SERVER                                                                         │
│                                                                                               │
│  ┌─────────────┐   ┌───────────────┐   ┌──────────────┐   ┌──────────────────────────────┐  │
│  │ API/Auth    │──>│ Task Manager  │──>│ Planner      │──>│ Guard and Policy Compiler    │  │
│  │             │   │               │   │              │   │                              │  │
│  │ bearer auth │   │ request ID    │   │ model router │   │ schema validation            │  │
│  │ origin ACL  │   │ idempotency   │   │ memory trim  │   │ PII scan                     │  │
│  │ rate limits  │   │ task state    │   │ tool choice  │   │ domain/action checks         │  │
│  └─────────────┘   └───────────────┘   └──────────────┘   └──────────────┬───────────────┘  │
│                                                                            │                  │
│                                            typed action or action batch    │                  │
└────────────────────────────────────────────────────────────────────────────┼──────────────────┘
                                                                             │
                                                                             ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ LOCAL EXECUTION                                                                               │
│                                                                                               │
│  version check -> resolve frame/ref -> precondition check -> execute -> classify result      │
│       ^                                                                                 │    │
│       └────────────── recapture, verify, recover, or request human approval ───────────┘    │
└─────────────────────────────────────────────────────────────────────────────────────────────┘

Operational side plane:

  durable control state -> session store
  sanitized audit events -> transparency log
  metrics/traces -> observability backend
  failed tasks -> retry queue / dead-letter queue
  screenshots -> optional encrypted, retention-limited artifact store
```

### 7.2 Recommended reference model

Every captured actionable element should receive a reference such as:

```text
v17:tab=42:frame=0:ref=108
```

The reference is valid only for snapshot version 17. If the DOM changes, the executor rejects the reference with `STALE_REFERENCE` and requests a fresh capture.

This is safer than allowing the model to reuse a CSS selector against a changed page.

### 7.3 Recommended state machine

```text
CREATED
  -> CAPTURING
  -> SANITIZING
  -> GATED
  -> PLANNING
  -> EXECUTING
  -> VERIFYING
  ->
     SUCCESS
     RECOVERING
     WAITING_HUMAN
     BLOCKED
     FAILED
     EXPIRED
```

Each state transition should be idempotent and recorded with a request ID and step ID.

## 8. Recommended Implementation Plan

### Phase 0: Instrument before changing behavior

Add measurements for:

- capture duration
- screenshot size
- DOM element count
- model latency
- executor latency
- wait latency
- action success rate by type
- stale-reference rate
- `ask_human` rate
- policy block rate
- step count per successful task
- repeated-action rate
- task completion verification rate

Without these metrics, reliability improvements cannot be proven.

### Phase 1: Fix the highest-impact logic

1. Pass prior action and result to the remote planner.
2. Add a compact session memory field.
3. Add `press_key`, `select_option`, `focus`, `hover`, and `wait_for`.
4. Expand extraction to links and standard ARIA roles.
5. Add explicit success verification.
6. Add structured executor error categories.

This phase is the smallest path to materially better form and shopping flows.

### Phase 2: Add safe batching

1. Add a `batch` action schema.
2. Allow batches only for independent actions.
3. Enforce a maximum batch size.
4. Execute one action at a time locally.
5. Return per-action results.
6. Stop the batch when page state changes unexpectedly.
7. Recapture after navigation, modal opening, or substantial DOM change.

Sensitive typing remains placeholder-based. The remote model must never receive actual values.

### Phase 3: Improve perception

1. Add accessibility-tree capture.
2. Add semantic states: disabled, checked, selected, expanded, focused.
3. Add parent/ancestor context.
4. Add frame-aware references.
5. Traverse open shadow roots.
6. Keep screenshots as a selective visual fallback.
7. Add intelligent context trimming for large pages.

### Phase 4: Add multi-tab support

1. Add `open_tab`, `switch_tab`, `close_tab`, and `list_tabs`.
2. Track tab lifecycle events.
3. Persist tab/session control state.
4. Require policy approval for domain changes.
5. Force recapture after tab switch.
6. Keep separate page snapshots but shared sanitized task memory.
7. Never copy raw values through the remote server.

### Phase 5: Production operations

1. Move long-running task control to a durable server-side task manager.
2. Use a queue for execution requests.
3. Checkpoint after every verified step.
4. Retry only classified transient failures.
5. Use a dead-letter queue for repeated failures.
6. Add task cancellation and expiry.
7. Add per-user and per-domain quotas.
8. Add encrypted, retention-limited artifacts only where required.

## 9. Safety Requirements

### 9.1 Keep the existing privacy contract

The following should remain non-negotiable:

- raw screenshots do not cross the network
- raw DOM values do not cross the network
- placeholder maps remain local
- password values are never extracted automatically
- remote actions cannot contain raw value fields
- all remote actions are validated before execution
- navigation is restricted to HTTP and HTTPS
- policy decisions are fail-closed

### 9.2 Add programmatic action policy

The executor, not only the model, must check the action target and current state before execution.

Require explicit confirmation for actions whose target or surrounding context contains terms such as:

```text
purchase, buy, pay, book, confirm, transfer, delete, refund,
submit, send, publish, cancel subscription, change password
```

This should be configurable by domain and task type. A cab-search agent can be allowed to search and select a route while requiring confirmation for the final booking.

### 9.3 Add domain allowlists and capability profiles

Do not give one general agent unrestricted access.

Example profiles:

| Profile | Navigation | Write actions | Sensitive actions |
|---|---|---|---|
| Research | Allowlisted public domains | Search/filter only | None |
| Form entry | One approved domain | Fill controls | Submit requires approval |
| Shopping | Approved commerce domains | Cart actions | Purchase requires approval |
| Booking | Approved booking domain | Search/select | Final booking requires approval |
| Assistant | Read-only | None | None |

### 9.4 Treat page content as untrusted input

Page text, hidden DOM nodes, alt text, comments, and search results can contain prompt injection. The model must never be allowed to override system policy because a page says to do so.

The executor must enforce:

- domain restrictions
- target restrictions
- action restrictions
- data-flow restrictions
- confirmation requirements

## 10. Non-Functional Requirements

### Reliability

- Every action has a bounded timeout.
- Every execution step is idempotent or has a recorded compensation strategy.
- Stale references fail closed.
- A browser restart can resume from the last verified checkpoint.
- A failed model call does not lose the session.

### Performance

Suggested initial targets:

| Metric | Target |
|---|---:|
| Local capture | <300 ms on ordinary pages |
| Local action dispatch | <150 ms excluding page response |
| State wait | bounded, default 5 s |
| Planner latency | tracked by model and region |
| Form with 8 independent fields | <=3 planning calls with batching |
| Duplicate action rate | <1% |
| Unclassified executor failures | 0% |

These are engineering targets, not current measurements.

### Privacy

- No raw-value logging.
- Sanitized logs have retention limits.
- Request IDs are non-sensitive.
- Placeholder maps are scoped to a session and cleared on completion.
- Remote server authentication is mandatory outside development.
- CORS remains allowlisted.

### Observability

Each step should emit:

```text
session_id
step_id
request_id
tab_id_hash
frame_id
snapshot_version
action_type
result_category
model
latency_ms
policy_decision
verification_result
```

Never emit raw values, raw screenshots, or full unsanitized DOM content.

## 11. Test Strategy

### Unit tests

- action schema validation
- placeholder allowlist enforcement
- stale reference rejection
- domain policy checks
- keyboard allowlist
- batch size and dependency rules
- success-verification rules
- session persistence and resume

### Integration tests

- controlled local form with text, email, password, select, radio, checkbox, combobox, validation, and modal states
- SPA cart badge update without navigation
- autocomplete with delayed suggestions
- navigation to a new page
- iframe form
- open shadow-root control
- new tab and tab switching
- service-worker restart during a session

### Security tests

- prompt injection in visible text
- prompt injection in hidden DOM
- PII in selectors and reasons
- unauthorized domain navigation
- cross-tab data leakage
- raw value in batch action
- forged sanitizer provenance
- replayed action against a changed snapshot

### Reliability tests

- network timeout
- model timeout
- page never reaches complete
- DOM mutation during capture
- element detached between planning and execution
- modal appears after planning
- duplicate click prevention
- browser restart and checkpoint recovery

## 12. Decision: Puppeteer or Playwright?

Do not introduce Puppeteer merely to solve the current limitations. The current extension already operates on the user's real Chrome session, which is a major product requirement for authenticated workflows and privacy.

Puppeteer or Playwright becomes justified if the product changes to a separate managed-browser model:

- browser runs on a server or isolated worker
- tasks execute headlessly or in a remote visible browser
- the product needs Playwright's mature locator and wait APIs
- multi-tab and frame control are easier outside Chrome extension constraints
- browser sessions are provisioned per task

That would be a different architecture with different privacy, login, and session-sharing tradeoffs. For the current PRIVIS design, improve the existing executor first. If a managed-browser backend is later added, prefer Playwright for its locator, frame, waiting, tracing, and browser-context APIs.

## 13. Final Recommendation

The shortest path to a production-capable PRIVIS agent is:

```text
1. Add planner memory
2. Add action results to the next prompt
3. Add keyboard, select, hover, focus, wait, and verification
4. Expand capture to accessibility semantics
5. Add versioned references
6. Add safe action batching
7. Add frame and shadow-root support
8. Add multi-tab orchestration
9. Persist recoverable session state
10. Add domain-specialized capability profiles
```

The central conclusion is:

> The browser agent is not stopped by lack of an automation library. It is stopped by a narrow action protocol, incomplete page perception, missing synchronization, stateless planning, and single-tab orchestration.

Keep the privacy architecture. Strengthen the browser-control and production-state layers around it.
