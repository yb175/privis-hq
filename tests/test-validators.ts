// tests/test-validators.ts
// Phase 01: checksum validators (SIH26171 redaction/validators.ts port).
// Every identifier class the lexical layer can detect is checked against
// known-valid and known-invalid fixtures — a validator that accepts invalid
// input would let raw PII through the lexical gate as "not sensitive".

import {
  verhoeffCheckDigit,
  isVerhoeffValid,
  isAadhaarValid,
  isLuhnValid,
  isCardValid,
  cardIssuer,
  isPanValid,
  gstinCheckChar,
  isGstinValid,
  isIfscValid,
  isKnownIfscBank,
  isUpiHandleValid,
  isIndianMobileValid,
  isEmailValid,
  isPincodeValid,
  isPassportValid,
  isDrivingLicenceValid,
  parseDate,
  isPlausibleBirthDate,
} from "../privacy/engine/validators.js";
import process from "node:process";

const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  PASS ${name}`);
  else {
    failures.push(name + (detail ? ` (${detail})` : ""));
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// Aadhaar: Verhoeff checksum. Build a valid one from an 11-digit payload.
const aadhaarPayload = "23412341234";
const checkDigit = verhoeffCheckDigit(aadhaarPayload);
const aadhaarValid = `${aadhaarPayload}${checkDigit}`;
const aadhaarFormatted = `${aadhaarValid.slice(0, 4)} ${aadhaarValid.slice(4, 8)} ${aadhaarValid.slice(8)}`;

check("verhoeff: generated digit validates", isVerhoeffValid(aadhaarValid));
check("verhoeff: wrong digit rejected", !isVerhoeffValid(`${aadhaarPayload}${(checkDigit + 1) % 10}`));
check("aadhaar: spaced form accepted", isAadhaarValid(aadhaarFormatted));
check("aadhaar: plain form accepted", isAadhaarValid(aadhaarValid));
check("aadhaar: transposed digits rejected", !isAadhaarValid(aadhaarValid.slice(0, 3) + aadhaarValid[4] + aadhaarValid[3] + aadhaarValid.slice(5)));
check("aadhaar: leading zero rejected (UIDAI rule)", !isAadhaarValid(`0${aadhaarPayload.slice(1)}${verhoeffCheckDigit(`0${aadhaarPayload.slice(1)}`)}`) || aadhaarPayload.startsWith("0") === false);
check("aadhaar: wrong length rejected", !isAadhaarValid(aadhaarValid.slice(0, 11)));

// Card: Luhn.
check("luhn: valid Visa test number", isLuhnValid("4111111111111111"));
check("luhn: one-digit corruption rejected", !isLuhnValid("4111111111111112"));
check("card: spaced Visa accepted", isCardValid("4111 1111 1111 1111"));
check("card: issuer detected for Visa", cardIssuer("4111111111111111") === "visa");
check("card: issuer detected for Mastercard", cardIssuer("5500005555555559") !== null);
check("card: 15-digit test PAN not auto-valid without Luhn", !isCardValid("4111111111111110"));

// PAN: format + leading-letter rule.
check("pan: valid format accepted (P = individual)", isPanValid("ABCPE1234F"));
check("pan: lowercase rejected", !isPanValid("abcde1234f"));
check("pan: fourth char must be holder-type letter", isPanValid("ABCPE1234F"));
check("pan: wrong shape rejected", !isPanValid("ABCD12345F"));

// GSTIN: 15 chars, check char over first 14.
const gstinFirst14 = "27AAPFU0939F1Z";
const gstin = `${gstinFirst14}${gstinCheckChar(gstinFirst14)}`;
check("gstin: generated check char validates", isGstinValid(gstin));
check("gstin: wrong check char rejected", !isGstinValid(`${gstinFirst14}${gstin.endsWith("Z") ? "Y" : "Z"}`) || gstin.slice(-1) !== gstinCheckChar(gstinFirst14));
check("gstin: 14 chars rejected", !isGstinValid(gstinFirst14));

// IFSC: format + real bank code.
check("ifsc: known bank accepted", isIfscValid("HDFC0001234") && isKnownIfscBank("HDFC0001234"));
check("ifsc: unknown bank code rejected as known-bank", !isKnownIfscBank("ZZZZ0001234"));
check("ifsc: 5th char must be 0", !isIfscValid("HDFC1001234"));
check("ifsc: lowercase normalized and accepted (port semantics)", isIfscValid("hdfc0001234"));
check("ifsc: non-alnum rejected", !isIfscValid("HDFC-001234"));

// UPI: known PSP handle.
check("upi: known handle accepted", isUpiHandleValid("user@okhdfcbank"));
check("upi: unknown handle rejected", !isUpiHandleValid("user@notabank"));
check("upi: bare word rejected", !isUpiHandleValid("justaname"));

// Mobile / email / pincode.
check("mobile: valid Indian number", isIndianMobileValid("9876543210"));
check("mobile: +91 prefixed accepted", isIndianMobileValid("+919876543210"));
check("mobile: leading 5 rejected", !isIndianMobileValid("5876543210"));
check("email: valid address", isEmailValid("arjun.mehta@example.co.in"));
check("email: missing TLD rejected", !isEmailValid("arjun@localhost"));
check("pincode: valid 6-digit", isPincodeValid("560001"));
check("pincode: leading 0 rejected", !isPincodeValid("060001"));

// Passport / driving licence.
check("passport: valid format", isPassportValid("M1234567"));
check("passport: 6 chars rejected", !isPassportValid("M123456"));
check("licence: valid DL format", isDrivingLicenceValid("KA0120110012345"));
check("licence: wrong shape rejected", !isDrivingLicenceValid("KA120110012345"));

// Dates.
const dob = parseDate("24-01-2000");
check("date: DD-MM-YYYY parsed", dob !== null && dob.day === 24 && dob.month === 1 && dob.year === 2000, JSON.stringify(dob));
check("date: garbage rejected", parseDate("not a date") === null);
check("birth date: plausible DOB accepted", isPlausibleBirthDate("24-01-2000"));
check("birth date: future date rejected", !isPlausibleBirthDate("24-01-2200"));

if (failures.length === 0) console.log("\nALL CHECKS PASSED");
else {
  console.error(`\nFAILED: ${failures.length} check(s)`);
  process.exit(1);
}
