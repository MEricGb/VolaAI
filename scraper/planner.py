"""
planner.py — Decides what the assistant should do next based on TravelContext.

Three possible decisions:
  SEARCH_NOW         — we have enough info, fire a Vola query
  ASK_CLARIFICATION  — user clearly wants flights but required fields are missing
  NO_SEARCH_YET      — still gathering context, nothing to do yet

Also generates the clarification question when needed.
"""

from enum import Enum
from dataclasses import dataclass
from typing import Optional

from models import TravelContext


class PlannerAction(Enum):
    SEARCH_NOW = "SEARCH_NOW"
    ASK_CLARIFICATION = "ASK_CLARIFICATION"
    NO_SEARCH_YET = "NO_SEARCH_YET"


@dataclass
class PlannerResult:
    action: PlannerAction
    reason: str                            # short human-readable explanation
    clarification_question: Optional[str] = None   # set when action == ASK_CLARIFICATION


# Keywords that indicate the user is actively looking for flights / prices
SEARCH_INTENT_PATTERNS = [
    "flight", "fly", "ticket", "price", "cheap", "book", "find",
    "search", "show", "get me", "how much", "cost", "want to go",
    "looking for", "travel", "trip", "vacation", "holiday",
]


def _has_search_intent(last_message: str) -> bool:
    """Return True if the message signals flight-search intent."""
    low = last_message.lower()
    return any(kw in low for kw in SEARCH_INTENT_PATTERNS)


def _build_clarification_question(missing: list[str]) -> str:
    """Turn a list of missing field names into a polite question."""
    if len(missing) == 1:
        return f"To search for flights I still need: **{missing[0]}**. Could you provide that?"
    fields = ", ".join(f"**{f}**" for f in missing[:-1])
    return (
        f"Almost there! I still need a few details: {fields} and **{missing[-1]}**. "
        "Could you provide those?"
    )


class Planner:
    """
    Stateless planner — call decide() after every context update.
    """

    def decide(self, context: TravelContext, last_message: str) -> PlannerResult:
        """
        Evaluate current context + last user message and return a PlannerResult.
        """

        # ── 1. Do we already have enough to search? ────────────────────────
        if context.has_minimum_for_search():
            return PlannerResult(
                action=PlannerAction.SEARCH_NOW,
                reason=(
                    f"Route: {context.origin} → {context.destination}, "
                    f"date/month: {context.depart_date or context.month}"
                ),
            )

        # ── 2. Does the user clearly want prices but we're missing fields? ──
        if _has_search_intent(last_message):
            missing = context.missing_fields()
            if missing:
                return PlannerResult(
                    action=PlannerAction.ASK_CLARIFICATION,
                    reason=f"Search intent detected but missing: {', '.join(missing)}",
                    clarification_question=_build_clarification_question(missing),
                )

        # ── 3. Still building context (greeting, preference, etc.) ──────────
        return PlannerResult(
            action=PlannerAction.NO_SEARCH_YET,
            reason="Continuing to gather travel details.",
        )
