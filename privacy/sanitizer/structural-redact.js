// privacy/sanitizer/structural-redact.js
// DOM path of the Local Privacy Vision Engine + structural redaction.
// Pure functions: run in the content script (detection + placeholder swap)
// and the detections list also drives visual-redact in the background.
// Locked placeholders: EMAIL_1, PAN_1, AADHAAR_1, AMOUNT_1, PHONE_1, NAME_1.

const CATEGORIES = ["EMAIL", "PAN", "AADHAAR", "AMOUNT", "PHONE", "NAME", "FACE", "PASSWORD"];

// Order matters: first match wins per value (10 digits would match both AADHAAR and PHONE).
const PATTERNS = [
  { category: "PAN", re: /\b[A-Z]{5}\d{4}[A-Z]\b/, confidence: 0.9 },
  { category: "AADHAAR", re: /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/, confidence: 0.9 },
  { category: "EMAIL", re: /[\w.+-]+@[\w-]+\.[\w.]+/, confidence: 0.9 },
  { category: "PHONE", re: /(?:\+91[ -]?)?\b[6-9]\d{9}\b/, confidence: 0.8 },
  { category: "AMOUNT", re: /(?:₹|rs\.?|inr)[ ]?[\d,]+(?:\.\d{1,2})?/i, confidence: 0.8 },
];

// detectSensitive(elements) -> [{ element_id, category, bbox, confidence, source }]
// source is always "dom" here; "vision" detections join later in the engine.
function detectSensitive(elements) {
  const detections = [];
  for (const el of elements) {
    if (el.type === "password") {
      detections.push({ element_id: el.element_id, category: "PASSWORD", bbox: el.bbox, confidence: 1.0, source: "dom" });
      continue;
    }
    const value = el.text;
    if (!value) continue;
    for (const p of PATTERNS) {
      if (p.re.test(value)) {
        detections.push({ element_id: el.element_id, category: p.category, bbox: el.bbox, confidence: p.confidence, source: "dom" });
        break;
      }
    }
    // NAME via field label (regex on free text is unreliable — lower confidence).
    if (el.label && /\b(name|naam)\b/i.test(el.label) && value) {
      detections.push({ element_id: el.element_id, category: "NAME", bbox: el.bbox, confidence: 0.6, source: "dom" });
    }
  }
  return detections;
}

// applyPlaceholders(elements, detections) ->
//   { sanitized: elements with text swapped for placeholders, map: { element_id: realValue } }
// map NEVER leaves the calling context (stays in the content script).
function applyPlaceholders(elements, detections) {
  const byId = new Map(detections.map((d) => [d.element_id, d.category]));
  const counters = {};
  const map = {};
  const sanitized = elements.map((el) => {
    const category = byId.get(el.element_id);
    if (!category) return el;
    counters[category] = (counters[category] || 0) + 1;
    const placeholder = `${category}_${counters[category]}`;
    map[el.element_id] = el.text;
    return { ...el, text: placeholder };
  });
  return { sanitized, map };
}
