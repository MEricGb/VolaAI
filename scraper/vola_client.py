"""
vola_client.py — Real integration layer for the Vola / ith.toys flight-search API.

Reverse-engineered from browser network traffic on vola.ro.

Flow:
  1. POST https://api.ith.toys/gateway/discover  → returns { search: { searchId } }
  2. GET  https://api.ith.toys/gateway/search/{searchId}
         → returns { refreshStatus: { continue: bool }, offers: [...] }
         Poll until continue == False.

Key headers required:
  - api-key:  public key embedded in the Vola frontend (see API_KEY below)
  - slot:     pricing slot name (see SLOT below)
  - x-affiliate: "vola"
  - Origin / Referer: must be vola.ro (CORS enforcement)
"""

import time
import random
import uuid
import hashlib
from datetime import date, timedelta
from typing import Optional
from calendar import monthrange

import requests

from models import TravelContext, FlightOffer


# ── API constants (extracted from Vola's frontend JS bundle) ──────────────────

GATEWAY_BASE     = "https://api.ith.toys/gateway"
DISCOVER_URL     = f"{GATEWAY_BASE}/discover"
SEARCH_URL       = f"{GATEWAY_BASE}/search"   # + /{searchId}

# Public API key found in Vola's __NUXT_DATA__ page payload
API_KEY          = "7f6c921c-d7f8-4303-b9ad-b60878ca12ed"

# Pricing slot — controls which fee structure Vola applies
SLOT             = "volaNoExtraViFeesIncreased"

# Polling config
POLL_INTERVAL    = 2.0   # seconds between polls
POLL_MAX_RETRIES = 15    # max poll attempts before giving up

# Deep-link base for booking (Vola redirects to checkout with fulfillmentToken)
VOLA_BOOK_BASE   = "https://www.vola.ro/offer"


class VolaClient:
    """
    Real HTTP client for Vola's flight-search backend (api.ith.toys/gateway).

    Usage:
        client = VolaClient(use_mock=False)   # live
        client = VolaClient(use_mock=True)    # instant mock for offline dev
        offers = client.search_round_trip(context)
    """

    def __init__(self, use_mock: bool = False) -> None:
        self.use_mock = use_mock
        self._session = requests.Session()

    # ── Public methods ────────────────────────────────────────────────────────

    def search_round_trip(self, context: TravelContext) -> list[FlightOffer]:
        """Search round-trip flights. Returns sorted, deduplicated list of FlightOffer."""
        payload = self._build_payload(context, is_one_way=False)
        raw_offers = self._execute_search(payload)
        offers = self.normalize_offers(raw_offers, context)
        return self._postprocess(offers, context)

    def search_one_way(self, context: TravelContext) -> list[FlightOffer]:
        """Search one-way flights. Returns sorted, deduplicated list of FlightOffer."""
        payload = self._build_payload(context, is_one_way=True)
        raw_offers = self._execute_search(payload)
        offers = self.normalize_offers(raw_offers, context)
        return self._postprocess(offers, context)

    def normalize_offers(self, raw_offers: list[dict], context: TravelContext) -> list[FlightOffer]:
        """
        Convert raw ith.toys offer dicts into FlightOffer objects.

        Raw offer structure (confirmed via live API):
          offer = {
            "travelHash": str,         # unique offer fingerprint
            "stages": [                # [outbound_leg, return_leg?]
              {
                "departure": "2026-06-15T17:15:00",
                "arrival":   "2026-06-15T23:05:00",
                "duration":  410,      # minutes
                "segments":  [         # individual flights within the leg
                  {
                    "fullFlightNumber": "LH1417",
                    "marketingCarrier": "LH",
                    "originAirport":    "OTP",
                    "destinationAirport": "FRA",
                    ...
                  }, ...
                ]
              }, ...
            ],
            "tickets": [
              {
                "fares": [
                  { "totalPrice": { "amount": 321.48, "currency": "EUR" } }
                ]
              }
            ],
            "fees": {
              "transactionFee": { "amount": 27.0, "currency": "EUR" }
            },
            "fulfillmentToken": str,   # opaque booking token
          }
        """
        # Readable airline name lookup
        airline_names = {
            "W6": "Wizz Air", "FR": "Ryanair", "RO": "TAROM",
            "LH": "Lufthansa", "AF": "Air France", "BA": "British Airways",
            "VY": "Vueling", "U2": "easyJet", "W4": "Wizz Air Malta",
            "SN": "Brussels Airlines", "KL": "KLM", "IB": "Iberia",
            "OS": "Austrian", "LX": "Swiss", "TK": "Turkish Airlines", "LO": "LOT",
            "OE": "OE", "JU": "Air Serbia", "TG": "Thai Airways", "H4": "HiSky",
            "A2": "Animawings",
            # Indian
            "AI": "Air India", "6E": "IndiGo", "SG": "SpiceJet",
            "UK": "Vistara", "G8": "Go First", "QP": "Akasa Air",
            "IX": "Air India Express", "I5": "Air Asia India",
            # Middle East
            "EK": "Emirates", "EY": "Etihad", "QR": "Qatar Airways",
            "FZ": "flydubai", "G9": "Air Arabia",
            # Asian
            "SQ": "Singapore Airlines", "CX": "Cathay Pacific",
            "JL": "Japan Airlines", "NH": "ANA", "KE": "Korean Air",
            "OZ": "Asiana", "TG": "Thai Airways", "FD": "Thai AirAsia",
            "AK": "AirAsia", "MH": "Malaysia Airlines", "GA": "Garuda",
            # Other
            "QF": "Qantas", "NZ": "Air New Zealand",
            "ET": "Ethiopian Airlines", "MS": "EgyptAir",
        }

        results: list[FlightOffer] = []

        for raw in raw_offers:
            try:
                outbound = raw["stages"][0]
                out_segs = outbound.get("segments", [])

                origin      = out_segs[0]["originAirport"] if out_segs else (context.origin or "?")
                destination = out_segs[-1]["destinationAirport"] if out_segs else (context.destination or "?")

                # Outbound carrier = marketing carrier of first segment
                first_out      = out_segs[0] if out_segs else {}
                airline_code   = first_out.get("marketingCarrier", "??")
                flight_number  = first_out.get("fullFlightNumber", "??")
                stops          = len(out_segs) - 1
                duration_min   = outbound.get("duration", 0)

                depart_date_str = outbound["departure"][:10]

                # Return leg (stage index 1)
                ret_airline_name = ret_flight_num = ret_date_str = None
                ret_duration_min = ret_stops = None
                if len(raw["stages"]) > 1:
                    ret_leg  = raw["stages"][1]
                    ret_segs = ret_leg.get("segments", [])
                    ret_date_str      = ret_leg["departure"][:10]
                    ret_duration_min  = ret_leg.get("duration", 0)
                    ret_stops         = len(ret_segs) - 1
                    if ret_segs:
                        ret_code        = ret_segs[0].get("marketingCarrier", "??")
                        ret_flight_num  = ret_segs[0].get("fullFlightNumber", "??")
                        ret_airline_name = airline_names.get(ret_code, ret_code)

                # Price: totalPrice already includes the transaction fee —
                # do NOT add transactionFee again or it is double-counted.
                total_price = round(
                    raw["tickets"][0]["fares"][0]["totalPrice"]["amount"]
                    if raw.get("tickets") else 0.0,
                    2,
                )

                # Deep link uses fulfillmentToken if available
                token = raw.get("fulfillmentToken", "")
                deep_link = (
                    f"{VOLA_BOOK_BASE}?token={token[:30]}..."
                    if token else f"https://www.vola.ro/search_results?from={origin}&to={destination}"
                )

                airline_name = airline_names.get(airline_code, airline_code)

                results.append(FlightOffer(
                    offer_id               = raw.get("travelHash", uuid.uuid4().hex)[:12],
                    origin                 = origin,
                    destination            = destination,
                    depart_date            = depart_date_str,
                    return_date            = ret_date_str,
                    price_eur              = total_price,
                    airline                = airline_name,
                    flight_number          = flight_number,
                    duration_minutes       = duration_min,
                    stops                  = stops,
                    deep_link              = deep_link,
                    return_airline         = ret_airline_name,
                    return_flight_number   = ret_flight_num,
                    return_duration_minutes= ret_duration_min,
                    return_stops           = ret_stops,
                ))

            except (KeyError, IndexError):
                # Skip malformed offers silently
                continue

        results.sort(key=lambda o: o.price_eur)
        return results

    def _postprocess(self, offers: list[FlightOffer], context: TravelContext) -> list[FlightOffer]:
        """
        Apply post-fetch filters and deduplication.

        Dedup key: (flight_number, depart_date, return_date, price_eur)
        — keeps the first occurrence (lowest price wins since list is sorted).
        """
        # 1. Nonstop filter
        if context.nonstop_only:
            offers = [o for o in offers if o.is_nonstop()]

        # 2. Deduplicate: same flight + same dates + same price = same product
        seen: set[tuple] = set()
        unique: list[FlightOffer] = []
        for offer in offers:
            key = (offer.flight_number, offer.return_flight_number, offer.depart_date, offer.return_date, offer.price_eur)
            if key not in seen:
                seen.add(key)
                unique.append(offer)

        return unique

    # ── Internal: payload building ────────────────────────────────────────────

    def _build_payload(self, context: TravelContext, is_one_way: bool) -> dict:
        """
        Build the JSON body for POST /gateway/discover.

        Date handling:
          - Exact date  → departureFrom == departureTo == that date
          - Month only  → use first and last day of that month
        """
        depart_from, depart_to = self._resolve_date_range(
            context.depart_date, context.month, is_departure=True
        )
        return_from = return_to = ""
        if not is_one_way:
            if context.return_date:
                return_from = return_to = context.return_date.isoformat()
            elif context.trip_length_nights and context.depart_date:
                ret = context.depart_date + timedelta(days=context.trip_length_nights)
                return_from = return_to = ret.isoformat()
            elif context.month:
                # default 7-night return within the same month
                _, last = monthrange(date.today().year, self._month_num(context.month))
                ret_d = date(date.today().year, self._month_num(context.month), min(last, 22))
                return_from = return_to = ret_d.isoformat()
            elif context.depart_date:
                # fallback: 7 days after departure
                ret_d = context.depart_date + timedelta(days=7)
                return_from = return_to = ret_d.isoformat()

        return {
            "dates": {
                "departureFrom": depart_from,
                "departureTo":   depart_to,
                "returnFrom":    return_from,
                "returnTo":      return_to,
            },
            "passengers": {
                "adults":   context.adults,
                "children": context.children,
                "infants":  0,
                "youth":    0,
            },
            "locations": {
                "origins":      [{"code": context.origin,      "type": "AIRPORT"}],
                "destinations": [{"code": context.destination, "type": "AIRPORT"}],
            },
            # Luggage: 0 = include all fares (cheapest usually has no bag)
            "luggageOptions": {
                "personalItemCount":   0,
                "cabinTrolleyCount":   0,
                "checkedBaggageCount": 0,
            },
        }

    def _resolve_date_range(
        self,
        exact: Optional[date],
        month: Optional[str],
        is_departure: bool,
    ) -> tuple[str, str]:
        """Return (from_str, to_str) ISO date strings for the payload."""
        if exact:
            s = exact.isoformat()
            return s, s
        if month:
            year  = date.today().year
            m_num = self._month_num(month)
            if m_num < date.today().month:
                year += 1
            _, last = monthrange(year, m_num)
            return date(year, m_num, 1).isoformat(), date(year, m_num, last).isoformat()
        # Fallback: search next 30 days
        today = date.today()
        return today.isoformat(), (today + timedelta(days=30)).isoformat()

    @staticmethod
    def _month_num(month_name: str) -> int:
        months = {
            "january":1,"february":2,"march":3,"april":4,"may":5,"june":6,
            "july":7,"august":8,"september":9,"october":10,"november":11,"december":12,
        }
        return months.get(month_name.lower(), date.today().month)

    # ── Internal: HTTP execution & polling ────────────────────────────────────

    def _build_headers(self) -> dict:
        return {
            "accept":           "application/json",
            "accept-language":  "ro",
            "api-key":          API_KEY,
            "content-type":     "application/json",
            "disablededuplication": "false",
            "slot":             SLOT,
            "x-affiliate":      "vola",
            "Origin":           "https://www.vola.ro",
            "Referer":          "https://www.vola.ro/",
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36"
            ),
        }

    def _execute_search(self, payload: dict) -> list[dict]:
        """
        POST /discover to get a searchId, then poll GET /search/{id}
        until refreshStatus.continue == False.
        Returns the raw offers list.
        """
        headers = self._build_headers()

        # Step 1: kick off the search
        resp = self._session.post(DISCOVER_URL, json=payload, headers=headers, timeout=15)
        resp.raise_for_status()
        data = resp.json()

        search_id = data.get("search", {}).get("searchId")
        if not search_id:
            raise RuntimeError(f"No searchId in discover response: {data}")

        # Step 2: poll for results
        poll_headers = {k: v for k, v in headers.items() if k != "content-type"}
        return self._poll_results(search_id, poll_headers)

    def _poll_results(self, search_id: str, headers: dict) -> list[dict]:
        """Poll GET /search/{searchId} until complete, return offers list."""
        url = f"{SEARCH_URL}/{search_id}"
        all_offers: list[dict] = []

        for attempt in range(POLL_MAX_RETRIES):
            time.sleep(POLL_INTERVAL)
            resp = self._session.get(url, headers=headers, timeout=15)
            resp.raise_for_status()
            data = resp.json()

            all_offers = data.get("offers", [])
            should_continue = data.get("refreshStatus", {}).get("continue", False)

            if not should_continue:
                break

        return all_offers

    # ── Mock data ─────────────────────────────────────────────────────────────

    def _mock_offers(self, context: TravelContext, is_one_way: bool) -> list[FlightOffer]:
        """
        Generate realistic-looking mock FlightOffer objects.
        REMOVE or bypass this once the real scraping is in place.
        """
        origin = context.origin or "OTP"
        destination = context.destination or "BCN"
        depart = (
            context.depart_date.isoformat()
            if context.depart_date
            else "2026-06-15"
        )
        ret = (
            context.return_date.isoformat()
            if context.return_date
            else (None if is_one_way else "2026-06-22")
        )

        airlines = [
            ("Wizz Air",   "W6", 89.99,  145, 0),
            ("Ryanair",    "FR", 104.50, 150, 0),
            ("TAROM",      "RO", 215.00, 140, 0),
            ("Lufthansa",  "LH", 312.00, 210, 1),
            ("Air France", "AF", 289.00, 195, 1),
        ]

        offers = []
        for airline, code, base_price, duration, stops in airlines:
            # Random price variation ±15%
            price = round(base_price * random.uniform(0.85, 1.15), 2)
            if is_one_way:
                price = round(price * 0.6, 2)

            flight_num = f"{code}{random.randint(1000, 9999)}"
            offer_id = str(uuid.uuid4())[:8]

            offers.append(FlightOffer(
                offer_id=offer_id,
                origin=origin,
                destination=destination,
                depart_date=depart,
                return_date=ret,
                price_eur=price,
                airline=airline,
                flight_number=flight_num,
                duration_minutes=duration,
                stops=stops,
                deep_link=f"https://www.vola.ro/flights/{origin}-{destination}/{depart}",
                baggage_included=(airline in ("Lufthansa", "Air France", "TAROM")),
            ))

        # Sort by price ascending
        offers.sort(key=lambda o: o.price_eur)
        return offers
