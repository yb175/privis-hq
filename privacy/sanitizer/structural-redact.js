// privacy/sanitizer/structural-redact.js — type-preserving placeholders in the JSON context.
// Locked placeholders: EMAIL_1, PAN_1, AADHAAR_1, AMOUNT_1, PHONE_1, NAME_1.
// Mapping table stays on-device for the whole session.

const CATEGORIES = ["EMAIL", "PAN", "AADHAAR", "AMOUNT", "PHONE", "NAME", "FACE", "PASSWORD"];

// Replaces detected values with <CATEGORY>_<n>; n is stable per session.
// Returns { sanitizedContext, mappingTable } — mappingTable never leaves the device.
function redactStructural(elements, detections) {
  // TODO
  return { sanitizedContext: null, mappingTable: null };
}

export { redactStructural, CATEGORIES };
