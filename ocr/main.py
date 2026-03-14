"""
main.py — Terminal entry point for the OCR / Trip Check feature.

Run:
    python main.py                    # mock OCR (no real image needed)
    python main.py --ocr tesseract    # real local Tesseract OCR

Commands:
    /quit     — exit
    /help     — show help
    /samples  — show example mock paths
"""

import sys
import os
import argparse

from trip_check import TripCheckService
from ocr_provider import get_provider
from formatter import (
    print_welcome,
    print_help,
    print_samples,
    print_result,
    print_error,
    prompt,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Trip Check — OCR booking screenshot parser"
    )
    parser.add_argument(
        "--ocr",
        default="mock",
        choices=["mock", "tesseract", "google", "openai", "featherless"],
        help="OCR backend to use (default: mock)",
    )
    parser.add_argument(
        "--model",
        default=None,
        help=(
            "Vision model override for featherless/openai backends. "
            "E.g. --model Qwen/Qwen2.5-VL-7B-Instruct"
        ),
    )
    parser.add_argument(
        "--no-raw",
        action="store_true",
        help="Hide raw OCR text in output",
    )
    return parser.parse_args()


def run() -> None:
    args = parse_args()

    # Build OCR provider
    try:
        if args.ocr == "featherless" and args.model:
            from ocr_provider import FeatherlessOCRProvider
            ocr_provider = FeatherlessOCRProvider(model=args.model)
        else:
            ocr_provider = get_provider(args.ocr)
    except (ImportError, ValueError) as exc:
        print(f"\n  ⛔  Could not initialize OCR provider: {exc}\n")
        sys.exit(1)

    service  = TripCheckService(ocr_provider=ocr_provider)
    show_raw = not args.no_raw

    print_welcome()

    if args.ocr != "mock":
        print(f"  OCR backend: {args.ocr}\n")

    while True:
        # ── Read input ─────────────────────────────────────────────────────
        try:
            raw = input(prompt()).strip()
        except (EOFError, KeyboardInterrupt):
            print("\n\n  👋  Bye!\n")
            sys.exit(0)

        if not raw:
            continue

        lower = raw.lower()

        # ── Commands ───────────────────────────────────────────────────────
        if lower in ("/quit", "/exit", "/q"):
            print("\n  👋  Bye!\n")
            sys.exit(0)

        if lower in ("/help", "/h", "?"):
            print_help()
            continue

        if lower in ("/samples", "/sample", "/demo"):
            print_samples()
            continue

        # ── Validate path (only for non-mock providers) ────────────────────
        if args.ocr != "mock" and not os.path.exists(raw):
            print_error(f"File not found: {raw}")
            continue

        # ── Process image ──────────────────────────────────────────────────
        print(f"\n  ⏳  Processing: {raw} …\n")
        payload = service.process_image(raw)
        print_result(payload, show_raw=show_raw)


if __name__ == "__main__":
    run()
