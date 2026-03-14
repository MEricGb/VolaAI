"""
formatter.py — Terminal output for the OCR / Trip Check feature.

All print logic lives here to keep main.py and trip_check.py clean.
Uses ANSI colour codes; degrades gracefully in plain terminals.
"""

from models import BookingInfo, TripCheckPayload
import json


# ── ANSI colours ──────────────────────────────────────────────────────────────

RESET   = "\033[0m"
BOLD    = "\033[1m"
DIM     = "\033[2m"
GREEN   = "\033[32m"
YELLOW  = "\033[33m"
CYAN    = "\033[36m"
MAGENTA = "\033[35m"
RED     = "\033[31m"
WHITE   = "\033[97m"


def _c(*args: str) -> str:
    """_c(text, code1, code2, …) — wrap text in ANSI codes."""
    codes = args[1:]
    return "".join(codes) + args[0] + RESET


def _div(char: str = "─", width: int = 64) -> str:
    return _c(char * width, DIM)


def _row(label: str, value: object, missing: str = "—", indent: int = 2) -> None:
    pad = " " * indent
    label_str = _c(f"{label}:", BOLD)
    if value is None or value == "" or value == []:
        val_str = _c(missing, DIM)
    else:
        val_str = str(value)
    print(f"{pad}{label_str:<32} {val_str}")


# ── Welcome banner ────────────────────────────────────────────────────────────

def print_welcome() -> None:
    print()
    print(_c("╔══════════════════════════════════════════════════════════════╗", CYAN, BOLD))
    print(_c("║   🔍  Trip Check — OCR Booking Parser   (hackathon proto)   ║", CYAN, BOLD))
    print(_c("╚══════════════════════════════════════════════════════════════╝", CYAN, BOLD))
    print()
    print("  Provide a local image path to extract and normalize booking details.")
    print(f"  Commands: {_c('/quit', YELLOW)}  {_c('/help', YELLOW)}  {_c('/samples', YELLOW)}")
    print()


def print_help() -> None:
    print()
    print(_c("  Commands:", BOLD))
    print("    /quit           — exit")
    print("    /help           — show this message")
    print("    /samples        — show available mock image paths for testing")
    print()
    print(_c("  Tips:", BOLD))
    print("    • Real image:  provide an absolute or relative path to a PNG/JPG/PDF")
    print("    • Mock mode:   type any path containing: wizz, hotel, search, messy")
    print("    • The mock OCR provider is active by default — no real file needed")
    print()


def print_samples() -> None:
    print()
    print(_c("  Mock paths you can type to trigger each sample scenario:", BOLD, CYAN))
    samples = [
        ("wizz_flight.png",     "Wizz Air round-trip booking confirmation"),
        ("hotel_reservation.jpg","Hotel reservation (Booking.com style)"),
        ("search_results.png",   "Flight search results page"),
        ("messy_scan.jpg",       "Noisy / low-quality OCR simulation"),
    ]
    for path, desc in samples:
        print(f"    {_c(path, YELLOW):<35}  {_c(desc, DIM)}")
    print()


# ── Error ─────────────────────────────────────────────────────────────────────

def print_error(msg: str) -> None:
    print(_c(f"\n  ⛔  {msg}\n", RED, BOLD))


# ── Main result ───────────────────────────────────────────────────────────────

def print_result(payload: TripCheckPayload, show_raw: bool = True) -> None:
    """Pretty-print a complete TripCheckPayload."""
    print()

    if not payload.success:
        print(_c("  ❌  Processing failed", RED, BOLD))
        print(_div())
        _row("Error", payload.error)
        print(_div())
        print()
        return

    info = payload.booking_info

    # ── Raw OCR text ──────────────────────────────────────────────────────
    if show_raw and info and info.raw_text:
        print(_c("  📄  RAW OCR TEXT", BOLD, DIM))
        print(_div())
        for line in info.raw_text.strip().splitlines():
            print(f"  {_c(line, DIM)}")
        print(_div())
        print()

    # ── BookingInfo ───────────────────────────────────────────────────────
    if info:
        _print_booking_info(info)

    # ── Comparison query ──────────────────────────────────────────────────
    if payload.comparison_query:
        _print_comparison_query(payload.comparison_query)
    else:
        print(_c("  ⚠   Comparison query", YELLOW, BOLD) +
              _c(" — not enough data to build (need origin, destination, date)", DIM))
        print()

    # ── Notes ─────────────────────────────────────────────────────────────
    if info and info.notes:
        _print_notes(info.notes)


def _print_booking_info(info: BookingInfo) -> None:
    # Confidence bar
    conf  = info.confidence or 0.0
    stars = int(conf * 10)
    bar   = "█" * stars + "░" * (10 - stars)
    conf_colour = GREEN if conf >= 0.7 else (YELLOW if conf >= 0.4 else RED)

    print(_c("  ✈   BOOKING INFO", BOLD, CYAN))
    print(_div())

    _row("Booking type",  info.booking_type)
    print()

    _row("Origin",        f"{info.origin or '—'}  ({info.origin_code or '?'})")
    _row("Destination",   f"{info.destination or '—'}  ({info.destination_code or '?'})")
    _row("Route (raw)",   info.route_text)
    print()

    _row("Depart date",   info.depart_date)
    _row("Return date",   info.return_date or _c("one-way / not found", DIM))
    print()

    _row("Airline",       info.airline)
    _row("Hotel",         info.hotel_name)
    print()

    price_str = f"{info.currency or ''} {info.price:.2f}".strip() if info.price else None
    _row("Price",         price_str)
    _row("Passengers",    info.passengers)
    print()

    print(
        f"  {_c('Confidence:', BOLD):<32} "
        f"{_c(bar, conf_colour)} {_c(f'{conf:.0%}', conf_colour, BOLD)}"
    )
    print(_div())
    print()


def _print_comparison_query(query: dict) -> None:
    print(_c("  🔎  COMPARISON QUERY  (ready for Vola scraper)", BOLD, MAGENTA))
    print(_div())
    # Pretty-print the JSON with colour
    json_str = json.dumps(query, indent=4)
    for line in json_str.splitlines():
        # Colour the keys
        line = line.replace('"', _c('"', DIM))
        print(f"  {line}")
    print(_div())
    print()


def _print_notes(notes: list[str]) -> None:
    print(_c("  📝  NOTES", BOLD, YELLOW))
    print(_div())
    for note in notes:
        print(f"  {_c('•', YELLOW)}  {note}")
    print(_div())
    print()


# ── Prompt ────────────────────────────────────────────────────────────────────

def prompt() -> str:
    return _c("Image path › ", BOLD, WHITE)
