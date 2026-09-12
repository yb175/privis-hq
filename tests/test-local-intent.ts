// tests/test-local-intent.ts
// Phase 01: tier-0 local intent. The deterministic path must handle simple
// type/click goals, refuse anything ambiguous, and never touch a field that
// is already filled.

import { parseGoal, resolveTarget, tryLocalIntent, SCORE_FLOOR, CLEAR_MARGIN } from "../orchestrator/local-intent.js";
import type { ElementMeta } from "../types/index.js";
import process from "node:process";

const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  PASS ${name}`);
  else {
    failures.push(name + (detail ? ` (${detail})` : ""));
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function el(
  element_id: string,
  tag: string,
  bbox: [number, number, number, number],
  extra: Partial<ElementMeta> = {}
): ElementMeta {
  return { element_id, tag, type: null, role: null, label: null, text: "", bbox, ...extra };
}

const page: ElementMeta[] = [
  el("first-name", "input", [10, 10, 200, 24], { label: "First name" }),
  el("last-name", "input", [10, 44, 200, 24], { label: "Last name" }),
  el("email", "input", [10, 78, 200, 24], { label: "Email address", type: "email" }),
  el("submit", "button", [10, 120, 100, 30], { label: "Submit", text: "Submit" }),
  el("agree", "input", [10, 160, 16, 16], { type: "checkbox", label: "I agree" }),
];

// --- Grammar -------------------------------------------------------------------
check("parse: value-first", JSON.stringify(parseGoal("type leo in first name")) === JSON.stringify({ verb: "type", target: "first name", value: "leo" }));
check("parse: fill-with", parseGoal("fill first name with leo")?.target === "first name");
check("parse: click", parseGoal("click the submit button")?.verb === "click");
check("parse: cleanTarget strips filler", parseGoal("type leo into the email box")?.target === "email");
check("parse: multi-clause goal does not match", parseGoal("fill first name with leo then click submit") === undefined);
check("parse: bare value without target does not match", parseGoal("type leo") === undefined);

// --- Resolver ------------------------------------------------------------------
const fn = resolveTarget("first name", page);
check("resolve: label match", "resolved" in fn && fn.resolved.el.element_id === "first-name");
check("resolve: partial label scores below floor", "none" in resolveTarget("name", page) || "ambiguous" in resolveTarget("name", page));
check("resolve: unknown target not found", "none" in resolveTarget("nonexistent thing", page));
check("resolve: click verb words find the button", "resolved" in resolveTarget("submit", page));
check("score floor/margin exported", SCORE_FLOOR === 8 && CLEAR_MARGIN === 3);

// --- tryLocalIntent: the handled paths ------------------------------------------
{
  const r = tryLocalIntent("type leo in first name", page);
  check("type goal handled", r.handled && r.actions.length === 1 && r.actions[0].type === "type");
  const a = r.actions[0] as { type: "type"; target: string; value?: string };
  check("action targets the resolved field", a.target === "#first-name", a.target);
  check("action carries the RAW value from the goal (never a placeholder)", a.value === "leo");
}

{
  const r = tryLocalIntent("click the submit button", page);
  check("click goal handled", r.handled && r.actions[0].type === "click");
  check("click targets the button", (r.actions[0] as { target: string }).target === "#submit");
}

{
  const r = tryLocalIntent("fill email address with test.user@example.in", page);
  check("email fill handled", r.handled, r.reason);
}

// --- tryLocalIntent: the refused paths (every one falls through to cloud) --------
check("unparseable goal refused", !tryLocalIntent("book me a flight to pune", page).handled);
check("unknown field refused", !tryLocalIntent("type leo in favourite colour", page).handled);
check("click on a text field refused (not clickable)",
  !tryLocalIntent("click the first name field", page).handled);
check("type into a checkbox refused",
  !tryLocalIntent("fill i agree with yes", page).handled);

// --- Already-filled: leave it alone ----------------------------------------------
{
  const filled = page.map((e) =>
    e.element_id === "first-name" ? { ...e, text: "leo" } : e
  );
  const r = tryLocalIntent("type leo in first name", filled);
  check("already-filled field is a no-op (falls through)", !r.handled && r.reason === "already-filled", r.reason);
}

// --- Placeholder text never typed --------------------------------------------------
{
  // After structural redaction the field's text is a placeholder; the local
  // path still types the goal's raw value, not the placeholder.
  const sanitized = page.map((e) =>
    e.element_id === "email" ? { ...e, text: "EMAIL_1" } : e
  );
  const r = tryLocalIntent("type a@b.in in email", sanitized);
  const a = r.actions[0] as { value?: string } | undefined;
  check("types the goal value even when the field shows a placeholder", r.handled && a?.value === "a@b.in");
}

if (failures.length === 0) console.log("\nALL CHECKS PASSED");
else {
  console.error(`\nFAILED: ${failures.length} check(s)`);
  process.exit(1);
}
