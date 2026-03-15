"""
booking_parser.py — Extracts structured BookingInfo from raw OCR text.

Uses regex and heuristics only — no LLM, no external API.
Returns partial results gracefully when fields are missing.
Never fabricates values it cannot find in the text.
"""

import re
from typing import Optional

from models import BookingInfo
from utils import clean_ocr_text, parse_price, extract_date_range, normalize_date


# ── City → IATA mapping ───────────────────────────────────────────────────────
# Expand as needed. Keys are lowercase city names / aliases.

CITY_TO_IATA: dict[str, str] = {
    # Romania
    "bucharest": "OTP", "bucuresti": "OTP", "otopeni": "OTP",
    "cluj": "CLJ", "cluj-napoca": "CLJ",
    "timisoara": "TSR", "timișoara": "TSR",
    "iasi": "IAS", "iași": "IAS",
    "sibiu": "SBZ",
    "constanta": "CND", "constanța": "CND",
    # Western Europe
    "barcelona": "BCN",
    "paris": "CDG", "paris cdg": "CDG", "paris orly": "ORY",
    "london": "LHR", "london heathrow": "LHR", "london gatwick": "LGW",
    "luton": "LTN", "stansted": "STN",
    "manchester": "MAN", "edinburgh": "EDI", "birmingham": "BHX",
    "amsterdam": "AMS",
    "rome": "FCO", "roma": "FCO",
    "milan": "MXP", "milano": "MXP",
    "venice": "VCE", "venezia": "VCE",
    "naples": "NAP", "napoli": "NAP",
    "madrid": "MAD",
    "lisbon": "LIS", "lisboa": "LIS",
    "porto": "OPO",
    "berlin": "BER",
    "frankfurt": "FRA",
    "munich": "MUC", "münchen": "MUC",
    "dusseldorf": "DUS", "düsseldorf": "DUS",
    "hamburg": "HAM",
    "cologne": "CGN",
    "vienna": "VIE", "wien": "VIE",
    "zurich": "ZRH", "zürich": "ZRH",
    "geneva": "GVA",
    "brussels": "BRU", "bruxelles": "BRU",
    "dublin": "DUB",
    "stockholm": "ARN",
    "oslo": "OSL",
    "copenhagen": "CPH",
    "helsinki": "HEL",
    "warsaw": "WAW", "varsovia": "WAW",
    "prague": "PRG", "praga": "PRG",
    "budapest": "BUD",
    "zagreb": "ZAG",
    "sofia": "SOF",
    "athens": "ATH", "atena": "ATH",
    "thessaloniki": "SKG",
    "santorini": "JTR",
    "mykonos": "JMK",
    "heraklion": "HER", "crete": "HER",
    "rhodes": "RHO",
    "corfu": "CFU",
    "belgrade": "BEG",
    "valencia": "VLC",
    "malaga": "AGP",
    "seville": "SVQ",
    "palma": "PMI",
    "tenerife": "TFS",
    "lanzarote": "ACE",
    "fuerteventura": "FUE",
    # Turkey
    "istanbul": "IST",
    "antalya": "AYT",
    "ankara": "ESB",
    "izmir": "ADB",
    "bodrum": "BJV",
    "dalaman": "DLM",
    # Middle East / Africa
    "dubai": "DXB",
    "abu dhabi": "AUH",
    "doha": "DOH",
    "riyadh": "RUH",
    "jeddah": "JED",
    "kuwait": "KWI",
    "muscat": "MCT",
    "bahrain": "BAH",
    "amman": "AMM",
    "beirut": "BEY",
    "cairo": "CAI",
    "casablanca": "CMN",
    "marrakech": "RAK",
    "tel aviv": "TLV",
    "nairobi": "NBO",
    "lagos": "LOS",
    "accra": "ACC",
    "addis ababa": "ADD",
    "johannesburg": "JNB",
    "cape town": "CPT",
    # India
    "delhi": "DEL", "new delhi": "DEL",
    "mumbai": "BOM", "bombay": "BOM",
    "bangalore": "BLR", "bengaluru": "BLR",
    "hyderabad": "HYD",
    "chennai": "MAA", "madras": "MAA",
    "kolkata": "CCU", "calcutta": "CCU",
    "pune": "PNQ",
    "ahmedabad": "AMD",
    "goa": "GOI",
    "kochi": "COK", "cochin": "COK",
    "jaipur": "JAI",
    "lucknow": "LKO",
    "chandigarh": "IXC",
    "patna": "PAT",
    "bhubaneswar": "BBI",
    "nagpur": "NAG",
    "indore": "IDR",
    "coimbatore": "CJB",
    "tiruchirappalli": "TRZ", "trichy": "TRZ",
    "visakhapatnam": "VTZ",
    "srinagar": "SXR",
    "amritsar": "ATQ",
    "varanasi": "VNS",
    # Southeast Asia
    "bangkok": "BKK",
    "bali": "DPS",
    "denpasar": "DPS",
    "singapore": "SIN",
    "kuala lumpur": "KUL",
    "jakarta": "CGK",
    "manila": "MNL",
    "ho chi minh": "SGN", "saigon": "SGN",
    "hanoi": "HAN",
    "phnom penh": "PNH",
    "yangon": "RGN",
    "colombo": "CMB",
    "kathmandu": "KTM",
    "dhaka": "DAC",
    "phuket": "HKT",
    # East Asia
    "tokyo": "NRT",
    "osaka": "KIX",
    "seoul": "ICN",
    "beijing": "PEK",
    "shanghai": "PVG",
    "hong kong": "HKG",
    "taipei": "TPE",
    "guangzhou": "CAN",
    "shenzhen": "SZX",
    "chengdu": "CTU",
    "xian": "XIY",
    "chongqing": "CKG",
    "macau": "MFM",
    # Americas
    "new york": "JFK",
    "los angeles": "LAX",
    "miami": "MIA",
    "chicago": "ORD",
    "san francisco": "SFO",
    "dallas": "DFW",
    "houston": "IAH",
    "atlanta": "ATL",
    "boston": "BOS",
    "washington": "IAD",
    "toronto": "YYZ",
    "montreal": "YUL",
    "vancouver": "YVR",
    "mexico city": "MEX",
    "cancun": "CUN",
    "sao paulo": "GRU",
    "rio de janeiro": "GIG",
    "bogota": "BOG",
    "lima": "LIM",
    "santiago": "SCL",
    "buenos aires": "EZE",
    # Russia/CIS
    "moscow": "SVO",
    "saint petersburg": "LED", "st petersburg": "LED",
    "yekaterinburg": "SVX",
    "novosibirsk": "OVB",
    # Oceania
    "sydney": "SYD",
    "melbourne": "MEL",
    "brisbane": "BNE",
    "perth": "PER",
    "auckland": "AKL",
}

# ── Airline name patterns ──────────────────────────────────────────────────────
# Ordered longest/most-specific first to avoid partial matches.

AIRLINE_PATTERNS: list[tuple[str, str]] = [
    # European LCCs
    (r"wizz\s*air\s*malta",       "Wizz Air Malta"),
    (r"wizz\s*air",               "Wizz Air"),
    (r"ryanair",                  "Ryanair"),
    (r"easyjet",                  "easyJet"),
    (r"vueling",                  "Vueling"),
    (r"transavia",                "Transavia"),
    (r"volotea",                  "Volotea"),
    (r"jet2",                     "Jet2"),
    (r"norwegian",                "Norwegian"),
    (r"flybe",                    "Flybe"),
    (r"wizzair",                  "Wizz Air"),
    (r"smartwings",               "Smartwings"),
    (r"blue\s*air",               "Blue Air"),
    (r"corendon",                 "Corendon"),
    (r"tui\s*(airways|fly)?",     "TUI"),
    (r"sunexpress",               "SunExpress"),
    (r"condor",                   "Condor"),
    (r"eurowings",                "Eurowings"),
    (r"lauda(\s*motion)?",        "Lauda"),
    (r"pobeda",                   "Pobeda"),
    # European full-service
    (r"air\s*france",             "Air France"),
    (r"lufthansa",                "Lufthansa"),
    (r"british\s*airways",        "British Airways"),
    (r"klm",                      "KLM"),
    (r"swiss(\s*international)?", "Swiss"),
    (r"austrian(\s*airlines?)?",  "Austrian"),
    (r"brussels\s*airlines",      "Brussels Airlines"),
    (r"tap\s*(air\s*portugal)?",  "TAP Air Portugal"),
    (r"iberia",                   "Iberia"),
    (r"alitalia",                 "Alitalia"),
    (r"ita\s*airways",            "ITA Airways"),
    (r"finnair",                  "Finnair"),
    (r"\bsas(\s*scandinavian)?\b",    "SAS"),
    (r"lot(\s*polish)?",          "LOT"),
    (r"tarom",                    "TAROM"),
    (r"air\s*serbia",             "Air Serbia"),
    (r"croatia\s*airlines",       "Croatia Airlines"),
    (r"aegean",                   "Aegean Airlines"),
    (r"olympic(\s*air)?",         "Olympic Air"),
    (r"hisky",                    "HiSky"),
    (r"animawings?",              "Animawings"),
    (r"wizz\s*air\s*abu\s*dhabi", "Wizz Air Abu Dhabi"),
    # Middle East / Turkish
    (r"turkish\s*airlines?",      "Turkish Airlines"),
    (r"pegasus",                  "Pegasus Airlines"),
    (r"emirates",                 "Emirates"),
    (r"etihad",                   "Etihad Airways"),
    (r"qatar\s*airways?",         "Qatar Airways"),
    (r"flydubai",                 "flydubai"),
    (r"air\s*arabia",             "Air Arabia"),
    (r"el\s*al",                  "El Al"),
    (r"middle\s*east\s*airlines", "Middle East Airlines"),
    (r"oman\s*air",               "Oman Air"),
    (r"gulf\s*air",               "Gulf Air"),
    (r"saudia",                   "Saudia"),
    (r"flynas",                   "flynas"),
    (r"flyadeal",                 "flyadeal"),
    # Indian subcontinent
    (r"indigo",                   "IndiGo"),
    (r"\b6[Ee]\b",                "IndiGo"),
    (r"air\s*india\s*express",    "Air India Express"),
    (r"air\s*india",              "Air India"),
    (r"vistara",                  "Vistara"),
    (r"go\s*first",               "Go First"),
    (r"spicejet",                 "SpiceJet"),
    (r"akasa",                    "Akasa Air"),
    (r"star\s*air",               "Star Air"),
    (r"alliance\s*air",           "Alliance Air"),
    (r"blue\s*dart\s*aviation",   "Blue Dart Aviation"),
    # US carriers
    (r"delta(\s*air\s*lines?)?",  "Delta Air Lines"),
    (r"american(\s*airlines?)?",  "American Airlines"),
    (r"united(\s*airlines?)?",    "United Airlines"),
    (r"southwest",                "Southwest Airlines"),
    (r"jetblue",                  "JetBlue"),
    (r"alaska(\s*airlines?)?",    "Alaska Airlines"),
    (r"spirit(\s*airlines?)?",    "Spirit Airlines"),
    (r"frontier(\s*airlines?)?",  "Frontier Airlines"),
    (r"sun\s*country",            "Sun Country Airlines"),
    (r"avelo",                    "Avelo Airlines"),
    (r"breeze(\s*airways)?",      "Breeze Airways"),
    # Latin America
    (r"latam",                    "LATAM Airlines"),
    (r"avianca",                  "Avianca"),
    (r"copa(\s*airlines?)?",      "Copa Airlines"),
    (r"aeromexico",               "Aeromexico"),
    (r"gol(\s*airlines?)?",       "GOL Airlines"),
    (r"azul",                     "Azul Brazilian Airlines"),
    (r"sky\s*airline",            "Sky Airline"),
    (r"jetsmart",                 "JetSmart"),
    # Asian / Pacific
    (r"singapore\s*airlines?",    "Singapore Airlines"),
    (r"cathay\s*pacific",         "Cathay Pacific"),
    (r"japan\s*airlines?",        "Japan Airlines"),
    (r"ana\s+all\s+nippon",       "ANA"),
    (r"\bana\b",                  "ANA"),
    (r"korean\s*air",             "Korean Air"),
    (r"asiana",                   "Asiana Airlines"),
    (r"thai\s*airways?",          "Thai Airways"),
    (r"thai\s*lion",              "Thai Lion Air"),
    (r"thai\s*smile",             "Thai Smile"),
    (r"bangkok\s*airways?",       "Bangkok Airways"),
    (r"air\s*asia",               "AirAsia"),
    (r"airasia\s*x",              "AirAsia X"),
    (r"malindo",                  "Malindo Air"),
    (r"batik\s*air",              "Batik Air"),
    (r"lion\s*air",               "Lion Air"),
    (r"garuda",                   "Garuda Indonesia"),
    (r"citilink",                 "Citilink"),
    (r"wings\s*air",              "Wings Air"),
    (r"vietnam\s*airlines?",      "Vietnam Airlines"),
    (r"bamboo\s*airways?",        "Bamboo Airways"),
    (r"vietjet",                  "VietJet Air"),
    (r"cebu\s*pacific",           "Cebu Pacific"),
    (r"philippine\s*airlines?",   "Philippine Airlines"),
    (r"pal\s*express",            "PAL Express"),
    (r"china\s*southern",         "China Southern"),
    (r"china\s*eastern",          "China Eastern"),
    (r"air\s*china",              "Air China"),
    (r"hainan\s*airlines?",       "Hainan Airlines"),
    (r"xiamen\s*air",             "Xiamen Air"),
    (r"shenzhen\s*airlines?",     "Shenzhen Airlines"),
    (r"shandong\s*airlines?",     "Shandong Airlines"),
    (r"eva\s*air",                "EVA Air"),
    (r"china\s*airlines?",        "China Airlines"),
    (r"starlux",                  "Starlux Airlines"),
    (r"hong\s*kong\s*airlines?",  "Hong Kong Airlines"),
    (r"hong\s*kong\s*express",    "HK Express"),
    (r"cathay\s*dragon",          "Cathay Dragon"),
    (r"qantas",                   "Qantas"),
    (r"jetstar",                  "Jetstar"),
    (r"virgin\s*australia",       "Virgin Australia"),
    (r"rex(\s*airlines?)?",       "Regional Express"),
    (r"air\s*new\s*zealand",      "Air New Zealand"),
    # African / Other
    (r"ethiopian(\s*airlines?)?", "Ethiopian Airlines"),
    (r"kenya\s*airways?",         "Kenya Airways"),
    (r"royal\s*air\s*maroc",      "Royal Air Maroc"),
    (r"tunisair",                 "Tunisair"),
    (r"egyptair",                 "EgyptAir"),
    (r"south\s*african\s*airways","South African Airways"),
    (r"fastjet",                  "Fastjet"),
    (r"rwandair",                 "RwandAir"),
    # Russia / CIS
    (r"aeroflot",                 "Aeroflot"),
    (r"s7(\s*airlines?)?",        "S7 Airlines"),
    (r"ural\s*airlines?",         "Ural Airlines"),
    (r"azur\s*air",               "Azur Air"),
    # OCR noise variants of Ryanair (common misreads)
    (r"r[yi]anair",               "Ryanair"),
    (r"taranair",                 "Ryanair"),
    # IATA 2-letter codes as last resort (only when clearly a carrier context)
    (r"\bDL\b",                   "Delta Air Lines"),
    (r"\bAA\b",                   "American Airlines"),
    (r"\bUA\b",                   "United Airlines"),
    (r"\bBA\b",                   "British Airways"),
    (r"\bAF\b",                   "Air France"),
    (r"\bLH\b",                   "Lufthansa"),
    (r"\bEK\b",                   "Emirates"),
    (r"\bQR\b",                   "Qatar Airways"),
    (r"\bEY\b",                   "Etihad Airways"),
    (r"\bTK\b",                   "Turkish Airlines"),
    (r"\bSQ\b",                   "Singapore Airlines"),
    (r"\bCX\b",                   "Cathay Pacific"),
    (r"\bJL\b",                   "Japan Airlines"),
    (r"\bNH\b",                   "ANA"),
    (r"\bKE\b",                   "Korean Air"),
    (r"\bAI\b",                   "Air India"),
    (r"\bW6\b",                   "Wizz Air"),
    (r"\bFR\b",                   "Ryanair"),
    (r"\bU2\b",                   "easyJet"),
    (r"\bVY\b",                   "Vueling"),
    (r"\bTP\b",                   "TAP Air Portugal"),
]

# ── Hotel name heuristics ─────────────────────────────────────────────────────

HOTEL_KEYWORDS = [
    "hotel", "hostel", "resort", "inn", "suites", "lodge", "aparthotel",
    "holiday inn", "hilton", "marriott", "radisson", "ibis", "novotel",
    "pullman", "mercure", "sofitel", "sheraton", "hyatt",
]

# ── Booking type keywords ─────────────────────────────────────────────────────

FLIGHT_KEYWORDS = [
    "flight", "airline", "departure", "arrival", "boarding", "aircraft",
    "nonstop", "non-stop", "layover", "stopover", "gate", "seat", "economy",
    "business class", "first class", "boarding pass", "e-ticket",
    "wizz", "ryanair", "tarom", "lufthansa", "air france", "delta",
    "american airlines", "united", "british airways", "klm", "emirates",
]
HOTEL_KEYWORDS_DETECT = [
    "hotel", "check-in", "check-out", "check in", "check out",
    "room", "nights", "hostel", "resort", "booking.com", "expedia",
]
SEARCH_KEYWORDS = [
    "results", "search results", "sort by", "filter", "cheapest",
    "price from", "from €", "compare",
]


# ── BookingParser ─────────────────────────────────────────────────────────────

class BookingParser:
    """
    Parses raw OCR text into a BookingInfo dataclass.
    Never raises — returns partial results with notes on failures.
    """

    def parse(self, raw_text: str) -> BookingInfo:
        """Main entry point. Returns a BookingInfo (possibly partial)."""
        notes: list[str] = []
        text = clean_ocr_text(raw_text)
        lower = text.lower()

        booking_type  = self._detect_booking_type(lower)
        airline       = self._extract_airline(lower)
        hotel_name    = self._extract_hotel_name(raw_text) if booking_type == "hotel" else None

        # Try structured flight-segment line first (e.g. "6E 5021 BLR = DEL 30-04-2026")
        seg = self._extract_flight_segment(text, notes)
        if seg:
            origin, dest, origin_code, dest_code, route_text, seg_date = seg
            seg_depart, seg_return = extract_date_range(text)
            depart_date = seg_date or seg_depart
            # Only use seg_return as return_date if it's genuinely different from depart
            return_date = seg_return if seg_return and seg_return != depart_date else None
        else:
            origin, dest, origin_code, dest_code, route_text = self._extract_route(text, notes)
            depart_date, return_date = extract_date_range(text)

        price, currency = parse_price(text)
        passengers = self._extract_passengers(lower)

        confidence = self._compute_confidence(
            origin_code, dest_code, depart_date, price, airline, booking_type
        )

        return BookingInfo(
            booking_type    = booking_type,
            origin          = origin,
            destination     = dest,
            origin_code     = origin_code,
            destination_code= dest_code,
            route_text      = route_text,
            depart_date     = depart_date,
            return_date     = return_date,
            airline         = airline,
            hotel_name      = hotel_name,
            price           = price,
            currency        = currency,
            passengers      = passengers,
            raw_text        = raw_text,
            confidence      = confidence,
            notes           = notes,
        )

    # ── Booking type detection ─────────────────────────────────────────────

    def _detect_booking_type(self, lower: str) -> str:
        hotel_hits  = sum(1 for kw in HOTEL_KEYWORDS_DETECT  if kw in lower)
        flight_hits = sum(1 for kw in FLIGHT_KEYWORDS         if kw in lower)
        search_hits = sum(1 for kw in SEARCH_KEYWORDS         if kw in lower)

        if search_hits >= 2:
            return "search_result"
        if hotel_hits > flight_hits:
            return "hotel"
        if flight_hits > 0:
            return "flight"
        return "unknown"

    # ── Flight segment extraction ──────────────────────────────────────────

    # Matches patterns like:
    #   "6E 5021 BLR = DEL 30-04-2026"
    #   "6E-5021 BLR - DEL"
    #   "FR 1234 OTP → BCN 12-Apr-2026"
    #   "W6 1234 OTP BCN"
    _SEGMENT_RE = re.compile(
        r"\b([A-Z0-9]{2})\s*[-]?\s*(\d{1,5})"          # carrier code + flight number
        r"\s+([A-Z]{3})"                                  # origin IATA
        r"\s*(?:[=\-–→>/]+\s*)?"                          # optional separator
        r"([A-Z]{3})"                                     # destination IATA
        r"(?:\s+(\d{1,2}[-./]\d{2}[-./]\d{4}))?"         # optional date dd-mm-yyyy / dd/mm/yyyy
    )

    def _extract_flight_segment(
        self, text: str, notes: list[str]
    ) -> Optional[tuple[
        Optional[str], Optional[str], str, str, str, Optional[str]
    ]]:
        """
        Attempt to parse a structured flight-segment line.
        Returns (origin_city, dest_city, origin_code, dest_code, route_text, date_str)
        where date_str is YYYY-MM-DD if a date was captured, else None.
        Returns None if no segment pattern is found.
        """
        m = self._SEGMENT_RE.search(text)
        if not m:
            return None

        orig_code = m.group(3)
        dest_code = m.group(4)
        route_text = m.group(0)
        notes.append(f"Route extracted from flight-segment line: {route_text}")

        orig_city = self._iata_to_city(orig_code)
        dest_city = self._iata_to_city(dest_code)

        date_str: Optional[str] = None
        if m.group(5):
            from utils import normalize_date
            date_str = normalize_date(m.group(5))

        return orig_city, dest_city, orig_code, dest_code, route_text, date_str

    # ── Route extraction ───────────────────────────────────────────────────

    def _extract_route(
        self, text: str, notes: list[str]
    ) -> tuple[Optional[str], Optional[str], Optional[str], Optional[str], Optional[str]]:
        """
        Returns (origin_city, dest_city, origin_iata, dest_iata, route_text).
        Tries IATA codes first, then city names.
        """
        lower = text.lower()

        # 1. Explicit IATA → IATA patterns:  OTP → BCN  /  OTP - BCN
        m = re.search(
            r"\b([A-Z]{3})\s*(?:→|->|—|-|–|to)\s*([A-Z]{3})\b",
            text,
        )
        if m:
            orig_code = m.group(1)
            dest_code = m.group(2)
            route_text = m.group(0)
            orig_city = self._iata_to_city(orig_code)
            dest_city = self._iata_to_city(dest_code)
            return orig_city, dest_city, orig_code, dest_code, route_text

        # 2. "CITY(IATA) CITY(IATA)" pattern — e.g. "ROME(FCO) NYC(JFK)"
        #    Also handles "ROME(FCO)" alone (single airport mentioned)
        city_code_pairs = re.findall(r"([A-Za-z ]{2,20}?)\s*\(([A-Z]{3})\)", text)
        if len(city_code_pairs) >= 2:
            orig_city, orig_code = city_code_pairs[0][0].strip().title(), city_code_pairs[0][1]
            dest_city, dest_code = city_code_pairs[1][0].strip().title(), city_code_pairs[1][1]
            route_text = f"{orig_city}({orig_code}) {dest_city}({dest_code})"
            return orig_city, dest_city, orig_code, dest_code, route_text
        if len(city_code_pairs) == 1:
            city, code = city_code_pairs[0][0].strip().title(), city_code_pairs[0][1]
            notes.append(f"Only one airport found in CITY(IATA) format: {city} ({code})")
            return city, None, code, None, f"{city}({code})"

        # 3. City name → City name (with optional separator — handles boarding passes
        #    where cities appear side-by-side: "VIENNA BUCHAREST")
        city_list = list(CITY_TO_IATA.keys())
        city_list.sort(key=len, reverse=True)

        city_re = "|".join(re.escape(c) for c in city_list)
        m = re.search(
            r"(" + city_re + r")"
            r"\s*(?:\(([A-Z]{3})\))?"
            r"(?:\s*(?:→|->|—|-|to)\s*|\s+)"   # separator OR just whitespace
            r"(" + city_re + r")"
            r"\s*(?:\(([A-Z]{3})\))?",
            lower,
        )
        if m:
            orig_city  = m.group(1).title()
            orig_code  = m.group(2) or CITY_TO_IATA.get(m.group(1).lower())
            dest_city  = m.group(3).title()
            dest_code  = m.group(4) or CITY_TO_IATA.get(m.group(3).lower())
            route_text = m.group(0)
            if orig_code and not m.group(2):
                notes.append(f"Origin code {orig_code} inferred from city name '{orig_city}'")
            if dest_code and not m.group(4):
                notes.append(f"Destination code {dest_code} inferred from city name '{dest_city}'")
            return orig_city, dest_city, orig_code, dest_code, route_text

        # 3. Two city names on the same line separated only by whitespace
        #    e.g. "VIENNA BUCHAREST" or "Vienna  Paris"
        city_list_sorted = sorted(CITY_TO_IATA.keys(), key=len, reverse=True)
        city_re = "|".join(re.escape(c) for c in city_list_sorted)
        m = re.search(
            r"\b(" + city_re + r")\s{1,10}(" + city_re + r")\b",
            lower,
        )
        if m:
            orig_city = m.group(1).title()
            dest_city = m.group(2).title()
            orig_code = CITY_TO_IATA.get(m.group(1).lower())
            dest_code = CITY_TO_IATA.get(m.group(2).lower())
            notes.append(f"Route inferred from adjacent city names: {orig_city} → {dest_city}")
            return orig_city, dest_city, orig_code, dest_code, m.group(0)

        # 4. Lone IATA codes — last resort; heavily filtered to avoid false positives
        _ignore = {
            # Months
            "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
            "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
            # Common English words that happen to be 3 letters
            "FLY", "OUT", "THE", "AND", "FOR", "NOT", "BUT", "ALL",
            "ARE", "HAS", "HAD", "ITS", "ONE", "TWO", "SIX", "NEW",
            "OLD", "VIA", "AIR", "ETA", "ETD", "VIP",
            # Boarding pass / ticket labels
            "SEG", "PRE", "SEC", "SEQ", "DATE", "GATE", "BACK",
            "NON", "YES", "NUM",
            # Currency / financial codes
            "EUR", "USD", "GBP", "PDF", "URL", "GMT", "UTC",
            "VAT", "TAX", "REF", "SMS", "TSA", "NYC",
            "INR", "AED", "SAR", "SEK", "NOK", "DKK", "PLN",
            "CZK", "CHF", "CAD", "AUD", "SGD", "THB", "MYR",
            "IDR", "RON", "HKD", "JPY", "CNY", "KRW",
            # Invoice / document type noise
            "REG", "PNR", "GST", "CGS", "SGS", "TDS", "PAN",
            "CIN", "SAC", "HSN", "B2B", "B2C", "LTD", "PVT",
            "INC", "LLC", "LLP", "CEO", "CFO", "COO",
            # Specific airports handled via CITY(IATA) pattern above
            "FCO", "SFO", "DFW", "IAD", "ATL", "ORD", "LAX",
        }
        ref_codes = set(re.findall(r"#([A-Z]{3})", text))
        iata_codes = re.findall(r"\b([A-Z]{3})\b", text)
        iata_codes = [c for c in iata_codes if c not in _ignore and c not in ref_codes]
        seen_iata: list[str] = []
        for code in iata_codes:
            if code not in seen_iata:
                seen_iata.append(code)
        if len(seen_iata) >= 2:
            orig_code, dest_code = seen_iata[0], seen_iata[1]
            notes.append("Route inferred from standalone IATA codes in text")
            return None, None, orig_code, dest_code, f"{orig_code} {dest_code}"
        if len(seen_iata) == 1:
            notes.append(f"Only one IATA code found: {seen_iata[0]}")
            return None, None, seen_iata[0], None, seen_iata[0]

        # 4. Try to find any single city name to at least get destination
        for city in city_list:
            if city in lower:
                code = CITY_TO_IATA[city]
                notes.append(f"Only one location found: {city.title()} ({code})")
                return city.title(), None, code, None, city.title()

        return None, None, None, None, None

    def _iata_to_city(self, iata: str) -> Optional[str]:
        """Reverse lookup: IATA → city name."""
        for city, code in CITY_TO_IATA.items():
            if code == iata:
                return city.title()
        return None

    # ── Airline extraction ─────────────────────────────────────────────────

    def _extract_airline(self, lower: str) -> Optional[str]:
        for pattern, name in AIRLINE_PATTERNS:
            if re.search(pattern, lower):
                return name
        return None

    def _extract_hotel_name(self, text: str) -> Optional[str]:
        """
        Try to find a hotel name. Looks for lines containing hotel-brand keywords.
        Returns the most likely hotel name string.
        """
        for line in text.splitlines():
            line_lower = line.lower()
            if any(kw in line_lower for kw in HOTEL_KEYWORDS):
                # Clean up and return the line
                name = re.sub(r"(?i)(hotel|hostel|resort)\s*:", "", line).strip()
                if len(name) > 3:
                    return name
        return None

    # ── Passenger extraction ───────────────────────────────────────────────

    def _extract_passengers(self, lower: str) -> Optional[int]:
        patterns = [
            r"(\d+)\s+adults?",
            r"(\d+)\s+passengers?",
            r"(\d+)\s+pax",
            r"passengers?:\s*(\d+)",
            r"adults?:\s*(\d+)",
        ]
        for p in patterns:
            m = re.search(p, lower)
            if m:
                return int(m.group(1))
        return None

    # ── Confidence scoring ────────────────────────────────────────────────

    def _compute_confidence(
        self,
        origin_code: Optional[str],
        dest_code: Optional[str],
        depart_date: Optional[str],
        price: Optional[float],
        airline: Optional[str],
        booking_type: Optional[str],
    ) -> float:
        """
        Heuristic score: each key field adds weight.
        Clamp to [0.0, 1.0].
        """
        score = 0.0
        if origin_code:   score += 0.20
        if dest_code:     score += 0.20
        if depart_date:   score += 0.20
        if price:         score += 0.15
        if airline:       score += 0.15
        if booking_type and booking_type != "unknown": score += 0.10
        return round(min(max(score, 0.0), 1.0), 2)
