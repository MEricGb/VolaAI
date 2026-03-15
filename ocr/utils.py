"""
utils.py — Helper functions shared across the OCR / Trip Check pipeline.

Includes:
  - OCR text cleaning
  - Money / price parsing
  - Date normalization to YYYY-MM-DD
"""

import re
from datetime import datetime
from typing import Optional


# ── Text cleaning ─────────────────────────────────────────────────────────────

def clean_ocr_text(text: str) -> str:
    """
    Basic normalization of raw OCR output.
    - Collapse multiple whitespace / newlines into single spaces.
    - Remove non-printable characters.
    - Preserve hyphens, slashes, colons (needed for dates/routes).
    """
    # Replace multiple newlines / carriage returns with a single space
    text = re.sub(r"[\r\n]+", " ", text)
    # Collapse multiple spaces
    text = re.sub(r" {2,}", " ", text)
    # Remove non-printable ASCII (keep printable + common unicode)
    text = "".join(ch for ch in text if ch.isprintable())
    return text.strip()


def normalize_whitespace(s: str) -> str:
    """Strip and collapse internal whitespace."""
    return re.sub(r"\s+", " ", s).strip()


# ── Money parsing ─────────────────────────────────────────────────────────────

# Supported patterns:
#   €187          €187.50
#   EUR 187       EUR187.50
#   187 EUR       187.50 EUR
#   Total: €187   Price: 187 EUR
_PRICE_PATTERNS = [
    r"(?:Total|Price|Cost|Amount|Fare)[:\s]+[€$£₹₱฿]?\s*(\d{1,7}(?:[.,]\d{1,3})?)",  # labelled
    r"[€$£₹₱฿]\s*(\d{1,7}(?:[.,]\d{1,3})?)",                                           # symbol first
    r"(\d{1,7}(?:[.,]\d{1,3})?)\s*(?:EUR|USD|GBP|INR|AED|SAR|SEK|NOK|DKK|PLN|CZK|CHF|CAD|AUD|SGD|THB|MYR|IDR|RON|lei)\b",
    r"(?:EUR|USD|GBP|INR|AED|SAR|SEK|NOK|DKK|PLN|CZK|CHF|CAD|AUD|SGD|THB|MYR|IDR|RON)\s*(\d{1,7}(?:[.,]\d{1,3})?)",
]

_CURRENCY_SYMBOL_MAP = {"€": "EUR", "$": "USD", "£": "GBP", "₹": "INR", "₱": "PHP", "฿": "THB"}

_CURRENCY_CODE_RE = r"\b(EUR|USD|GBP|INR|AED|SAR|SEK|NOK|DKK|PLN|CZK|CHF|CAD|AUD|SGD|THB|MYR|IDR|RON)\b"


def parse_price(text: str) -> tuple[Optional[float], Optional[str]]:
    """
    Extract the first price found in text.
    Returns (amount_float, currency_str) or (None, None).
    """
    # Detect currency symbol
    currency = None
    for sym, code in _CURRENCY_SYMBOL_MAP.items():
        if sym in text:
            currency = code
            break
    # Check for explicit 3-letter currency codes
    m = re.search(_CURRENCY_CODE_RE, text, re.IGNORECASE)
    if m:
        currency = m.group(1).upper()

    for pattern in _PRICE_PATTERNS:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            raw = m.group(1).strip()
            # Normalize: remove spaces, convert comma decimal separator
            raw = raw.replace(" ", "").replace(",", ".")
            # If multiple dots, keep only the last (e.g. "1.234.56" → "1234.56")
            parts = raw.split(".")
            if len(parts) > 2:
                raw = "".join(parts[:-1]) + "." + parts[-1]
            try:
                return round(float(raw), 2), currency
            except ValueError:
                continue

    return None, None


# ── Date normalization ────────────────────────────────────────────────────────

_MONTH_MAP = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
    "january": 1, "february": 2, "march": 3, "april": 4, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10,
    "november": 11, "december": 12,
}

# Date patterns ordered most-specific → least-specific
_DATE_PATTERNS: list[tuple[str, str]] = [
    # ISO: 2026-04-12
    (r"\b(\d{4})-(\d{2})-(\d{2})\b", "iso"),
    # dd/mm/yyyy or dd.mm.yyyy or dd-mm-yyyy
    (r"\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b", "dmy"),
    # "12 Apr 2026" or "Apr 12, 2026" or "April 12 2026"
    (r"\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b", "dmy_text"),
    (r"\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b", "mdy_text"),
    # "12 Apr" or "Apr 12" — no year; assume current/next year
    (r"\b(\d{1,2})\s+([A-Za-z]{3,9})\b", "dm_text"),
    (r"\b([A-Za-z]{3,9})\s+(\d{1,2})\b", "md_text"),
]


def normalize_date(text: str, reference_year: int = 2026) -> Optional[str]:
    """
    Try to parse a date string and return YYYY-MM-DD.
    Returns None if parsing fails.
    """
    t = text.strip()

    for pattern, fmt in _DATE_PATTERNS:
        m = re.search(pattern, t, re.IGNORECASE)
        if not m:
            continue
        try:
            if fmt == "iso":
                y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            elif fmt == "dmy":
                d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            elif fmt == "dmy_text":
                d = int(m.group(1))
                mo = _MONTH_MAP.get(m.group(2).lower()[:3])
                y = int(m.group(3))
                if mo is None:
                    continue
            elif fmt == "mdy_text":
                mo = _MONTH_MAP.get(m.group(1).lower()[:3])
                d = int(m.group(2))
                y = int(m.group(3))
                if mo is None:
                    continue
            elif fmt == "dm_text":
                d = int(m.group(1))
                mo = _MONTH_MAP.get(m.group(2).lower()[:3])
                y = reference_year
                if mo is None:
                    continue
            elif fmt == "md_text":
                mo = _MONTH_MAP.get(m.group(1).lower()[:3])
                d = int(m.group(2))
                y = reference_year
                if mo is None:
                    continue
            else:
                continue

            dt = datetime(y, mo, d)
            return dt.strftime("%Y-%m-%d")
        except (ValueError, TypeError):
            continue

    return None


def extract_date_range(text: str, reference_year: int = 2026) -> tuple[Optional[str], Optional[str]]:
    """
    Try to extract a departure + return date pair from text like:
      "Apr 12 - Apr 16"
      "12-16 Apr"
      "2026-04-12 → 2026-04-16"
    Returns (depart_date, return_date) as YYYY-MM-DD strings or None.
    """
    # Pattern: two dates separated by -, –, →, to
    separator = r"\s*(?:-{1,2}|–|→|to)\s*"

    range_patterns = [
        # ISO range: 2026-04-12 - 2026-04-16
        r"(\d{4}-\d{2}-\d{2})" + separator + r"(\d{4}-\d{2}-\d{2})",
        # "Apr 12 - Apr 16" or "12 Apr - 16 Apr"
        r"([A-Za-z]{3,9}\s+\d{1,2})" + separator + r"([A-Za-z]{3,9}\s+\d{1,2})",
        r"(\d{1,2}\s+[A-Za-z]{3,9})" + separator + r"(\d{1,2}\s+[A-Za-z]{3,9})",
        # "12-16 Apr" (same month range)
        r"(\d{1,2})" + separator + r"(\d{1,2})\s+([A-Za-z]{3,9})",
    ]

    for pattern in range_patterns:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            if len(m.groups()) == 3:
                # "12-16 Apr" form — both days share the same month
                month = m.group(3)
                d1 = normalize_date(f"{m.group(1)} {month}", reference_year)
                d2 = normalize_date(f"{m.group(2)} {month}", reference_year)
            else:
                d1 = normalize_date(m.group(1), reference_year)
                d2 = normalize_date(m.group(2), reference_year)

            if d1 and d2 and d1 != d2:
                return d1, d2
            if d1:
                return d1, None

    # Fallback: scan all dates, separating those with explicit years from those without
    explicit_dates: list[str] = []   # dates found WITH a year in the text
    inferred_dates: list[str] = []   # dates whose year was assumed from reference_year

    # Patterns that include a year
    year_patterns = [(p, f) for p, f in _DATE_PATTERNS if f in ("iso", "dmy", "dmy_text", "mdy_text")]
    # Patterns that lack a year
    no_year_patterns = [(p, f) for p, f in _DATE_PATTERNS if f in ("dm_text", "md_text")]

    for pattern, fmt in year_patterns:
        for m in re.finditer(pattern, text, re.IGNORECASE):
            d = normalize_date(m.group(0), reference_year)
            if d and d not in explicit_dates:
                explicit_dates.append(d)

    for pattern, fmt in no_year_patterns:
        for m in re.finditer(pattern, text, re.IGNORECASE):
            d = normalize_date(m.group(0), reference_year)
            if d and d not in explicit_dates and d not in inferred_dates:
                inferred_dates.append(d)

    if len(explicit_dates) >= 2:
        # Best case: two fully-qualified dates found
        d1, d2 = explicit_dates[0], explicit_dates[1]
        return (d1, d2) if d2 > d1 else (d1, None)

    if len(explicit_dates) == 1:
        # One explicit date; only accept an inferred date as return if it's
        # in the same year (avoids mixing "2018-03-26" depart with "2026-03-26" inferred)
        d1 = explicit_dates[0]
        d1_year = d1[:4]
        ref_year_str = str(reference_year)
        same_year_inferred = [d for d in inferred_dates if d[:4] == ref_year_str and d > d1]
        if same_year_inferred and d1_year == ref_year_str:
            return d1, same_year_inferred[0]
        return d1, None

    if inferred_dates:
        d1 = inferred_dates[0]
        d2 = inferred_dates[1] if len(inferred_dates) > 1 else None
        if d2 and d2 > d1:
            return d1, d2
        return d1, None

    return None, None
