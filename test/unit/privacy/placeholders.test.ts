// tests/test-placeholders.ts
// Phase 01: the placeholder allocator (SIH26171 shared/placeholders.ts port).
// Stability, provenance, refusal of FACE/PASSWORD, and the wire-format regex
// the guard already enforces.

import {
  PlaceholderAllocator,
  formatPlaceholder,
  placeholderAllocator,
  resetPlaceholderTokens,
} from "../../../privacy/sanitizer/placeholders.js";
import { PLACEHOLDER_TOKEN_REGEX } from "../../../remote-agent/types.js";
import type { SensitiveCategory } from "../../../types/index.js";
import process from "node:process";

const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  PASS ${name}`);
  else {
    failures.push(name + (detail ? ` (${detail})` : ""));
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const a = new PlaceholderAllocator("t1");
check("first EMAIL is EMAIL_1", a.allocate("EMAIL", "x@y.in") === "EMAIL_1");
check("same value maps to the same placeholder (idempotent)",
  a.allocate("EMAIL", "x@y.in") === "EMAIL_1");
check("different value gets the next index",
  a.allocate("EMAIL", "z@y.in") === "EMAIL_2");
check("same value in a different class gets that class's counter",
  a.allocate("PHONE", "x@y.in") === "PHONE_1");
check("counters are per class", a.count("EMAIL") === 2 && a.count("PHONE") === 1);

check("resolve round-trips", a.resolve("EMAIL_2") === "z@y.in");
check("resolve of an invented placeholder is undefined", a.resolve("EMAIL_99") === undefined);

// Provenance: goal-side values are marked, page-side are not, and a value
// seen on the page then named by the user gains the mark.
const phoneToken = a.allocate("PHONE", "9876543210");
check("page value is not fromUser", !a.isFromUser(phoneToken));
a.allocate("PHONE", "9876543210", true);
check("same value named by the user gains the mark (one token)", a.isFromUser(phoneToken));
check("fresh fromUser token is marked", a.isFromUser(a.allocate("PAN", "ABCPE1234F", true)));

// NO_VALUE classes are refused, hard.
let refusedFace = false;
try { a.allocate("FACE", "whatever"); } catch { refusedFace = true; }
check("FACE allocation refused", refusedFace);
let refusedPass = false;
try { a.allocate("PASSWORD", "hunter2"); } catch { refusedPass = true; }
check("PASSWORD allocation refused", refusedPass);

// Wire format: every class token satisfies the guard's regex (the contract
// between allocator, guard and remote planner).
const classes: SensitiveCategory[] = [
  "EMAIL", "PAN", "AADHAAR", "AMOUNT", "PHONE", "NAME",
  "CARD", "IFSC", "GSTIN", "UPI", "ACCOUNT", "DOB", "PASSPORT", "LICENCE",
];
check(
  "every category's token matches PLACEHOLDER_TOKEN_REGEX",
  classes.every((c) => PLACEHOLDER_TOKEN_REGEX.test(formatPlaceholder(c, 1)))
);

// Session allocator: reset gives a clean slate.
resetPlaceholderTokens();
check("reset clears the session allocator", placeholderAllocator().count("EMAIL") === 0);
check("session allocator issues fresh tokens",
  placeholderAllocator().allocate("EMAIL", "x@y.in") === "EMAIL_1");

if (failures.length === 0) console.log("\nALL CHECKS PASSED");
else {
  console.error(`\nFAILED: ${failures.length} check(s)`);
  process.exit(1);
}
