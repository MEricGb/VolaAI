"""
formatter.py — Terminal output formatting for the flight-search assistant.

Keeps all print logic here so main.py stays clean.
Uses ANSI colour codes for readability; degrades gracefully in plain terminals.
"""

from typing import Optional
from models import TravelContext, FlightOffer
from planner import PlannerResult, PlannerAction


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
BG_DARK = "\033[40m"


def _c(text: str, *codes: str) -> str:
    """Wrap text in ANSI codes."""
    return "".join(codes) + str(text) + RESET


def _divider(char: str = "─", width: int = 60) -> str:
    return _c(char * width, DIM)


# ── Context display ───────────────────────────────────────────────────────────

def print_context(ctx: TravelContext) -> None:
    """Pretty-print the current TravelContext."""
    print()
    print(_c("  📋  TRAVEL CONTEXT", BOLD, CYAN))
    print(_divider())

    def row(label: str, value, default_msg: str = "—") -> None:
        val_str = str(value) if value not in (None, False, 0, "") else _c(default_msg, DIM)
        print(f"  {_c(label + ':', BOLD):<28} {val_str}")

    row("Origin",         ctx.origin)
    row("Destination",    ctx.destination)
    row("Depart date",    ctx.depart_date)
    row("Return date",    ctx.return_date)
    row("Month",          ctx.month)
    row("Adults",         ctx.adults if ctx.adults > 0 else None, "1")
    row("Children",       ctx.children if ctx.children > 0 else None, "0")
    row("Nonstop only",   "Yes" if ctx.nonstop_only else None, "No")
    row("Budget pref.",   ctx.budget_preference)
    row("Trip length",    f"{ctx.trip_length_nights} nights" if ctx.trip_length_nights else None)
    row("One-way",        "Yes" if ctx.is_one_way else None, "No (round-trip)")

    print(_divider())
    print()


# ── Planner decision display ──────────────────────────────────────────────────

def print_planner_result(result: PlannerResult) -> None:
    """Show what the planner decided."""
    icons = {
        PlannerAction.SEARCH_NOW:        ("🚀", GREEN),
        PlannerAction.ASK_CLARIFICATION: ("❓", YELLOW),
        PlannerAction.NO_SEARCH_YET:     ("⏳", DIM),
    }
    icon, colour = icons[result.action]
    label = result.action.value.replace("_", " ")
    print(f"  {icon}  {_c('Planner:', BOLD)} {_c(label, colour, BOLD)}")
    print(f"     {_c(result.reason, DIM)}")
    if result.clarification_question:
        print()
        print(f"  {_c('Assistant:', BOLD, CYAN)} {result.clarification_question}")
    print()


# ── Search query display ──────────────────────────────────────────────────────

def print_search_query(ctx: TravelContext) -> None:
    """Show the normalized query we're about to fire."""
    trip_type = "one-way" if ctx.is_one_way else "round-trip"
    date_info = ctx.depart_date or ctx.month or "?"
    pax = f"{ctx.adults}A"
    if ctx.children:
        pax += f" + {ctx.children}C"

    print(_c("  🔎  SEARCHING VOLA", BOLD, MAGENTA))
    print(_divider())
    print(
        f"  {_c(ctx.origin, BOLD)} → {_c(ctx.destination, BOLD)}  "
        f"[{trip_type}]  {_c(str(date_info), CYAN)}  {_c(pax, YELLOW)}"
    )
    if ctx.nonstop_only:
        print(f"  Filter: {_c('nonstop only', GREEN)}")
    if ctx.budget_preference:
        print(f"  Budget: {_c(ctx.budget_preference, GREEN)}")
    print(_divider())
    print()


# ── Offer list display ────────────────────────────────────────────────────────

def print_offers(offers: list[FlightOffer], cheapest: Optional[FlightOffer] = None) -> None:
    """Display a table of flight offers."""
    if not offers:
        print(_c("  ⚠  No offers found.", YELLOW))
        return

    print(_c(f"  ✈  {len(offers)} OFFERS FOUND", BOLD, GREEN))
    print(_divider())

    # Header
    print(
        f"  {'#':<3} {'Leg':<4} {'Airline':<15} {'Flight':<9} {'Date':<12} "
        f"{'Price':>8} {'Duration':<10} {'Stops':<8}"
    )
    print(_divider("·"))

    for i, offer in enumerate(offers, start=1):
        is_cheapest = cheapest and offer.offer_id == cheapest.offer_id
        row_colour  = GREEN if is_cheapest else RESET

        out_stops = "nonstop" if offer.is_nonstop() else f"{offer.stops} stop(s)"
        marker    = _c(" ★ CHEAPEST", GREEN, BOLD) if is_cheapest else ""

        # Outbound row
        print(
            _c(
                f"  {i:<3} {'OUT':<4} {offer.airline:<15} {offer.flight_number:<9} "
                f"{offer.depart_date:<12} {offer.formatted_price():>8} "
                f"{offer.formatted_duration():<10} {out_stops:<8}",
                row_colour,
            ) + marker
        )

        # Return row (if round-trip)
        if offer.return_date:
            ret_airline = offer.return_airline or offer.airline
            ret_flight  = offer.return_flight_number or "—"
            ret_dur     = ""
            if offer.return_duration_minutes:
                rh, rm = divmod(offer.return_duration_minutes, 60)
                ret_dur = f"{rh}h {rm:02d}m"
            ret_stops_str = ""
            if offer.return_stops is not None:
                ret_stops_str = "nonstop" if offer.return_stops == 0 else f"{offer.return_stops} stop(s)"
            print(
                _c(
                    f"  {'':3} {'RET':<4} {ret_airline:<15} {ret_flight:<9} "
                    f"{offer.return_date:<12} {'':>8} "
                    f"{ret_dur:<10} {ret_stops_str:<8}",
                    DIM,
                )
            )
        print()  # blank line between offers

    print(_divider())

    if cheapest:
        ret_info = f" → return {cheapest.return_date}" if cheapest.return_date else ""
        print(
            f"\n  {_c('Cheapest:', BOLD, GREEN)} "
            f"{cheapest.airline} {cheapest.flight_number}  "
            f"{_c(cheapest.formatted_price(), BOLD, GREEN)}  "
            f"({cheapest.formatted_duration()}, {'nonstop' if cheapest.is_nonstop() else str(cheapest.stops)+' stop(s)'})  "
            f"{_c(cheapest.depart_date + ret_info, CYAN)}"
        )
        print(f"  {_c('Book at:', DIM)} {_c(cheapest.deep_link, CYAN)}")

    print()


# ── Misc helpers ──────────────────────────────────────────────────────────────

def print_welcome() -> None:
    print()
    print(_c("╔══════════════════════════════════════════════════════════╗", CYAN, BOLD))
    print(_c("║   ✈  VOLA Flight Search Assistant  —  CLI Prototype  ✈  ║", CYAN, BOLD))
    print(_c("╚══════════════════════════════════════════════════════════╝", CYAN, BOLD))
    print()
    print("  Tell me where you want to fly and I'll search Vola for you.")
    print(f"  Commands: {_c('/context', YELLOW)}  {_c('/reset', YELLOW)}  {_c('/quit', YELLOW)}")
    print()


def print_reset() -> None:
    print(_c("\n  🔄  Context cleared. Let's start fresh!\n", YELLOW, BOLD))


def print_error(msg: str) -> None:
    print(_c(f"\n  ⛔  {msg}\n", RED, BOLD))


def print_prompt() -> str:
    """Print the user prompt and return it (just the visual — input() is in main.py)."""
    return _c("You › ", BOLD, WHITE)
