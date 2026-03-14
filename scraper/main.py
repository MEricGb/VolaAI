"""
main.py — Terminal loop for the Vola flight-search assistant prototype.

Run with:
    python main.py

Commands:
    /context  — show current TravelContext
    /reset    — clear context and start over
    /quit     — exit

Flow per user message:
    1. Parse message → update TravelContext
    2. Ask Planner what to do
    3. If SEARCH_NOW → call VolaClient → print offers
    4. If ASK_CLARIFICATION → print question
    5. If NO_SEARCH_YET → just show updated context
"""

import sys
from context_manager import ContextManager
from planner import Planner, PlannerAction
from vola_client import VolaClient
from formatter import (
    print_welcome,
    print_context,
    print_planner_result,
    print_search_query,
    print_offers,
    print_reset,
    print_error,
    print_prompt,
)


def run() -> None:
    """Main terminal loop."""
    ctx_mgr  = ContextManager()
    planner  = Planner()
    vola     = VolaClient(use_mock=False)  # live Vola API — set True for offline mock

    print_welcome()

    while True:
        # ── Read user input ────────────────────────────────────────────────
        try:
            raw = input(print_prompt()).strip()
        except (EOFError, KeyboardInterrupt):
            print("\n\n  👋  Bye!\n")
            sys.exit(0)

        if not raw:
            continue

        # ── Built-in commands ──────────────────────────────────────────────
        lower = raw.lower()

        if lower in ("/quit", "/exit", "/q"):
            print("\n  👋  Bye!\n")
            sys.exit(0)

        if lower == "/reset":
            ctx_mgr.reset()
            print_reset()
            continue

        if lower == "/context":
            print_context(ctx_mgr.context)
            continue

        # ── Update context from message ────────────────────────────────────
        context = ctx_mgr.update(raw)

        # ── Show updated context after every message ───────────────────────
        print_context(context)

        # ── Ask planner what to do ─────────────────────────────────────────
        result = planner.decide(context, last_message=raw)
        print_planner_result(result)

        # ── Act on planner decision ────────────────────────────────────────
        if result.action == PlannerAction.SEARCH_NOW:
            print_search_query(context)

            try:
                if context.is_one_way:
                    offers = vola.search_one_way(context)
                else:
                    offers = vola.search_round_trip(context)
            except Exception as exc:
                print_error(f"Vola search failed: {exc}")
                continue

            cheapest = min(offers, key=lambda o: o.price_eur) if offers else None
            print_offers(offers, cheapest)

            # Save assistant reply to history
            if cheapest:
                ctx_mgr.add_assistant_message(
                    f"Found {len(offers)} offers. "
                    f"Cheapest: {cheapest.airline} {cheapest.formatted_price()}"
                )

        elif result.action == PlannerAction.ASK_CLARIFICATION:
            # Question already printed inside print_planner_result()
            pass

        # NO_SEARCH_YET — context updated, keep collecting info silently


if __name__ == "__main__":
    run()
