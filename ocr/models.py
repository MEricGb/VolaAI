"""
models.py — Data models for the OCR / Trip Check feature.

BookingInfo    : normalized fields extracted from a booking screenshot.
TripCheckPayload : the full result returned by TripCheckService.
"""

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class BookingInfo:
    """
    Structured travel details extracted from an image via OCR + parsing.
    Every field is Optional — partial results are valid.
    """

    # ── Classification ──────────────────────────────────────────────────────
    booking_type: Optional[str] = None   # "flight" | "hotel" | "search_result" | "unknown"

    # ── Route ───────────────────────────────────────────────────────────────
    origin: Optional[str] = None           # city name as found in text
    destination: Optional[str] = None      # city name as found in text
    origin_code: Optional[str] = None      # IATA code, e.g. "OTP"
    destination_code: Optional[str] = None # IATA code, e.g. "BCN"
    route_text: Optional[str] = None       # raw route string as seen in OCR

    # ── Dates ────────────────────────────────────────────────────────────────
    depart_date: Optional[str] = None      # normalized YYYY-MM-DD
    return_date: Optional[str] = None      # normalized YYYY-MM-DD or None (one-way)

    # ── Airline / Hotel ──────────────────────────────────────────────────────
    airline: Optional[str] = None
    hotel_name: Optional[str] = None

    # ── Price ────────────────────────────────────────────────────────────────
    price: Optional[float] = None
    currency: Optional[str] = None         # "EUR", "USD", "GBP", …

    # ── Passengers ───────────────────────────────────────────────────────────
    passengers: Optional[int] = None

    # ── Meta ─────────────────────────────────────────────────────────────────
    raw_text: str = ""                     # original OCR output, always preserved
    confidence: Optional[float] = None    # 0.0 – 1.0 heuristic score
    notes: list[str] = field(default_factory=list)  # warnings / inferences


@dataclass
class TripCheckPayload:
    """
    Top-level result returned by TripCheckService.process_image().
    """

    success: bool
    booking_info: Optional[BookingInfo] = None

    # Structured dict ready to pass to a Vola scraper.
    # Example:
    #   {
    #     "trip_type": "round_trip",
    #     "origin": "OTP",
    #     "destination": "BCN",
    #     "depart_date": "2026-04-12",
    #     "return_date": "2026-04-16",
    #     "adults": 1
    #   }
    comparison_query: Optional[dict] = None

    # Human-readable trip-check verdict: verdict line + live alternatives.
    # Populated when compare_with_vola() is called successfully.
    trip_check: Optional[str] = None

    error: Optional[str] = None
