// tests/test-goal-tokenize.ts
// Phase 01: goal tokenization. The user's sentence must not cross the wire
// raw when it contains checksummed identifiers, and the tokens must be the
// SAME tokens the page elements use for the same values.

import { tokeniseGoal } from "../orchestrator/goal-tokenize.js";
import { placeholderAllocator, resetPlaceholderTokens } from "../privacy/sanitizer/placeholders.js";
import { verhoeffCheckDigit, gstinCheckChar } from "../privacy/engine/validators.js";
import process from "node:process";

const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  PASS ${name}`);
  else {
    failures.push(name + (detail ? ` (${detail})` : ""));
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const aadhaar = `23412341234${verhoeffCheckDigit("23412341234")}`;
const gstin = `27AAPFU0939F1Z${gstinCheckChar("27AAPFU0939F1Z")}`;

resetPlaceholderTokens();

// --- The sentence with PII in it ---------------------------------------------
{
  const r = tokeniseGoal(`fill the aadhaar field with ${aadhaar} and pay 500`);
  check("aadhaar in the goal is tokenised", r.changed && r.goal.includes("AADHAAR_1"), r.goal);
  check("raw aadhaar is gone from the tokenised goal", !r.goal.includes(aadhaar));
  check("classes counted", r.classes.AADHAAR === 1, JSON.stringify(r.classes));
}

{
  const r = tokeniseGoal(`use PAN ABCPE1234F and GSTIN ${gstin}`);
  check("pan + gstin tokenised together",
    r.goal.includes("PAN_1") && r.goal.includes("GSTIN_1"), r.goal);
}

{
  const r = tokeniseGoal("fill first name with leo");
  check("no PII -> goal unchanged", !r.changed && r.goal === "fill first name with leo");
}

{
  const r = tokeniseGoal("type leo in first name");
  check("tier-0 style goal untouched (nothing to hide)", !r.changed);
}

// --- Same value, page and goal: one token -------------------------------------
{
  resetPlaceholderTokens();
  const alloc = placeholderAllocator();
  const pageToken = alloc.allocate("AADHAAR", aadhaar); // what applyPlaceholders would do
  const r = tokeniseGoal(`enter ${aadhaar} in the field`);
  check("page and goal share one token for one value", r.goal.includes(pageToken), `${r.goal} / ${pageToken}`);
}

// --- Provenance ----------------------------------------------------------------
{
  resetPlaceholderTokens();
  tokeniseGoal(`my phone is 9876543210`);
  check("goal tokens carry fromUser provenance", placeholderAllocator().isFromUser("PHONE_1"));
}

if (failures.length === 0) console.log("\nALL CHECKS PASSED");
else {
  console.error(`\nFAILED: ${failures.length} check(s)`);
  process.exit(1);
}
