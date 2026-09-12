// tests/test-format-value.ts
// Phase 01: field-shape formatting (SIH26171 content/format.ts port,
// verbatim logic). The value a person says, reshaped to what the field
// accepts — the "DOB is 24th jan 2000" into DD-MM-YYYY case.

import {
  formatValue,
  dateFormatOf,
  parseDate,
  type FieldShape,
} from "../../../executor/format-value.js";
import process from "node:process";

const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  PASS ${name}`);
  else {
    failures.push(name + (detail ? ` (${detail})` : ""));
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const DOB_FIELD: FieldShape = {
  maxLength: 10,
  placeholder: "DD-MM-YYYY",
  title: "Enter Date of Birth in DD-MM-YYYY Format",
};

// --- The case that motivated the module -----------------------------------------
check(
  "natural-language DOB -> DD-MM-YYYY",
  formatValue("DOB is 24th jan 2000", DOB_FIELD).text === "24-01-2000",
  formatValue("DOB is 24th jan 2000", DOB_FIELD).text
);
check("already-correct DOB untouched", formatValue("24-01-2000", DOB_FIELD).text === "24-01-2000");
check("note reports the reshape, not the value",
  formatValue("24th jan 2000", DOB_FIELD).note === "reformatted to D-M-Y");

// --- Other orders ------------------------------------------------------------------
const ymd: FieldShape = { placeholder: "YYYY/MM/DD" };
check("YYYY/MM/DD order honoured", formatValue("24 jan 2000", ymd).text === "2000/01/24", formatValue("24 jan 2000", ymd).text);

const mdy: FieldShape = { pattern: "\\d{2}/\\d{2}/\\d{4}", title: "MM/DD/YYYY" };
check("MM/DD/YYYY from title", formatValue("jan 24 2000", mdy).text === "01/24/2000", formatValue("jan 24 2000", mdy).text);

// --- Two-digit years expand ----------------------------------------------------------
check("two-digit year expands (00 -> 2000)", formatValue("24-01-00", DOB_FIELD).text === "24-01-2000");
check("two-digit year expands (99 -> 1999)", formatValue("24-01-99", DOB_FIELD).text === "24-01-1999");

// --- What must be left alone ----------------------------------------------------------
check("non-date value in a date field left alone (page validates)",
  formatValue("not a date", DOB_FIELD).text === "not a date");
check("no shape hints -> value untouched",
  formatValue("24-01-2000", {}).text === "24-01-2000");
check("empty stays empty", formatValue("   ", DOB_FIELD).text === "");
check("maxlength hint alone does not force a date",
  formatValue("lo", { maxLength: 10 }).text === "lo");

// --- Hint discovery --------------------------------------------------------------------
check("dateFormatOf reads the placeholder", dateFormatOf(DOB_FIELD)?.order.join("-") === "D-M-Y");
check("dateFormatOf reads pattern+title", dateFormatOf(mdy)?.separator === "/");
check("dateFormatOf ignores unrelated hints", dateFormatOf({ maxLength: 10 }) === undefined);

// --- parseDate: month words, separators, invalid dates ---------------------------------
check("parseDate: numeric", parseDate("24-01-2000", ["D", "M", "Y"])?.d === 24);
check("parseDate: month word", parseDate("24 jan 2000", ["D", "M", "Y"])?.m === 1);
check("parseDate: 31st february is invalid", parseDate("31-02-2000", ["D", "M", "Y"]) === undefined);
check("parseDate: 30th april valid", parseDate("30-04-2000", ["D", "M", "Y"]) !== undefined);
check("parseDate: garbage rejected", parseDate("hello", ["D", "M", "Y"]) === undefined);

if (failures.length === 0) console.log("\nALL CHECKS PASSED");
else {
  console.error(`\nFAILED: ${failures.length} check(s)`);
  process.exit(1);
}
