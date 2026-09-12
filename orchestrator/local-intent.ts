// orchestrator/local-intent.ts
// Tier 0: the zero-LLM path for simple goals.
//
// PROVENANCE: the grammar shapes and the weighted resolver are ported (much
// reduced) from the approved reference repo PravAl2028/SIH26171,
// extension/src/worker/intent.ts + resolve.ts (author-granted permission,
// Phase 01). PRIVIS's tier-0 handles single-intent type/fill/click goals only;
// everything else — multi-clause, ambiguous, navigational — falls through to
// the remote planner unchanged.
//
// Why this exists: "type leo in first name" does not need a language model.
// A deterministic parse + a weighted resolver answers it with zero network
// calls, which means the user's sentence AND the value never leave the device.
// When anything is uncertain the answer is "not handled", and the step takes
// the normal sanitized-remote path.
//
// Safety scoping: runs only on the FIRST step of a session (the caller checks
// session.history.length === 0), so a click can never double-fire on a
// recapture loop, and a value that is already in the field is left alone.
//
// Node-pure.

import type { Action, ElementMeta } from "../types/index.js";
import { effectiveRole, selectorFor } from "../executor/agent-action.js";

export interface LocalIntentResult {
  /** True when tier 0 fully handled this goal and produced executor actions. */
  handled: boolean;
  actions: Action[];
  /** Why not handled, when handled=false. Counts/classes only — never a value. */
  reason?: string;
}

// ── Grammar ───────────────────────────────────────────────────────────────────

const TYPE_VERBS = ["type", "enter", "put", "write"];
const FILL_VERBS = ["fill", "set"];
const CLICK_VERBS = ["click", "press", "tap", "hit"];

/** Filler that sits between the verb and the field name. */
const TARGET_NOISE =
  /^(in|into|on|the|a|an|my|his|her|their|its|field|box|input|textbox|button|dropdown|of)\b/;
const TARGET_TAIL = /\b(field|box|input|textbox|button|dropdown|menu)$/;

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Peel leading filler + trailing category words: "in the first name box" -> "first name". */
function cleanTarget(raw: string): string {
  let target = norm(raw);
  for (;;) {
    const next = target.replace(TARGET_NOISE, "").trim();
    if (next === target) break;
    target = next;
  }
  return target.replace(TARGET_TAIL, "").trim();
}

interface Intent {
  verb: "type" | "click";
  target: string;
  value?: string;
}

export function parseGoal(goal: string): Intent | undefined {
  const g = norm(goal).replace(/["']/g, "");
  if (!g) return undefined;

  // Multi-clause goals ("fill X with leo then click submit") are not tier-0's
  // to answer: a value-first parse would happily type "leo then click submit"
  // into the field. Refuse and let the remote planner sequence it.
  if (/\b(?:then|after that)\b/.test(g) || /\b(?:and|then)\s+(?:click|press|tap|hit|type|enter|fill|set|submit)\b/.test(g)) {
    return undefined;
  }

  // Click: "click the submit button".
  const clickVerb = CLICK_VERBS.find((v) => g.startsWith(`${v} `));
  if (clickVerb) {
    const target = cleanTarget(g.slice(clickVerb.length + 1));
    if (target) return { verb: "click", target };
  }

  // Value-first: "type leo in first name", "enter x@y.in into the email box".
  const typeVerb = TYPE_VERBS.find((v) => g.startsWith(`${v} `));
  if (typeVerb) {
    const m = new RegExp(`^(.+)\\s+(?:in|into|on)\\s+(.+)$`).exec(g.slice(typeVerb.length + 1));
    if (m) {
      const value = norm(m[1] ?? "");
      const target = cleanTarget(m[2] ?? "");
      if (value && target) return { verb: "type", target, value };
    }
    return undefined;
  }

  // Target-first: "fill first name with leo", "set my email to x@y.in".
  const fillVerb = FILL_VERBS.find((v) => g.startsWith(`${v} `));
  if (fillVerb) {
    const m = new RegExp(`^(.+?)\\s+(?:with|to|as)\\s+(.+)$`).exec(g.slice(fillVerb.length + 1));
    if (m) {
      const target = cleanTarget(m[1] ?? "");
      const value = norm(m[2] ?? "");
      if (value && target) return { verb: "type", target, value };
    }
  }

  return undefined;
}

// ── The weighted resolver (SIH26171 resolve.ts weights) ──────────────────────

/** Attribute weights: label is what a human reads; text is what the page shows. */
const W_LABEL = 8;
const W_ROLE = 6;
const W_NAME = 4;
const W_TEXT = 2;
/** Below this the best match is not confident enough to act on. */
export const SCORE_FLOOR = 8;
/** The best must beat the runner-up by this much, or the target is ambiguous. */
export const CLEAR_MARGIN = 3;

function scoreElement(el: ElementMeta, target: string): number {
  let score = 0;
  const label = norm(el.label ?? "");
  if (label) {
    if (label === target) score += W_LABEL;
    else if (label.includes(target)) score += W_LABEL / 2;
  }
  const role = effectiveRole(el);
  if (role && role.toLowerCase() === target) score += W_ROLE;
  if (el.element_id.toLowerCase() === target) score += W_NAME;
  const text = norm(el.text);
  if (text && text === target) score += W_TEXT;
  return score;
}

export interface ResolvedTarget {
  el: ElementMeta;
  score: number;
}

/** Highest-scoring element for a target name; undefined below floor or ambiguous. */
export function resolveTarget(
  target: string,
  elements: ElementMeta[]
): { resolved: ResolvedTarget } | { ambiguous: true } | { none: true } {
  let best: ResolvedTarget | undefined;
  let second = 0;
  for (const el of elements) {
    const score = scoreElement(el, target);
    if (score === 0) continue;
    if (!best || score > best.score) {
      second = best?.score ?? second;
      best = { el, score };
    } else if (score > second) {
      second = score;
    }
  }
  if (!best || best.score < SCORE_FLOOR) return { none: true };
  if (best.score - second < CLEAR_MARGIN) return { ambiguous: true };
  return { resolved: best };
}

// ── The entry point ───────────────────────────────────────────────────────────

const FILLABLE_TAGS = new Set(["input", "textarea"]);
const CLICKABLE_ROLES = new Set(["button", "link"]);

/**
 * Try to answer a simple goal locally. `elements` is the SANITIZED element
 * list (labels intact — they are resolution evidence, not secrets; values are
 * placeholders, which is why a type action carries its own raw value from the
 * goal, never from the list).
 */
export function tryLocalIntent(goal: string, elements: ElementMeta[]): LocalIntentResult {
  const intent = parseGoal(goal);
  if (!intent) return { handled: false, actions: [], reason: "no-grammar-match" };

  const outcome = resolveTarget(intent.target, elements);
  if ("none" in outcome) return { handled: false, actions: [], reason: "target-not-found" };
  if ("ambiguous" in outcome) return { handled: false, actions: [], reason: "target-ambiguous" };
  const el = outcome.resolved.el;

  if (intent.verb === "click") {
    const role = effectiveRole(el);
    const clickable =
      CLICKABLE_ROLES.has(role ?? "") ||
      el.tag.toLowerCase() === "button" ||
      (el.tag.toLowerCase() === "input" && /^(submit|button|image)$/.test(el.type ?? ""));
    if (!clickable) return { handled: false, actions: [], reason: "target-not-clickable" };
    return {
      handled: true,
      actions: [{ type: "click", target: selectorFor(el) }],
    };
  }

  // type
  const tag = el.tag.toLowerCase();
  if (!FILLABLE_TAGS.has(tag) || el.type === "password" || el.type === "checkbox" || el.type === "radio") {
    return { handled: false, actions: [], reason: "target-not-fillable" };
  }
  // Already satisfied (a recapture after an earlier fill): leave it alone and
  // let the remote path decide what is next.
  if (norm(el.text) === intent.value) {
    return { handled: false, actions: [], reason: "already-filled" };
  }
  return {
    handled: true,
    actions: [{ type: "type", target: selectorFor(el), value: intent.value }],
  };
}
