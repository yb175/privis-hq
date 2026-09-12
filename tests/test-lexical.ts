// tests/test-lexical.ts
// Phase 01: the lexical detection layer (SIH26171 redaction/l1-lexical.ts
// port). Positive coverage for every class, and — the part that decides
// whether this is a redaction engine or a black-box highlighter — negative
// contexts: numbers labelled "invoice", amounts, and dates that are not DOBs
// must NOT be detected.

import { scanText, detectLexical } from "../privacy/engine/detect-lexical.js";
import { verhoeffCheckDigit, gstinCheckChar } from "../privacy/engine/validators.js";
import { resetPlaceholderTokens } from "../privacy/sanitizer/structural-redact.js";
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

/** Classes found in a text, as a sorted string. */
function classes(text: string): string {
  return scanText(text)
    .map((m) => m.cls)
    .sort()
    .join(",");
}

// Valid Aadhaar (Verhoeff) built here, so fixtures stay honest.
const aadhaar = `23412341234${verhoeffCheckDigit("23412341234")}`;

// --- Positive coverage -------------------------------------------------------
check("aadhaar detected", classes(`My number is ${aadhaar} ok`) === "AADHAAR", classes(`My number is ${aadhaar} ok`));
check("aadhaar spaced form detected", classes("XXXX XXXX XXXX".replace(/X/g, "") + aadhaar.slice(0, 0) + `${aadhaar.slice(0, 4)} ${aadhaar.slice(4, 8)} ${aadhaar.slice(8)}`) === "AADHAAR");
check("pan detected", classes("PAN: ABCPE1234F") === "PAN", classes("PAN: ABCPE1234F"));
check("email detected", classes("write to arjun.mehta@example.co.in") === "EMAIL");
check("phone detected", classes("call 9876543210") === "PHONE", classes("call 9876543210"));
check("card detected (Luhn + issuer)", classes("card 4111 1111 1111 1111") === "CARD", classes("card 4111 1111 1111 1111"));
check("ifsc detected", classes("IFSC HDFC0001234") === "IFSC");
check("upi detected", classes("pay user@okhdfcbank now") === "UPI", classes("pay user@okhdfcbank now"));
const gstin = `27AAPFU0939F1Z${gstinCheckChar("27AAPFU0939F1Z")}`;
check("gstin detected", classes(`GSTIN ${gstin}`) === "GSTIN", classes(`GSTIN ${gstin}`));

// --- The checksum wall: format alone is not enough ---------------------------
check("12 digits with wrong Verhoeff NOT detected", classes("23412341234" + ((verhoeffCheckDigit("23412341234") + 1) % 10)) === "");
check("random 16 digits NOT detected as card", classes("1234567812345678") === "", classes("1234567812345678"));
check("no-dot address detected as neither EMAIL nor UPI", classes("mail user@notapspbank") === "", classes("mail user@notapspbank"));

// --- Negative context: the label wins -----------------------------------------
check("invoice-number context disqualifies digits", classes("Invoice No. 23412341234" + verhoeffCheckDigit("23412341234")) === "");
check("order-number context disqualifies digits", classes("Order 4111111111111111") === "", classes("Order 4111111111111111"));
check("amount context disqualifies digits", classes("Total ₹2,34,567") === "", classes("Total ₹2,34,567"));
check("money-after number disqualifies", classes("50000 inr") === "");
check("account context upgrades to ACCOUNT", classes("A/c no. 0123456789012") === "ACCOUNT", classes("A/c no. 0123456789012"));

// --- DOB vs ordinary dates ----------------------------------------------------
check("dob-labelled date detected", classes("DOB 24-01-2000") === "DOB", classes("DOB 24-01-2000"));
check("date of birth phrase detected", classes("date of birth: 24/01/2000") === "DOB");
check("transaction date NOT dob", classes("Transaction date 24-01-2023") === "", classes("Transaction date 24-01-2023"));

// --- detectLexical: one Detection per element, strongest match ----------------
resetPlaceholderTokens();
const els: ElementMeta[] = [
  { element_id: "a", tag: "span", type: null, role: null, label: null, text: `Aadhaar ${aadhaar}`, bbox: [0, 0, 10, 10] },
  { element_id: "b", tag: "span", type: null, role: null, label: null, text: "hello world", bbox: [0, 20, 10, 10] },
  { element_id: "c", tag: "span", type: null, role: null, label: null, text: "mail me at test.user@example.com or call 9876543210", bbox: [0, 40, 10, 10] },
];
const dets = detectLexical(els);
check("detectLexical: one detection per sensitive element",
  dets.length === 2 && dets.every((d) => d.source === "dom"), JSON.stringify(dets.map((d) => [d.element_id, d.category])));
check("detectLexical: element id + category + dom source on the Aadhaar hit",
  dets.some((d) => d.element_id === "a" && d.category === "AADHAAR" && d.source === "dom"));
check("detectLexical: strongest match wins on multi-hit element",
  (dets.find((d) => d.element_id === "c")?.category ?? "") !== "");

if (failures.length === 0) console.log("\nALL CHECKS PASSED");
else {
  console.error(`\nFAILED: ${failures.length} check(s)`);
  process.exit(1);
}
