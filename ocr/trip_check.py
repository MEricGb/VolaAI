"""
trip_check.py — Orchestrates the OCR → Parse → Normalize → Compare pipeline.

TripCheckService.process_image(image_path) is the single entry point.

Future Vola integration:
  - Replace the stub in compare_with_vola() with a real VolaClient call.
  - The comparison_query dict is already structured to match VolaClient.search_round_trip().
"""

import os
import tempfile
import urllib.request
from typing import Optional

from models import BookingInfo, TripCheckPayload
from ocr_provider import BaseOCRProvider, get_provider
from booking_parser import BookingParser


class TripCheckService:
    """
    Runs the full trip-check pipeline for a single image.

    Args:
        ocr_provider: any BaseOCRProvider instance (default: mock)
    """

    def __init__(self, ocr_provider: Optional[BaseOCRProvider] = None) -> None:
        self._ocr    = ocr_provider or get_provider("mock")
        self._parser = BookingParser()

    # ── Public API ─────────────────────────────────────────────────────────────

    def process_image(self, image_path: str) -> TripCheckPayload:
        """
        Full pipeline:
          1. Validate the image path
          2. Extract text via OCR provider
          3. Parse BookingInfo from text
          4. Build comparison_query if enough data exists
          5. Return TripCheckPayload

        Returns TripCheckPayload(success=False, error=...) on hard failures.
        Returns TripCheckPayload(success=True, booking_info=...) even with
        partial data — success=True means we got *something* useful.
        """
        # Step 1: path validation
        if not image_path:
            return TripCheckPayload(success=False, error="No image path provided.")

        tmp_file = None
        local_path = image_path
        try:
            # Allow http(s) URLs by downloading to a temp file first.
            if image_path.startswith("http://") or image_path.startswith("https://"):
                suffix = os.path.splitext(image_path)[1] or ".img"
                fd, tmp_file = tempfile.mkstemp(prefix="ocr_", suffix=suffix)
                os.close(fd)
                req = urllib.request.Request(
                    image_path,
                    headers={"User-Agent": "vibehack-2026-ocr/1.0"},
                )
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = resp.read()
                with open(tmp_file, "wb") as f:
                    f.write(data)
                local_path = tmp_file

            # Allow mock paths (they don't exist on disk)
            from ocr_provider import MockOCRProvider
            is_mock_provider = isinstance(self._ocr, MockOCRProvider)
            if not is_mock_provider and not os.path.exists(local_path):
                return TripCheckPayload(
                    success=False,
                    error=f"File not found: {local_path}"
                )

            # Step 2: OCR
            try:
                raw_text = self._ocr.extract_text(local_path)
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

            return TripCheckPayload(
                success        = True,
                booking_info   = booking_info,
                comparison_query = comparison_query,
            )
        finally:
            if tmp_file:
                try:
                    os.remove(tmp_file)
                except Exception:
                    pass

    # ── Comparison query builder ───────────────────────────────────────────────

    def _build_comparison_query(self, info: BookingInfo) -> Optional[dict]:
        """
        Build a structured dict ready for a Vola scraper.
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

        return query

    # ── Future Vola integration stub ──────────────────────────────────────────

    def compare_with_vola(self, comparison_query: dict) -> dict:
        """
        TODO: call the real Vola scraper and return live prices.

        Integration steps:
          1. Import VolaClient from the Scraping module:
               from Scraping.vola_client import VolaClient
          2. Build a TravelContext from comparison_query fields.
          3. Call vola.search_round_trip(context) or search_one_way(context).
          4. Return the list of FlightOffer objects (or serialize them).

        Example stub result returned for now:
        """
        # TODO: replace with real Vola call
        return {
            "status": "not_implemented",
            "message": "Vola comparison not yet connected.",
            "query":   comparison_query,
        }
