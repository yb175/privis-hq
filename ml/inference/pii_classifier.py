"""Local deterministic PII classification for OCR results — ML-3.

Consumes ML-2 OCR lines ({text, bbox, confidence}) and classifies supported
sensitive text with pure regex rules, fully locally. No LLM, no network, no
cloud API, no browser API — this module imports nothing but the stdlib `re`.

Supported categories (exactly these five):
    EMAIL, PHONE, PAN, AADHAAR, AMOUNT

Not implemented (deliberately): NAME, PASSWORD, FACE (DOM/face-detector own
those), element_id assignment (M4 fusion owns DOM/vision association).

Output is Detection-like but NOT a full contract Detection:
    {"category", "bbox", "confidence", "source": "vision"}
- bbox and confidence are copied from the OCR line EXACTLY (no rounding,
  no rescaling, no merging) — one classification per OCR line.
- pixel-space bboxes stay pixel-space; the CSS/DOM conversion is fusion's job.

This is PATTERN CLASSIFICATION ONLY: it does not verify that a PAN is
registered, that an Aadhaar passes its checksum, that a phone is assigned,
or that an email exists. It answers "does this string look like X".

Library use:
    from pii_classifier import classify_line, classify_ocr_lines
    category = classify_line("test@example.com")        # -> "EMAIL" | None
    detections = classify_ocr_lines(ocr_lines)

CLI use (input: JSON file, either a bare list of OCR lines or {"lines": [...]}):
    python ml/inference/pii_classifier.py ocr_output.json
"""

import argparse
import json
import re

# --- Matching rules (search-based: sensitive value may sit inside a longer
# --- OCR line, e.g. "Email: test@example.com." — surrounding punctuation,
# --- whitespace, and label text are allowed).

# Conventional email: local@domain with a dotted TLD of 2+ letters.
# Rejects bare "@user" mentions, "user@host" without a TLD, etc.
EMAIL_RE = re.compile(
    r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}"
)

# Indian mobile: optional +91 or 0 prefix, then 10 digits starting 6-9,
# with optional single space/dash separators. The (?<!\d)/(?!\d) guards
# prevent matching inside longer digit runs (arbitrary long numbers).
PHONE_RE = re.compile(
    r"(?<!\d)(?:\+91[ -]?|0[ -]?)?[6-9]\d{4}[ -]?\d{5}(?!\d)"
)

# Indian PAN: 5 letters + 4 digits + 1 letter, case-insensitive,
# not embedded in a longer alphanumeric token.
PAN_RE = re.compile(
    r"(?<![A-Za-z0-9])[A-Za-z]{5}\d{4}[A-Za-z](?![A-Za-z0-9])"
)

# Aadhaar-style: 12 digits, optionally grouped 4-4-4 with space/dash.
# Pattern only — no Verhoeff checksum, no issuance check.
AADHAAR_RE = re.compile(
    r"(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}(?!\d)"
)

# Amount, two branches (searched together):
#   1. currency-prefixed: ₹ / Rs / Rs. / INR / $ / € / £ + number with
#      optional commas (any grouping) and optional 2-decimal fraction;
#   2. bare number: MUST have western comma grouping (one or more ",ddd"
#      groups) — this is the conservative branch that still catches OCR
#      output where EasyOCR dropped the ₹ glyph ("12,345", "12,345.00"),
#      while plain "12345" / "12345.67" (no comma) do NOT classify.
AMOUNT_RE = re.compile(
    r"(?:₹|Rs\.?|INR|\$|€|£)\s?\d[\d,]*(?:\.\d{1,2})?(?!\d)"
    r"|(?<![\d.,])\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?(?!\d)"
)

# Priority order matters when a string could match several rules.
# EMAIL and PAN are unambiguous shapes, checked first. PHONE before
# AADHAAR so "+91 ..." country-code forms never fall through to the
# 12-digit rule. AMOUNT last (broadest).
RULES: list[tuple[str, re.Pattern]] = [
    ("EMAIL", EMAIL_RE),
    ("PAN", PAN_RE),
    ("PHONE", PHONE_RE),
    ("AADHAAR", AADHAAR_RE),
    ("AMOUNT", AMOUNT_RE),
]


def classify_line(text: str) -> str | None:
    """Return the category for one OCR text line, or None."""
    for category, pattern in RULES:
        if pattern.search(text):
            return category
    return None


def classify_ocr_lines(lines: list[dict]) -> list[dict]:
    """Classify ML-2 OCR lines. Returns Detection-like dicts; the input
    list and its dicts are never mutated."""
    detections = []
    for line in lines:
        category = classify_line(line.get("text", ""))
        if category is None:
            continue
        detections.append({
            "category": category,
            "bbox": line["bbox"],
            "confidence": line["confidence"],
            "source": "vision",
        })
    return detections


def main() -> None:
    ap = argparse.ArgumentParser(description="Local deterministic PII classification for OCR results (ML-3)")
    ap.add_argument("ocr_json", help="JSON file of ML-2 OCR output: a list of {text, bbox, confidence} lines, or {\"lines\": [...]}")
    args = ap.parse_args()

    with open(args.ocr_json, encoding="utf-8") as f:
        data = json.load(f)
    lines = data["lines"] if isinstance(data, dict) else data
    print(json.dumps(classify_ocr_lines(lines), indent=2))


if __name__ == "__main__":
    main()
