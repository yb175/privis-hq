// orchestrator/goal-tokenize.ts
// Phase 01: the user's goal sentence must not cross the wire raw.
//
// PROVENANCE: pattern ported from the approved reference repo PravAl2028/
// SIH26171, extension/src/worker/router.ts (placeholderGoal) — simplified to
// PRIVIS's single-source case: scan the goal with the checksum-validated
// lexical layer, mint session-stable placeholder tokens for every match, and
// substitute them into the sentence before it is attached to any outbound
// package or transparency entry.
//
// Before this module, the raw goal string went straight into SanitizedPackage
// .goal — an Aadhaar number typed into the task box crossed the wire in clear
// text beside a screenshot carefully arranged to hide exactly that.
//
// The tokens come from the SAME session allocator the Sanitizer uses, so a
// value in the goal and the same value in a page field share one token, and
// the numbering is stable across steps.
//
// Coverage is what the lexical layer covers: checksummed identifiers and
// labelled cases. A bare name ("fill first name with leo") has no shape and is
// not tokenised here — the remote agent sees it, same as the reference
// project's documented L1 limitation. Node-pure.

import { scanText } from "../privacy/engine/detect-lexical.js";
import { placeholderAllocator } from "../privacy/sanitizer/placeholders.js";
import type { SensitiveCategory } from "../types/index.js";

export interface TokenisedGoal {
  /** The goal with every lexical PII match replaced by its placeholder token. */
  goal: string;
  /** True when at least one substitution happened. */
  changed: boolean;
  /** Categories tokenised, counts only — safe for logs. */
  classes: Partial<Record<SensitiveCategory, number>>;
}

export function tokeniseGoal(goal: string): TokenisedGoal {
  const matches = scanText(goal);
  if (matches.length === 0) return { goal, changed: false, classes: {} };

  const allocator = placeholderAllocator();
  const classes: Partial<Record<SensitiveCategory, number>> = {};

  // Replace from the end backwards so earlier indices stay valid.
  let out = goal;
  for (const match of [...matches].sort((a, b) => b.start - a.start)) {
    const token = allocator.allocate(match.cls, match.text, true);
    out = out.slice(0, match.start) + token + out.slice(match.end);
    classes[match.cls] = (classes[match.cls] ?? 0) + 1;
  }

  return { goal: out, changed: true, classes };
}
