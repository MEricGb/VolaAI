"""
trip_check.py — Orchestrates the OCR → Parse → Normalize → Compare pipeline.

TripCheckService.process_image(image_path) is the single entry point.
"""

import os
import sys
from typing import Optional

from models import BookingInfo, TripCheckPayload
from ocr_provider import BaseOCRProvider, get_provider
from booking_parser import BookingParser

# Allow importing VolaClient from the sibling scraper package
_SCRAPER_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scraper")
if _SCRAPER_DIR not in sys.path:
    sys.path.insert(0, _SCRAPER_DIR)

# ── FX rate cache (in-process, refreshed once per run) ───────────────────────
_fx_cache: dict[str, float] = {}  # e.g. {"INR": 0.01095, "USD": 0.92}

def _get_eur_rate(currency: str) -> Optional[float]:
    """
    Return how many EUR one unit of `currency` is worth.
    Primary:  open.er-api.com  (150+ currencies, free, no key)
    Fallback: api.frankfurter.app (ECB rates, ~30 major currencies)
    Returns None on any network/parse error.
    """
    if currency == "EUR":
        return 1.0
    if currency in _fx_cache:
        return _fx_cache[currency]
    import urllib.request, json as _json

    # Primary: open.er-api.com
    try:
        url = f"https://open.er-api.com/v6/latest/{currency}"
        with urllib.request.urlopen(url, timeout=5) as resp:
            data = _json.loads(resp.read())
        if data.get("result") == "success":
            rate = data["rates"]["EUR"]
            _fx_cache[currency] = rate
            return rate
    except Exception:
        pass

    # Fallback: frankfurter (ECB)
    try:
        url = f"https://api.frankfurter.app/latest?from={currency}&to=EUR"
        with urllib.request.urlopen(url, timeout=5) as resp:
            data = _json.loads(resp.read())
        rate = data["rates"]["EUR"]
        _fx_cache[currency] = rate
        return rate
    except Exception:
        return None


class TripCheckService:
    """
    Runs the full trip-check pipeline for a single image.

    Args:
        ocr_provider: any BaseOCRProvider instance (default: mock)
        auto_compare: if True (default), call Vola scraper automatically
                      when OCR extracts enough data for a comparison query.
    """

    def __init__(
        self,
        ocr_provider: Optional[BaseOCRProvider] = None,
        auto_compare: bool = True,
    ) -> None:
        self._ocr          = ocr_provider or get_provider("mock")
        self._parser       = BookingParser()
        self._auto_compare = auto_compare

    # ── Public API ─────────────────────────────────────────────────────────────

    def process_image(self, image_path: str) -> TripCheckPayload:
        """
        Full pipeline:
          1. Validate the image path
          2. Extract text via OCR provider
          3. Parse BookingInfo from text
          4. Build comparison_query if enough data exists
          5. Call Vola scraper and produce verdict (when auto_compare=True)
          6. Return TripCheckPayload
        """
        # Step 1: path validation
        if not image_path:
            return TripCheckPayload(success=False, error="No image path provided.")

        from ocr_provider import MockOCRProvider
        is_mock_provider = isinstance(self._ocr, MockOCRProvider)
        if not is_mock_provider and not os.path.exists(image_path):
            return TripCheckPayload(
                success=False,
                error=f"File not found: {image_path}"
            )

        # Step 2: OCR
        try:
            raw_text = self._ocr.extract_text(image_path)
        except FileNotFoundError as exc:
            return TripCheckPayload(success=False, error=str(exc))
        except Exception as exc:
            return TripCheckPayload(success=False, error=f"OCR failed: {exc}")

        if not raw_text or not raw_text.strip():
            return TripCheckPayload(
                success=False,
                error="OCR returned empty text. The image may be blank or unreadable."
            )

        # Step 3: parse
        booking_info = self._parser.parse(raw_text)

        # Step 4: build comparison query
        comparison_query = self._build_comparison_query(booking_info)
        if comparison_query is None:
            booking_info.notes.append(
                "comparison_query not built — need at least origin, destination, and a date."
            )

        # Step 5: live comparison
        trip_check: Optional[str] = None
        if self._auto_compare and comparison_query is not None:
            trip_check = self.compare_with_vola(comparison_query)

        return TripCheckPayload(
            success          = True,
            booking_info     = booking_info,
            comparison_query = comparison_query,
            trip_check       = trip_check,
        )

    # ── Comparison query builder ───────────────────────────────────────────────

    def _build_comparison_query(self, info: BookingInfo) -> Optional[dict]:
        """
        Build a structured dict ready for the Vola scraper.
        Returns None if minimum required fields are absent.
        Minimum: origin_code + destination_code + depart_date
        """
        if not info.origin_code or not info.destination_code or not info.depart_date:
            return None

        trip_type = "one_way" if info.return_date is None else "round_trip"

        query: dict = {
            "trip_type":   trip_type,
            "origin":      info.origin_code,
            "destination": info.destination_code,
            "depart_date": info.depart_date,
            "adults":      info.passengers or 1,
        }
        if info.return_date:
            query["return_date"] = info.return_date
        if info.price is not None:
            query["price_paid"] = info.price
        if info.currency:
            query["currency"] = info.currency

        return query

    # ── Vola comparison ───────────────────────────────────────────────────────

    def compare_with_vola(self, comparison_query: dict) -> str:
        """
        Call the real Vola scraper and return a formatted verdict string.

        Returns a human-readable string suitable for direct display, containing:
          - A verdict line comparing price_paid to the live cheapest option
          - A numbered list of the top-3 live alternatives
        On any error, returns a short explanation instead of raising.
        """
        try:
            from datetime import date as _date
            import importlib.util as _ilu
            import sys as _sys

            def _load(name: str):
                spec = _ilu.spec_from_file_location(
                    name, os.path.join(_SCRAPER_DIR, f"{name}.py")
                )
                mod = _ilu.module_from_spec(spec)
                spec.loader.exec_module(mod)
                return mod

            _scraper_models = _load("models")
            TravelContext   = _scraper_models.TravelContext

            # Temporarily point 'models' at the scraper version so vola_client
            # resolves its own `from models import ...` correctly, then restore.
            _prev = _sys.modules.get("models")
            _sys.modules["models"] = _scraper_models
            try:
                _vola = _load("vola_client")
                VolaClient = _vola.VolaClient
            finally:
                if _prev is None:
                    _sys.modules.pop("models", None)
                else:
                    _sys.modules["models"] = _prev
        except Exception as exc:
            return f"Comparison unavailable: scraper not installed ({exc})."

        origin      = comparison_query.get("origin")
        destination = comparison_query.get("destination")
        depart_str  = comparison_query.get("depart_date")
        return_str  = comparison_query.get("return_date")
        adults      = comparison_query.get("adults", 1)
        trip_type   = comparison_query.get("trip_type", "one_way")
        price_paid  = comparison_query.get("price_paid")
        currency    = comparison_query.get("currency", "EUR")

        if not origin or not destination or not depart_str:
            return "Comparison unavailable: missing origin, destination, or date."

        try:
            depart_date = _date.fromisoformat(depart_str)
        except ValueError:
            return f"Comparison unavailable: invalid depart_date '{depart_str}'."

        return_date = None
        if return_str:
            try:
                return_date = _date.fromisoformat(return_str)
            except ValueError:
                pass

        try:
            ctx = TravelContext(
                origin=origin,
                destination=destination,
                depart_date=depart_date,
                return_date=return_date,
                adults=adults,
            )
            client = VolaClient()
            if trip_type == "round_trip" and return_date:
                offers = client.search_round_trip(ctx)
            else:
                offers = client.search_one_way(ctx)
        except Exception as exc:
            return f"Comparison unavailable: scraper error — {exc}"

        if not offers:
            return f"No live flights found for {origin} → {destination} on {depart_str}."

        top = offers[:3]
        cheapest_eur = top[0].price_eur

        if price_paid is not None:
            rate = _get_eur_rate(currency)  # how many EUR per 1 unit of currency
            if rate is not None:
                paid_eur = round(price_paid * rate, 2)
                fx_note = (
                    f" ({price_paid:.2f} {currency} @ {rate:.6f} {currency}/EUR)"
                    if currency != "EUR" else ""
                )
                if cheapest_eur < paid_eur * 0.95:
                    verdict = (
                        f"⚠️  Cheaper options available! "
                        f"You paid {paid_eur:.2f} EUR{fx_note}; "
                        f"current cheapest is {cheapest_eur:.2f} EUR "
                        f"(save ~{paid_eur - cheapest_eur:.2f} EUR)."
                    )
                elif cheapest_eur > paid_eur * 1.05:
                    verdict = (
                        f"✅  Good deal! "
                        f"You paid {paid_eur:.2f} EUR{fx_note}; "
                        f"current cheapest is {cheapest_eur:.2f} EUR."
                    )
                else:
                    verdict = (
                        f"✅  Fair price. "
                        f"You paid {paid_eur:.2f} EUR{fx_note}; "
                        f"current cheapest is {cheapest_eur:.2f} EUR."
                    )
            else:
                # FX unavailable — show raw amounts honestly
                verdict = (
                    f"You paid {price_paid:.2f} {currency} "
                    f"(FX rate unavailable for comparison). "
                    f"Current cheapest on Vola: {cheapest_eur:.2f} EUR."
                )
        else:
            verdict = f"Current cheapest on Vola: {cheapest_eur:.2f} EUR."

        lines = []
        for i, o in enumerate(top, 1):
            ret = o.return_date or "one-way"
            lines.append(
                f"  {i}. {o.airline} {o.flight_number} | {o.origin}→{o.destination} "
                f"| depart {o.depart_date} | return {ret} "
                f"| {o.price_eur:.2f} EUR | {o.stops} stop(s) | {o.duration_minutes}min"
            )

        return (
            f"{verdict}\n\n"
            f"Live alternatives ({origin} → {destination}, {depart_str}):\n"
            + "\n".join(lines)
        )
