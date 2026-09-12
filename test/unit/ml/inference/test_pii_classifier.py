"""ML-3 unit tests: local deterministic PII classification.

Run from the repository root:
    .venv-ml/Scripts/python.exe ml/inference/test_pii_classifier.py

All values are synthetic. Covers: positives per category, negatives,
formatting/case variations, multiple lines, bbox/confidence preservation,
source, surrounding punctuation, lookalike non-matches, and input
non-mutation. Exits 0 with "ALL CHECKS PASSED" on success.
"""

import copy
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "ml" / "inference"))

from pii_classifier import classify_line, classify_ocr_lines

# ---- 1. Positive examples per category (incl. formatting variations) ----

EMAIL_POS = [
    "test@example.com",
    "user.name+tag@sub.example.co.in",
    "Test@Example.COM",          # case variation
    "Email: test@example.com.",  # label + trailing punctuation
    "<test@example.com>",        # punctuation around value
]
PHONE_POS = [
    "+91 90000 00000",
    "90000 00000",
    "9000000000",
    "98765-43210",
    "Call me at 98765 43210.",
    "09876543210",
    "Mobile: +91-90000-00000",
]
PAN_POS = [
    "ABCDE1234F",
    "abcde1234f",          # case variation (case-insensitive)
    "PAN: ABCDE1234F,",
    "Pan no. AbCdE1234f",
]
AADHAAR_POS = [
    "1234 5678 9012",
    "123456789012",
    "1234-5678-9012",
    "Aadhaar: 1234 5678 9012.",
]
AMOUNT_POS = [
    "₹12,345",
    "₹12345",
    "Rs. 12,345",
    "Rs 12345",
    "INR 12,345",
    "$1,234.50",
    "€45.50",
    "£1,000",
    "12,345.00",           # bare but comma-grouped + decimals
    "Total: ₹1,23,45,678.",  # Indian grouping, currency-prefixed
    "{12,345",             # EasyOCR's rupee-glyph dropout ("₹" -> "{")
]

# ---- 2. Negatives / lookalikes that must NOT classify ----

NEG = [
    "TEST USER",
    "hello world",
    "user@localhost",        # no TLD
    "@dave said hi",         # bare @mention, empty local part
    "order 12345",           # plain number, no comma
    "12345",
    "12345.67",              # bare number, no comma
    "12,34",                 # invalid (non-3-digit) grouping
    "₹12.345",              # 3-digit fraction — malformed decimal
    "Rs 1,23",               # invalid grouping after currency
    "INR 99.999",            # 3-digit fraction after currency word
    "₹1,234.567",            # valid grouping, malformed fraction
    "ABCDE1234F9",           # PAN with trailing digit
    "xABCDE1234F",           # PAN embedded in longer token
    "12345678901",           # 11 digits
    "9123456789012",         # 13-digit run
    "Ref 001/2024",
    "INR",                   # currency word alone
    "₹",                     # symbol alone
    "v1.2.3",
    "https://example.com/page",
]

# ---- 3. Expected per-line category (positive sets map to one category) ----

EXPECTED = [
    ("EMAIL", EMAIL_POS),
    ("PHONE", PHONE_POS),
    ("PAN", PAN_POS),
    ("AADHAAR", AADHAAR_POS),
    ("AMOUNT", AMOUNT_POS),
]


def ocr_line(text: str, x: int = 10) -> dict:
    """Build a synthetic ML-2 OCR line. Distinct bbox/confidence per call."""
    return {"text": text, "bbox": [x, 20, 30, 40], "confidence": 0.8765}


def main() -> None:
    # 1-4: positives, formatting + case variations
    for category, examples in EXPECTED:
        for text in examples:
            got = classify_line(text)
            assert got == category, f"classify_line({text!r}) = {got!r}, expected {category!r}"
        print(f"  PASS {category}: {len(examples)} positive variant(s)")

    # 2/10: negatives and lookalikes
    for text in NEG:
        got = classify_line(text)
        assert got is None, f"classify_line({text!r}) = {got!r}, expected None"
    print(f"  PASS negatives: {len(NEG)} lookalike(s) correctly rejected")

    # 5-8: multiple OCR lines; bbox/confidence preservation; source
    lines = [
        {"text": "TEST USER", "bbox": [77, 61, 186, 36], "confidence": 0.9931},
        {"text": "test@example.com", "bbox": [75, 151, 284, 40], "confidence": 0.6541},
        {"text": "+91 90000 00000", "bbox": [79, 241, 258, 36], "confidence": 0.7140},
        {"text": "{12,345", "bbox": [77, 331, 126, 38], "confidence": 0.5996},
        {"text": "plain header", "bbox": [1, 2, 3, 4], "confidence": 0.1234},
    ]
    before = copy.deepcopy(lines)
    detections = classify_ocr_lines(lines)

    assert len(detections) == 3, f"expected 3 detections, got {len(detections)}"
    expected_cats = ["EMAIL", "PHONE", "AMOUNT"]
    for det, cat, src in zip(detections, expected_cats, lines[1:4]):
        assert det["category"] == cat, f"expected {cat}, got {det['category']!r}"
        assert det["bbox"] == src["bbox"], f"bbox not preserved exactly: {det['bbox']} != {src['bbox']}"
        assert det["confidence"] == src["confidence"], "confidence not preserved exactly"
        assert det["source"] == "vision", f"source must be 'vision', got {det['source']!r}"
        assert "element_id" not in det, "element_id must NOT be set (M4 owns it)"
    print("  PASS multi-line classification, bbox/confidence/source/keys")

    # 11: input non-mutation
    assert lines == before, "classify_ocr_lines mutated its input"
    print("  PASS input not mutated")

    print("ALL CHECKS PASSED")


if __name__ == "__main__":
    main()
