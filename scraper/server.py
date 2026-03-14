"""
server.py — gRPC server wrapping the Vola flight-search assistant.

Run:
    python server.py

Generate proto stubs first (one-time):
    pip install grpcio-tools
    python -m grpc_tools.protoc \
        -I proto \
        --python_out=generated \
        --grpc_python_out=generated \
        proto/scraping.proto
"""

import sys
import json
import logging
from concurrent import futures
from datetime import date

import grpc

sys.path.insert(0, "generated")
import scraping_pb2
import scraping_pb2_grpc

from context_manager import ContextManager
from planner import Planner, PlannerAction
from vola_client import VolaClient
from models import TravelContext

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

GRPC_PORT = 50051


class ScrapingServicer(scraping_pb2_grpc.ScrapingServiceServicer):
    """
    Stateful gRPC servicer. Each session_id gets its own ContextManager
    so context accumulates across conversation turns.
    """

    def __init__(self):
        self._sessions: dict[str, ContextManager] = {}
        self._planner = Planner()
        self._vola = VolaClient(use_mock=False)

    def _get_session(self, session_id: str) -> ContextManager:
        if session_id not in self._sessions:
            log.info("New session: %s", session_id)
            self._sessions[session_id] = ContextManager()
        return self._sessions[session_id]

    def SearchFlights(self, request, context):
        session_id = request.session_id
        user_message = request.user_message

        log.info("[%s] user_message=%r", session_id, user_message)

        ctx_mgr = self._get_session(session_id)

        # ── Update context from message ──────────────────────────────────────
        travel_ctx = ctx_mgr.update(user_message)

        # ── Ask planner what to do ───────────────────────────────────────────
        result = self._planner.decide(travel_ctx, last_message=user_message)
        log.info("[%s] planner=%s reason=%s", session_id, result.action.value, result.reason)

        # ── SEARCH_NOW ───────────────────────────────────────────────────────
        if result.action == PlannerAction.SEARCH_NOW:
            try:
                if travel_ctx.is_one_way:
                    offers = self._vola.search_one_way(travel_ctx)
                else:
                    offers = self._vola.search_round_trip(travel_ctx)
            except Exception as exc:
                log.error("[%s] Vola search failed: %s", session_id, exc)
                context.set_code(grpc.StatusCode.INTERNAL)
                context.set_details(f"Flight search failed: {exc}")
                return scraping_pb2.SearchResponse()

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

            ctx_mgr.add_assistant_message(
                f"Found {len(offers)} offers. "
                + (f"Cheapest: {min(offers, key=lambda o: o.price_eur).formatted_price()}" if offers else "No offers.")
            )

            return scraping_pb2.SearchResponse(
                flights=scraping_pb2.FlightResults(offers=proto_offers)
            )

        # ── ASK_CLARIFICATION ────────────────────────────────────────────────
        if result.action == PlannerAction.ASK_CLARIFICATION:
            return scraping_pb2.SearchResponse(
                clarification=scraping_pb2.ClarificationNeeded(
                    question=result.clarification_question or "",
                    missing_fields=travel_ctx.missing_fields(),
                )
            )

        # ── NO_SEARCH_YET ────────────────────────────────────────────────────
        return scraping_pb2.SearchResponse(
            no_search=scraping_pb2.NoSearchYet(reason=result.reason)
        )


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
