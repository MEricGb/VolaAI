"""
server.py — gRPC server for the Vola flight-search service.

Receives fully-resolved search parameters from the Rust agent's LLM
and delegates directly to VolaClient. No NLP or session state here.

Run:
    python server.py
"""

import sys
import logging
from concurrent import futures
from datetime import date

import grpc

sys.path.insert(0, "generated")
import scraping_pb2
import scraping_pb2_grpc

from vola_client import VolaClient
from models import TravelContext

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

GRPC_PORT = 50051


class ScrapingServicer(scraping_pb2_grpc.ScrapingServiceServicer):
    """Stateless gRPC servicer. Receives structured params, calls Vola, returns offers."""

    def __init__(self):
        self._vola = VolaClient(use_mock=False)

    def SearchFlights(self, request, context):
        log.info(
            "SearchFlights received: %s→%s depart=%s return=%s adults=%d children=%d one_way=%s",
            request.origin,
            request.destination,
            request.depart_date,
            request.return_date or "—",
            request.adults or 1,
            request.children,
            request.is_one_way,
        )

        try:
            travel_ctx = TravelContext(
                origin=request.origin,
                destination=request.destination,
                depart_date=date.fromisoformat(request.depart_date),
                return_date=(
                    date.fromisoformat(request.return_date)
                    if request.return_date else None
                ),
                adults=request.adults if request.adults > 0 else 1,
                children=request.children,
                is_one_way=request.is_one_way,
            )
        except (ValueError, AttributeError) as exc:
            log.error("Invalid request params: %s", exc)
            context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
            context.set_details(f"Invalid search parameters: {exc}")
            return scraping_pb2.SearchResponse()

        log.info("Calling Vola API (%s)...", "one-way" if travel_ctx.is_one_way else "round-trip")

        try:
            if travel_ctx.is_one_way:
                offers = self._vola.search_one_way(travel_ctx)
            else:
                offers = self._vola.search_round_trip(travel_ctx)
        except Exception as exc:
            log.error("Vola search failed: %s", exc)
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(f"Flight search failed: {exc}")
            return scraping_pb2.SearchResponse()

        if offers:
            log.info("Vola returned %d offer(s); cheapest=€%.2f", len(offers), min(o.price_eur for o in offers))
        else:
            log.info("Vola returned 0 offers")

        proto_offers = [
            scraping_pb2.FlightOffer(
                offer_id=o.offer_id,
                origin=o.origin,
                destination=o.destination,
                depart_date=o.depart_date,
                return_date=o.return_date or "",
                price_eur=o.price_eur,
                airline=o.airline,
                flight_number=o.flight_number,
                duration_minutes=o.duration_minutes,
                stops=o.stops,
                deep_link=o.deep_link,
            )
            for o in offers
        ]

        return scraping_pb2.SearchResponse(offers=proto_offers)


def serve():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    scraping_pb2_grpc.add_ScrapingServiceServicer_to_server(ScrapingServicer(), server)
    addr = f"[::]:{GRPC_PORT}"
    server.add_insecure_port(addr)
    server.start()
    log.info("Scraper gRPC server listening on %s", addr)
    server.wait_for_termination()


if __name__ == "__main__":
    serve()
