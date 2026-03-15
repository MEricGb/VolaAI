"""
server.py - gRPC server wrapping the OCR TripCheck pipeline.

Run:
    python server.py

Generate proto stubs first (one-time):
    pip install grpcio-tools
    python -m grpc_tools.protoc \
        -I proto \
        --python_out=generated \
        --grpc_python_out=generated \
        proto/ocr.proto
"""

import json
import logging
import os
import sys
from concurrent import futures

import grpc

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
GENERATED_DIR = os.path.join(BASE_DIR, "generated")
sys.path.insert(0, GENERATED_DIR)
import ocr_pb2
import ocr_pb2_grpc

from ocr_provider import get_provider
from trip_check import TripCheckService

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

GRPC_PORT = 50053
VALID_BACKENDS = {"mock", "tesseract", "google", "openai", "featherless"}


def _summary_from_payload(payload) -> str:
    if not payload.booking_info:
        return "OCR succeeded but no structured booking details were extracted."

    info = payload.booking_info
    route = "unknown route"
    if info.origin_code and info.destination_code:
        route = f"{info.origin_code} -> {info.destination_code}"
    elif info.origin and info.destination:
        route = f"{info.origin} -> {info.destination}"

    dates = info.depart_date or "unknown departure date"
    if info.return_date:
        dates = f"{dates} to {info.return_date}"

    booking_type = info.booking_type or "unknown"
    airline = info.airline or "unknown airline"

    return (
        f"Extracted {booking_type} details: {route}, {dates}, airline/hotel: {airline}."
    )


class OcrServicer(ocr_pb2_grpc.OcrServiceServicer):
    def ExtractBookingInfo(self, request, context):
        session_id = request.session_id
        image_path = request.image_path
        backend = (request.ocr_backend or "mock").strip().lower()

        log.info("[%s] OCR request path=%r backend=%s", session_id, image_path, backend)

        if backend not in VALID_BACKENDS:
            context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
            context.set_details(
                f"Unsupported ocr_backend: {backend}. Supported: {sorted(VALID_BACKENDS)}"
            )
            return ocr_pb2.ExtractBookingResponse(
                success=False,
                summary="",
                error=f"Unsupported ocr_backend: {backend}",
            )

        try:
            provider = get_provider(backend)
            service = TripCheckService(ocr_provider=provider)
            payload = service.process_image(image_path)
        except Exception as exc:
            log.exception("[%s] OCR pipeline failed", session_id)
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(f"OCR pipeline failed: {exc}")
            return ocr_pb2.ExtractBookingResponse(
                success=False,
                summary="",
                error=f"OCR pipeline failed: {exc}",
            )

        if not payload.success:
            return ocr_pb2.ExtractBookingResponse(
                success=False,
                summary="",
                error=payload.error or "OCR extraction failed",
            )

        comparison_query_json = None
        if payload.comparison_query is not None:
            comparison_query_json = json.dumps(payload.comparison_query, ensure_ascii=True)

        raw_ocr_text = ""
        if payload.booking_info:
            raw_ocr_text = payload.booking_info.raw_text or ""

        return ocr_pb2.ExtractBookingResponse(
            success=True,
            summary=_summary_from_payload(payload),
            comparison_query_json=comparison_query_json,
            raw_ocr_text=raw_ocr_text,
        )


def serve() -> None:
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    ocr_pb2_grpc.add_OcrServiceServicer_to_server(OcrServicer(), server)
    addr = f"[::]:{GRPC_PORT}"
    server.add_insecure_port(addr)
    server.start()
    log.info("OCR gRPC server listening on %s", addr)
    server.wait_for_termination()


if __name__ == "__main__":
    serve()
