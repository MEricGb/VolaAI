"""
models.py — Core data models for the flight-search assistant.

TravelContext accumulates what we know about the user's trip.
FlightOffer represents a normalized result from Vola (or any future source).
"""

from dataclasses import dataclass, field, asdict
from typing import Optional
from datetime import date


@dataclass
class TravelContext:
    """
    Everything we know about what the user is looking for.
    Fields are filled in incrementally across conversation turns.
    """

    # ── Route ──────────────────────────────────────────────────────────────
    origin: Optional[str] = None          # IATA code or city, e.g. "OTP", "Bucharest"
    destination: Optional[str] = None     # IATA code or city, e.g. "BCN", "Barcelona"

    # ── Dates ──────────────────────────────────────────────────────────────
    depart_date: Optional[date] = None    # exact departure date
    return_date: Optional[date] = None    # exact return date (None = one-way)
    month: Optional[str] = None           # vague month preference, e.g. "June"

    # ── Passengers ─────────────────────────────────────────────────────────
    adults: int = 1
    children: int = 0

    # ── Preferences ────────────────────────────────────────────────────────
    nonstop_only: bool = False
    budget_preference: Optional[str] = None   # "cheap", "business", "flexible", etc.
    trip_length_nights: Optional[int] = None  # e.g. 7

    # ── Internal ───────────────────────────────────────────────────────────
    is_one_way: bool = False  # set to True when user signals one-way intent

    def to_dict(self) -> dict:
        """Serialize to plain dict (dates → ISO strings)."""
        d = asdict(self)
        if self.depart_date:
            d["depart_date"] = self.depart_date.isoformat()
        if self.return_date:
            d["return_date"] = self.return_date.isoformat()
        return d

    def has_minimum_for_search(self) -> bool:
        """True when we have enough to fire a Vola query."""
        has_route = bool(self.origin and self.destination)
        has_time = bool(self.depart_date or self.month)
        return has_route and has_time

    def missing_fields(self) -> list[str]:
        """Return human-readable names of fields still needed."""
        missing = []
        if not self.origin:
            missing.append("origin city/airport")
        if not self.destination:
            missing.append("destination city/airport")
        if not self.depart_date and not self.month:
            missing.append("travel date or month")
        return missing


@dataclass
class FlightOffer:
    """
    A normalized flight offer returned by VolaClient.
    All monetary values are in EUR unless noted.
    """

    offer_id: str
    origin: str                    # IATA departure
    destination: str               # IATA arrival
    depart_date: str               # ISO date string
    return_date: Optional[str]     # ISO date string or None for one-way
    price_eur: float
    airline: str                   # outbound marketing carrier name
    flight_number: str             # outbound first flight number
    duration_minutes: int          # outbound travel time in minutes
    stops: int                     # outbound stops (0 = nonstop)
    deep_link: str                 # URL to book directly on Vola

    # Return leg info (None for one-way trips)
    return_airline: Optional[str] = None         # return carrier name
    return_flight_number: Optional[str] = None   # return first flight number
    return_duration_minutes: Optional[int] = None
    return_stops: Optional[int] = None

    # Optional enrichment fields
    cabin_class: str = "economy"
    baggage_included: bool = False
    seats_remaining: Optional[int] = None

    def is_nonstop(self) -> bool:
        return self.stops == 0

    def formatted_price(self) -> str:
        return f"€{self.price_eur:.2f}"

    def formatted_duration(self) -> str:
        h, m = divmod(self.duration_minutes, 60)
        return f"{h}h {m:02d}m"
