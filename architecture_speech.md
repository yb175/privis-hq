# PRIVIS — Round 1 Presentation Prep (SIH26171)

Audience: college professors + internal judges.
Locked one-liner: **local eyes, local eraser, remote brain.**
Locked architecture names (never rename, even for flow): Capture Layer → Local Privacy Vision Engine → Sanitizer → Policy Gate → Remote Agent → Local Executor.

---

## A. Jargon table

| Term | Plain English (non-CS professor) | Everyday analogy | SAY on stage (≤12 words) | DON'T say |
|---|---|---|---|---|
| browser agent | A program that uses a website for you — reads the page, fills fields, presses buttons | A helper sitting at your desk doing your form-filling | "It does website tasks on your behalf." | "LLM-driven autonomous crawler", "agentic loop" |
| DOM | The page's underlying structure — the list of every field, button and label behind what you see | The skeleton under the skin; you see the face, we read the bones | "The page's hidden structure of fields and buttons." | "Tree of nodes", "selector query", "XPath" |
| bounding box | The exact rectangle on screen where something appears | The dotted outline on a newspaper photo showing what to skip | "Where each item sits on the screen." | "x/y coordinates", "getBoundingClientRect" |
| screenshot capture | Taking a picture of what's currently visible in the browser tab | Snipping the screen, in memory only | "A photo of the page, kept in memory." | "pixels", "base64 data URL", "framebuffer" |
| Local Privacy Vision Engine | Our on-laptop program that *looks* at the screenshot and finds faces and ID-like regions | A security guard spotting what must be covered before copying a document | "On-device eyes that spot faces and card numbers." | "ONNX", "YuNet", "model inference", "tensors" |
| PII | Personally Identifiable Information — data that points to *you* | Your PAN card is PII; a photo of a street is not | "Data that can identify the user." | spell out the acronym every time; "GDPR-relevant entities" |
| placeholder (PAN_1) | A stand-in token that replaces a real value, like a stage name for your card number | "John Doe" on a form; the real name stays in your drawer | "PAN_1 replaces the number; real value never travels." | "mapping dictionary", "tokenization" (sounds like fintech) |
| Sanitizer | The step that covers sensitive text and pixels *before* anything is sent out | The black marker over a classified document before emailing it | "It blacks out private data before sending." | "redaction pipeline", "structural + visual redaction" |
| Policy Gate | A traffic cop: decides if this page is safe to ask the cloud about at all | Hotel security checking whether a visitor may enter | "It can refuse before any data leaves." | "rules engine", "deny-by-default posture" |
| Remote Agent | The cloud AI that reads the hidden-out page and decides the next single action | An consultant who advises — but never sees your original papers | "Cloud brain plans; it sees only masked data." | "GPT/Gemini API", "prompt", "model endpoint" |
| Local Executor | The part that actually types and clicks — on this laptop, from local values | Your own hands; the advisor only suggested which button | "Typing and clicking happen right here." | "content script", "synthetic DOM events" |
| on-device | Computed here, on this laptop — nothing sent elsewhere for that step | Cooking in your own kitchen, not ordering in | "Runs here, on the user's machine." | "client-side", "edge execution", "in-browser ML" |
| sanitized context | The masked summary the cloud is allowed to see — fields, buttons, placeholders | The blacked-out copy, not the original file | "What the cloud is permitted to see." | "serialized JSON payload", "context window" |
| browser extension | PRIVIS's delivery form — a small add-on that lives inside Chrome, no install, no cloud account | A toolkit that clips onto the browser, like a stapler on a desk | "No app, no login — it runs inside Chrome." | "MV3 service worker", "manifest", "content-script injection" |

---

## B. 2.5-minute architecture script

*(Read almost verbatim. One speaker. ~150 words/min; timing markers assume slides stay on the architecture diagram.)*

**[0:00 — Open, from the user's point of view]**
"Imagine a normal page: a form asking your name, your PAN number, your salary, and a Submit button. You want a helper to fill and submit it for you. Your instinct is right to hesitate — the helper would read your PAN and salary. PRIVIS is the version of this helper where that hesitation no longer applies. Here is how, block by block."

**[0:20 — 1. Capture Layer]**
"What it does: it takes a photo of the page and lists every field and button. Why it exists: a helper needs to see what you see. The photo and the list stay in the computer's short-term memory — never saved, never sent."

**[0:40 — 2. Local Privacy Vision Engine]**
"What it does: our own on-device checker looks at that photo and finds faces, card numbers, signature-like regions. Why it exists: text scanning alone misses what only a picture reveals. So this happens locally, in front of a camera, not on someone's server."

**[1:00 — 3. Sanitizer]**
"What it does: now the black marker comes out. Every sensitive word and sensitive picture-area gets covered. In its place go stand-in labels — 'PAN_1', 'NAME_1' — real values locked in a local drawer only this laptop can open. Why: whatever leaves the machine must carry nothing personal."

**[1:20 — 4. Policy Gate]**
"What it does: before we even ask the cloud, a traffic cop checks the situation. Some pages are too sensitive to share, even masked — the cop refuses, and the run stops here. Why: 'ask a question safely' is as important as 'answer safely'."

**[1:40 — 5. Remote Agent]**
"What it does: the cloud AI reads only the masked page, and decides the *next* step — 'click Submit' or 'enter PAN_1 in this field'. Why a cloud brain: understanding an unfamiliar page takes a large general model we can't run on a student laptop. But notice: it reasons over the blacked-out copy. It never sees your PAN — and it never even *sees* the values behind PAN_1."

**[2:05 — 6. Local Executor]**
"What it does: the plan comes back, and *this* laptop does the work. The stand-in 'PAN_1' is swapped with the real value locally, and the typing and clicking happen right here. Why: the advisor suggests; your hands do. The cloud's answer is a suggestion, not an action."

**[2:20 — Close, one breath]**
"So to summarize the one promise: what leaves the laptop is a masked page — stand-in names, no digits, no faces. What never leaves: your name, your PAN, your salary, your photo, your real values, ever. Local eyes, local eraser, remote brain. Thank you — we'll take questions."

---

## C. 5 backup one-liners (when a professor interrupts)

1. **"How is this different from just asking ChatGPT?"** — "If you paste your form into ChatGPT, your PAN goes to their servers. With PRIVIS, the AI plans your actions without ever learning your PAN."
2. **"Where is the AI model?"** — "The reading model is in the cloud; the spotting model — the on-device eyes — is ours, runs on the laptop, no internet for that step."
3. **"Why can't the whole thing run locally?"** — "We tried the reasoning too: useful page-understanding needs a model hundreds of times heavier than our detector. So we put the heavy *seeing* local and the light *thinking* remote — and the local sanitizer makes what goes remote safe."
4. **"Is the data encrypted?"** — "Encryption protects data in transit. We protect something earlier: it never *becomes* data-in-transit. Masked text needs no lockbox."
5. **"What if your sanitizer misses something?"** — "Then the Policy Gate is the second wall — it can refuse the whole request. And the cloud only ever gets the masked copy even when gates pass. Defense in depth."

---

## D. 3 things NOT to say in Round 1

1. **No accuracy numbers we can't cite.** Never say "95% detection" or "zero leakage" — say "our detector finds faces and card-shaped numbers on the test pages we show today." If asked for numbers: "that's Round-2 evaluation work; today is the architecture and the guarantee."
2. **Never claim we automate bank / IRCTC / any real site.** We run against a safe demo form. "It works on IRCTC" invites a live demo demand and a security-ethics question we shouldn't open here. Say: "any form-filling site the gates allow."
3. **Don't say "AI ensures privacy."** That's the shallow claim the panel has heard a hundred times. PRIVIS's privacy comes from *plumbing* — the Sanitizer and Gate are ordinary code doing an ordinary, checkable black-marker job; the AI just reads the copy. If pressed on "is AI privacy-safe": "AI isn't privacy-safe by itself. The design makes it safe."

---

### Presenter notes
- Both speakers must know the six names cold and in order; no improvising synonyms ("module", "component") — judges anchor on consistency.
- The demo form (name / PAN / salary / Submit) should be the same page described in section B — walk it once, show the HUD swapping placeholders while the audience sees the blacked-out screenshot.
- If time is cut to 90s: cut block 2's second sentence and block 5's "Why a cloud brain" sentence; never cut the close.
