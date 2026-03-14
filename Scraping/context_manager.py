"""
context_manager.py — Rule-based extraction of travel parameters from free text.

Accumulates fields into TravelContext across multiple conversation turns.
No LLM here — purely regex + keyword matching, easy to swap later.
"""

import re
from datetime import date, timedelta
from typing import Optional

from models import TravelContext


# ── IATA / city lookup (expand as needed) ─────────────────────────────────────

CITY_TO_IATA: dict[str, str] = {
    # Romania
    "bucharest": "OTP", "otopeni": "OTP", "otp": "OTP",
    "cluj": "CLJ", "cluj-napoca": "CLJ", "clj": "CLJ",
    "timisoara": "TSR", "tsr": "TSR",
    "iasi": "IAS", "ias": "IAS",
    "sibiu": "SBZ", "sbz": "SBZ",
    "constanta": "CND", "cnd": "CND",
    "targu mures": "TGM", "tgm": "TGM",
    "oradea": "OMR", "omr": "OMR",
    "baia mare": "BAY", "bay": "BAY",
    "suceava": "SCV", "scv": "SCV",
    "craiova": "CRA", "cra": "CRA",
    "bacau": "BCM", "bcm": "BCM",
    # UK & Ireland
    "london": "LHR", "lhr": "LHR", "heathrow": "LHR",
    "gatwick": "LGW", "lgw": "LGW",
    "luton": "LTN", "ltn": "LTN",
    "stansted": "STN", "stn": "STN",
    "manchester": "MAN", "man": "MAN",
    "edinburgh": "EDI", "edi": "EDI",
    "birmingham": "BHX", "bhx": "BHX",
    "bristol": "BRS", "brs": "BRS",
    "dublin": "DUB", "dub": "DUB",
    # Western Europe
    "paris": "CDG", "cdg": "CDG", "orly": "ORY", "ory": "ORY",
    "amsterdam": "AMS", "ams": "AMS",
    "brussels": "BRU", "bru": "BRU",
    "frankfurt": "FRA", "fra": "FRA",
    "munich": "MUC", "muc": "MUC",
    "berlin": "BER", "ber": "BER",
    "hamburg": "HAM", "ham": "HAM",
    "dusseldorf": "DUS", "dus": "DUS",
    "cologne": "CGN", "cgn": "CGN",
    "vienna": "VIE", "vie": "VIE",
    "zurich": "ZRH", "zrh": "ZRH",
    "geneva": "GVA", "gva": "GVA",
    "basel": "BSL", "bsl": "BSL",
    "milan": "MXP", "mxp": "MXP", "linate": "LIN", "lin": "LIN",
    "rome": "FCO", "fco": "FCO", "ciampino": "CIA", "cia": "CIA",
    "venice": "VCE", "vce": "VCE",
    "florence": "FLR", "flr": "FLR",
    "naples": "NAP", "nap": "NAP",
    "catania": "CTA", "cta": "CTA",
    "palermo": "PMO", "pmo": "PMO",
    "madrid": "MAD", "mad": "MAD",
    "barcelona": "BCN", "bcn": "BCN",
    "valencia": "VLC", "vlc": "VLC",
    "seville": "SVQ", "svq": "SVQ",
    "malaga": "AGP", "agp": "AGP",
    "alicante": "ALC", "alc": "ALC",
    "palma": "PMI", "pmi": "PMI", "mallorca": "PMI",
    "ibiza": "IBZ", "ibz": "IBZ",
    "lisbon": "LIS", "lis": "LIS",
    "porto": "OPO", "opo": "OPO",
    "nice": "NCE", "nce": "NCE",
    "lyon": "LYS", "lys": "LYS",
    "marseille": "MRS", "mrs": "MRS",
    "toulouse": "TLS", "tls": "TLS",
    "bordeaux": "BOD", "bod": "BOD",
    # Scandinavia & Baltics
    "stockholm": "ARN", "arn": "ARN",
    "oslo": "OSL", "osl": "OSL",
    "copenhagen": "CPH", "cph": "CPH",
    "helsinki": "HEL", "hel": "HEL",
    "riga": "RIX", "rix": "RIX",
    "tallinn": "TLL", "tll": "TLL",
    "vilnius": "VNO", "vno": "VNO",
    # Eastern Europe
    "prague": "PRG", "prg": "PRG",
    "budapest": "BUD", "bud": "BUD",
    "warsaw": "WAW", "waw": "WAW",
    "krakow": "KRK", "krk": "KRK",
    "wroclaw": "WRO", "wro": "WRO",
    "gdansk": "GDN", "gdn": "GDN",
    "bratislava": "BTS", "bts": "BTS",
    "sofia": "SOF", "sof": "SOF",
    "belgrade": "BEG", "beg": "BEG",
    "zagreb": "ZAG", "zag": "ZAG",
    "sarajevo": "SJJ", "sjj": "SJJ",
    "skopje": "SKP", "skp": "SKP",
    "tirana": "TIA", "tia": "TIA",
    "chisinau": "KIV", "kiv": "KIV",
    "kiev": "KBP", "kyiv": "KBP", "kbp": "KBP",
    "lviv": "LWO", "lwo": "LWO",
    "minsk": "MSQ", "msq": "MSQ",
    # Russia
    "moscow": "SVO", "moskow": "SVO", "svo": "SVO",
    "domodedovo": "DME", "dme": "DME",
    "vnukovo": "VKO", "vko": "VKO",
    "saint petersburg": "LED", "st petersburg": "LED", "st. petersburg": "LED",
    "petersburg": "LED", "led": "LED",
    # Greece & Cyprus
    "athens": "ATH", "ath": "ATH",
    "thessaloniki": "SKG", "skg": "SKG",
    "heraklion": "HER", "her": "HER", "crete": "HER",
    "rhodes": "RHO", "rho": "RHO",
    "corfu": "CFU", "cfu": "CFU",
    "mykonos": "JMK", "jmk": "JMK",
    "santorini": "JTR", "jtr": "JTR",
    "zakynthos": "ZTH", "zth": "ZTH",
    "nicosia": "LCA", "larnaca": "LCA", "lca": "LCA",
    "paphos": "PFO", "pfo": "PFO",
    # Turkey
    "istanbul": "IST", "ist": "IST",
    "sabiha gokcen": "SAW", "saw": "SAW",
    "ankara": "ESB", "esb": "ESB",
    "antalya": "AYT", "ayt": "AYT",
    "izmir": "ADB", "adb": "ADB",
    "bodrum": "BJV", "bjv": "BJV",
    # Middle East
    "dubai": "DXB", "dxb": "DXB",
    "abu dhabi": "AUH", "auh": "AUH",
    "doha": "DOH", "doh": "DOH",
    "tel aviv": "TLV", "tlv": "TLV",
    "amman": "AMM", "amm": "AMM",
    "beirut": "BEY", "bey": "BEY",
    "riyadh": "RUH", "ruh": "RUH",
    "jeddah": "JED", "jed": "JED",
    # Asia
    "tokyo": "NRT", "nrt": "NRT", "narita": "NRT",
    "osaka": "KIX", "kix": "KIX",
    "beijing": "PEK", "pek": "PEK",
    "shanghai": "PVG", "pvg": "PVG",
    "hong kong": "HKG", "hkg": "HKG",
    "singapore": "SIN", "sin": "SIN",
    "bangkok": "BKK", "bkk": "BKK",
    "kuala lumpur": "KUL", "kul": "KUL",
    "jakarta": "CGK", "cgk": "CGK",
    "bali": "DPS", "dps": "DPS", "denpasar": "DPS",
    "delhi": "DEL", "new delhi": "DEL", "del": "DEL",
    "mumbai": "BOM", "bom": "BOM",
    "colombo": "CMB", "cmb": "CMB",
    "kathmandu": "KTM", "ktm": "KTM",
    "seoul": "ICN", "icn": "ICN",
    "taipei": "TPE", "tpe": "TPE",
    "hanoi": "HAN", "han": "HAN",
    "ho chi minh": "SGN", "saigon": "SGN", "sgn": "SGN",
    # Africa
    "cairo": "CAI", "cai": "CAI",
    "casablanca": "CMN", "cmn": "CMN",
    "marrakech": "RAK", "rak": "RAK",
    "tunis": "TUN", "tun": "TUN",
    "algiers": "ALG", "alg": "ALG",
    "nairobi": "NBO", "nbo": "NBO",
    "johannesburg": "JNB", "jnb": "JNB",
    "cape town": "CPT", "cpt": "CPT",
    "addis ababa": "ADD", "add": "ADD",
    "lagos": "LOS", "los": "LOS",
    "accra": "ACC", "acc": "ACC",
    # Americas
    "new york": "JFK", "jfk": "JFK", "nyc": "JFK",
    "newark": "EWR", "ewr": "EWR",
    "los angeles": "LAX", "lax": "LAX",
    "chicago": "ORD", "ord": "ORD",
    "miami": "MIA", "mia": "MIA",
    "toronto": "YYZ", "yyz": "YYZ",
    "montreal": "YUL", "yul": "YUL",
    "vancouver": "YVR", "yvr": "YVR",
    "mexico city": "MEX", "mex": "MEX",
    "sao paulo": "GRU", "gru": "GRU",
    "buenos aires": "EZE", "eze": "EZE",
    "bogota": "BOG", "bog": "BOG",
    "lima": "LIM", "lim": "LIM",
    "cancun": "CUN", "cun": "CUN",
    # Oceania
    "sydney": "SYD", "syd": "SYD",
    "melbourne": "MEL", "mel": "MEL",
    "brisbane": "BNE", "bne": "BNE",
    "auckland": "AKL", "akl": "AKL",
}

MONTH_NAMES: dict[str, int] = {
    "january": 1, "jan": 1,
    "february": 2, "feb": 2,
    "march": 3, "mar": 3,
    "april": 4, "apr": 4,
    "may": 5,
    "june": 6, "jun": 6,
    "july": 7, "jul": 7,
    "august": 8, "aug": 8,
    "september": 9, "sep": 9, "sept": 9,
    "october": 10, "oct": 10,
    "november": 11, "nov": 11,
    "december": 12, "dec": 12,
}


def _normalize_city(raw: str) -> Optional[str]:
    """Return IATA code for a city/airport string, or None if unknown."""
    key = raw.strip().lower()
    return CITY_TO_IATA.get(key)


def _extract_iata_pair(text: str) -> tuple[Optional[str], Optional[str]]:
    """
    Try to extract origin → destination from patterns like:
      'from Bucharest to Barcelona'
      'OTP to BCN'
      'fly Bucharest Barcelona'
      'destination Moscow'
      'fly to Antalya'
    Returns (origin_iata, destination_iata) — either may be None.
    """
    text_lower = text.lower()

    # Pattern: "from X to Y"
    m = re.search(r"\bfrom\s+([a-z\s\-]+?)\s+to\s+([a-z\s\-]+?)(?:\s|$|,|\.)", text_lower)
    if m:
        orig = _normalize_city(m.group(1).strip())
        dest = _normalize_city(m.group(2).strip())
        return orig, dest

    # Standalone IATA codes (3 uppercase letters) — check original text first
    # (handles "fly OTP to BCN", "OTP BCN", etc.)
    iata_codes = re.findall(r'\b([A-Z]{3})\b', text)
    if len(iata_codes) >= 2:
        return iata_codes[0], iata_codes[1]

    # Pattern: explicit "destination X" or "dest X"
    m = re.search(r"\b(?:destination|dest(?:ination)?)\s+([a-z\s\-]{3,25})(?:\s|$|,|\.)", text_lower)
    if m:
        dest = _normalize_city(m.group(1).strip())
        if dest:
            return iata_codes[0] if len(iata_codes) == 1 else None, dest

    # Pattern: explicit "origin X" or "from X" (standalone, no destination)
    m = re.search(r"\b(?:origin|from)\s+([a-z\s\-]{3,25})(?:\s|$|,|\.)", text_lower)
    if m:
        orig = _normalize_city(m.group(1).strip())
        if orig:
            return orig, iata_codes[0] if len(iata_codes) == 1 else None

    # Pattern: "X to Y" (without 'from') — generic; try this before standalone "to X"
    m = re.search(r"\b([a-z\s\-]{3,20}?)\s+to\s+([a-z\s\-]{3,20})(?:\s|$|,|\.)", text_lower)
    if m:
        orig = _normalize_city(m.group(1).strip())
        dest = _normalize_city(m.group(2).strip())
        if orig or dest:
            if len(iata_codes) == 1:
                if dest and not orig:
                    return iata_codes[0], dest
                if orig and not dest:
                    return orig, iata_codes[0]
            return orig, dest

    # Pattern: "fly/go/travel to X" or just "to X" — destination only
    m = re.search(r"\b(?:fly(?:ing)?|go(?:ing)?|travel(?:ling)?|head(?:ing)?|visit(?:ing)?)\s+to\s+([a-z\s\-]{3,25})(?:\s|$|,|\.)", text_lower)
    if not m:
        m = re.search(r"(?:^|\s)to\s+([a-z\s\-]{3,25})(?:\s|$|,|\.)", text_lower)
    if m:
        dest = _normalize_city(m.group(1).strip())
        if dest:
            return iata_codes[0] if len(iata_codes) == 1 else None, dest

    if len(iata_codes) == 1:
        return iata_codes[0], None

    # Last resort: scan every word/phrase against the city lookup
    words = text_lower.split()
    for i in range(len(words), 0, -1):
        for j in range(len(words) - i + 1):
            phrase = " ".join(words[j:j+i])
            iata = _normalize_city(phrase)
            if iata:
                return None, iata  # treat as destination if origin already known

    return None, None


def _extract_all_dates(text: str) -> list[date]:
    """
    Extract ALL dates mentioned in a message, in order of appearance.
    Used to detect both depart and return dates in a single message like
    'June 15, coming back June 22'.
    """
    today = date.today()
    found: list[tuple[int, date]] = []  # (position, date)

    # ISO: 2026-06-15
    for m in re.finditer(r'\b(\d{4})-(\d{2})-(\d{2})\b', text):
        found.append((m.start(), date(int(m.group(1)), int(m.group(2)), int(m.group(3)))))

    # DD/MM/YYYY or DD.MM.YYYY
    for m in re.finditer(r'\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b', text):
        found.append((m.start(), date(int(m.group(3)), int(m.group(2)), int(m.group(1)))))

    # "March 15" or "15 March"
    for month_name, month_num in MONTH_NAMES.items():
        for m in re.finditer(rf'\b{month_name}\s+(\d{{1,2}})\b', text.lower()):
            day = int(m.group(1))
            year = today.year if month_num >= today.month else today.year + 1
            found.append((m.start(), date(year, month_num, day)))

        for m in re.finditer(rf'\b(\d{{1,2}})\s+{month_name}\b', text.lower()):
            day = int(m.group(1))
            year = today.year if month_num >= today.month else today.year + 1
            found.append((m.start(), date(year, month_num, day)))

    # Relative: "in 2 weeks" / "in 10 days"
    m = re.search(r'\bin\s+(\d+)\s+weeks?\b', text.lower())
    if m:
        found.append((m.start(), today + timedelta(weeks=int(m.group(1)))))

    m = re.search(r'\bin\s+(\d+)\s+days?\b', text.lower())
    if m:
        found.append((m.start(), today + timedelta(days=int(m.group(1)))))

    # Sort by position and deduplicate
    found.sort(key=lambda x: x[0])
    seen: set[date] = set()
    result: list[date] = []
    for _, d in found:
        if d not in seen:
            seen.add(d)
            result.append(d)
    return result


def _extract_date(text: str) -> Optional[date]:
    """Return the first date found in text."""
    dates = _extract_all_dates(text)
    return dates[0] if dates else None


def _extract_month(text: str) -> Optional[str]:
    """Extract a month name if user expresses a vague month preference."""
    text_lower = text.lower()
    for month_name in MONTH_NAMES:
        if re.search(rf'\b{month_name}\b', text_lower):
            return month_name.capitalize()
    return None


def _extract_passengers(text: str) -> tuple[Optional[int], Optional[int]]:
    """Return (adults, children) counts, or (None, None) if not found."""
    adults = None
    children = None

    # "2 adults", "for 3 people", "we are 4", "just me"
    m = re.search(r'\b(\d+)\s+adults?\b', text.lower())
    if m:
        adults = int(m.group(1))

    m = re.search(r'\b(\d+)\s+(?:children|kids?|child)\b', text.lower())
    if m:
        children = int(m.group(1))

    m = re.search(r'\bfor\s+(\d+)\s+(?:people|persons?|passengers?)\b', text.lower())
    if m and adults is None:
        adults = int(m.group(1))

    m = re.search(r'\bwe\s+are\s+(\d+)\b', text.lower())
    if m and adults is None:
        adults = int(m.group(1))

    if re.search(r'\bjust\s+me\b|\balone\b|\bsolo\b', text.lower()) and adults is None:
        adults = 1

    return adults, children


def _extract_trip_length(text: str) -> Optional[int]:
    """Extract trip duration in nights: '7 nights', '1 week', '10 days'."""
    m = re.search(r'\b(\d+)\s+nights?\b', text.lower())
    if m:
        return int(m.group(1))

    m = re.search(r'\b(\d+)\s+weeks?\b', text.lower())
    if m:
        return int(m.group(1)) * 7

    m = re.search(r'\b(\d+)\s+days?\b', text.lower())
    if m:
        return max(1, int(m.group(1)) - 1)  # days → nights

    return None


def _extract_budget(text: str) -> Optional[str]:
    """Detect budget preference keywords."""
    text_lower = text.lower()
    if re.search(r'\bcheap\b|\blow.cost\b|\bbargain\b|\bbudget\b', text_lower):
        return "cheap"
    if re.search(r'\bbusiness\b|\bfirst.class\b|\bpremium\b', text_lower):
        return "business"
    if re.search(r'\bflexible\b|\bany price\b', text_lower):
        return "flexible"
    return None


def _is_one_way(text: str) -> bool:
    return bool(re.search(r'\bone.?way\b|\bno return\b|\bonly going\b', text.lower()))


def _wants_nonstop(text: str) -> bool:
    return bool(re.search(r'\bnonstop\b|\bnon.stop\b|\bdirect\b|\bno stop\b', text.lower()))


# ── Public API ─────────────────────────────────────────────────────────────────

class ContextManager:
    """
    Maintains a TravelContext and updates it from each user message.
    Call update(message) after each user turn.
    """

    def __init__(self) -> None:
        self.context = TravelContext()
        self.history: list[dict] = []   # raw conversation log

    def update(self, user_message: str) -> TravelContext:
        """Parse user_message and merge extracted fields into context."""
        self.history.append({"role": "user", "content": user_message})

        # Route
        orig, dest = _extract_iata_pair(user_message)
        if orig and not self.context.origin:
            self.context.origin = orig
        if dest and not self.context.destination:
            self.context.destination = dest

        # Dates — extract ALL dates in the message, assign in order
        all_dates = _extract_all_dates(user_message)
        for extracted_date in all_dates:
            if not self.context.depart_date:
                self.context.depart_date = extracted_date
            elif not self.context.return_date and extracted_date > self.context.depart_date:
                self.context.return_date = extracted_date
        if not all_dates and not self.context.depart_date:
            month = _extract_month(user_message)
            if month:
                self.context.month = month

        # Passengers
        adults, children = _extract_passengers(user_message)
        if adults is not None:
            self.context.adults = adults
        if children is not None:
            self.context.children = children

        # Trip length
        nights = _extract_trip_length(user_message)
        if nights is not None:
            self.context.trip_length_nights = nights
            # Auto-compute return_date if depart_date known
            if self.context.depart_date and not self.context.return_date:
                self.context.return_date = self.context.depart_date + timedelta(days=nights)

        # Preferences
        if _is_one_way(user_message):
            self.context.is_one_way = True
            self.context.return_date = None

        if _wants_nonstop(user_message):
            self.context.nonstop_only = True

        budget = _extract_budget(user_message)
        if budget:
            self.context.budget_preference = budget

        return self.context

    def reset(self) -> None:
        """Clear all context and history."""
        self.context = TravelContext()
        self.history.clear()

    def add_assistant_message(self, content: str) -> None:
        self.history.append({"role": "assistant", "content": content})
