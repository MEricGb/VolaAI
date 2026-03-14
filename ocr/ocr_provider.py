"""
ocr_provider.py — OCR provider abstraction for the Trip Check feature.

Supports multiple backends via a common interface:
  MockOCRProvider      — returns sample texts for offline development / demos
  TesseractOCRProvider — wraps pytesseract (must be installed separately)

To add a new backend (e.g. Google Cloud Vision, OpenAI GPT-4o):
  1. Create a new class that inherits BaseOCRProvider
  2. Implement extract_text(image_path: str) -> str
  3. Pass it to TripCheckService(ocr_provider=YourProvider())

Usage:
  provider = get_provider("mock")     # offline / demo
  provider = get_provider("tesseract") # real local OCR
  text = provider.extract_text("/path/to/screenshot.png")
"""

import os
import random
from abc import ABC, abstractmethod
from typing import Literal


# ── Base interface ─────────────────────────────────────────────────────────────

class BaseOCRProvider(ABC):
    """All OCR backends must implement this interface."""

    @abstractmethod
    def extract_text(self, image_path: str) -> str:
        """
        Extract text from a local image file.
        Returns raw OCR string (may be noisy).
        Raises FileNotFoundError if the path does not exist.
        """


# ── Mock provider ──────────────────────────────────────────────────────────────

# Sample mock OCR texts to simulate real screenshots.
# Keys are scenario names; values are the OCR output that would be produced.
MOCK_TEXTS: dict[str, str] = {

    "wizz_flight_booking": """\
Wizz Air   Booking Confirmation
Booking reference: WZZABC123

OUTBOUND FLIGHT
OTP → BCN
Wednesday, 12 April 2026
Departure: 06:30  Arrival: 09:35
Flight W6 1234  |  Nonstop  |  3h 05m

RETURN FLIGHT
BCN → OTP
Sunday, 16 April 2026
Departure: 10:20  Arrival: 13:25
Flight W6 1235  |  Nonstop  |  3h 05m

Passengers: 1 adult
Total price: €187.98
""",

    "hotel_reservation": """\
Booking.com  Reservation Confirmed

Hotel: Ibis Barcelona Aeropuerto
Address: Carrer de Mas Blau II, 16, El Prat de Llobregat
Check-in:  Sat 12 Apr 2026
Check-out: Wed 16 Apr 2026
Nights: 4
Room: Standard Double

Guests: 2
Total: EUR 312.00

Booking reference: #BDC-7891234
Free cancellation until 11 Apr 2026
""",

    "flight_search_result": """\
Vola.ro  Flight Search Results
Bucharest (OTP)  →  Lisbon (LIS)
Date: 5 May 2026
Return: 12 May 2026
1 passenger

Results:
1. Ryanair  FR 4512   OTP→LIS  06:40-10:05  Nonstop  €89.99
2. TAP Air Portugal  TP 0672  OTP→LIS  11:30-17:50  1 stop  €142.00
3. Wizz Air  W6 3311  OTP→LIS  07:10-10:30  Nonstop  €94.50

Sort by: Price
""",

    "messy_ocr": """\
WlzzAlr  B00klng Conflrmatl0n
Ref: WZ7XY9

0TP  BCN  12-Apr-2026 0630  0935
W6  1234  Nonst0p  3h05m

Ret: BCN  OTP  16-Apr-2026
W6  1235  3h05m

1 Ad ult
Pr1ce: €187.98 EUR
""",
}


class MockOCRProvider(BaseOCRProvider):
    """
    Returns a pre-written sample text instead of performing real OCR.
    Useful for offline development, demos, and CI tests.

    If the image path contains a known keyword (wizz, hotel, search, messy),
    the matching sample is returned. Otherwise a random sample is used.
    """

    def extract_text(self, image_path: str) -> str:
        path_lower = image_path.lower()

        if "hotel" in path_lower:
            return MOCK_TEXTS["hotel_reservation"]
        if "search" in path_lower or "result" in path_lower:
            return MOCK_TEXTS["flight_search_result"]
        if "messy" in path_lower or "noisy" in path_lower:
            return MOCK_TEXTS["messy_ocr"]
        if "wizz" in path_lower or "flight" in path_lower or "book" in path_lower:
            return MOCK_TEXTS["wizz_flight_booking"]

        # Default: return a random sample so every run produces something useful
        return random.choice(list(MOCK_TEXTS.values()))


# ── Tesseract provider ─────────────────────────────────────────────────────────

class TesseractOCRProvider(BaseOCRProvider):
    """
    Wraps pytesseract for local CPU-based OCR.

    Install:
      brew install tesseract          # macOS
      sudo apt install tesseract-ocr  # Ubuntu
      pip install pytesseract pillow

    TODO: tune tesseract config string for travel screenshots:
      config='--psm 6 --oem 3'
      PSM 6 = assume uniform block of text (good for structured booking pages)
    """

    def __init__(self, lang: str = "eng", config: str = "--psm 6") -> None:
        self.lang   = lang
        self.config = config

        # Defer import so the module loads even without pytesseract installed
        try:
            import pytesseract
            from PIL import Image  # noqa: F401
            self._pytesseract = pytesseract
        except ImportError as exc:
            raise ImportError(
                "pytesseract and Pillow are required for TesseractOCRProvider.\n"
                "  pip install pytesseract pillow\n"
                "  brew install tesseract"
            ) from exc

    def extract_text(self, image_path: str) -> str:
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"Image not found: {image_path}")

        from PIL import Image, ImageOps
        import io

        # Open with Pillow first — it's far more tolerant of corrupt/truncated JPEGs
        # than Leptonica (which Tesseract uses internally when given a raw file path).
        # We convert to RGB and pass the PIL image object directly to pytesseract,
        # bypassing Leptonica's JPEG reader entirely.
        try:
            img = Image.open(image_path)
            img.load()  # force full decode; may warn but usually succeeds
        except Exception:
            # Last resort: try loading with LOAD_TRUNCATED_IMAGES flag
            from PIL import ImageFile
            ImageFile.LOAD_TRUNCATED_IMAGES = True
            img = Image.open(image_path)
            img.load()

        # Convert to RGB (Tesseract handles RGB best; avoids RGBA / palette issues)
        img = img.convert("RGB")

        text = self._pytesseract.image_to_string(img, lang=self.lang, config=self.config)
        return text


# ── Google Cloud Vision stub ──────────────────────────────────────────────────

class GoogleVisionOCRProvider(BaseOCRProvider):
    """
    TODO: implement Google Cloud Vision OCR.

    Install: pip install google-cloud-vision
    Auth:    set GOOGLE_APPLICATION_CREDENTIALS env var to your service account JSON.

    Stub — raises NotImplementedError until implemented.
    """

    def extract_text(self, image_path: str) -> str:
        # TODO: implement
        # from google.cloud import vision
        # client = vision.ImageAnnotatorClient()
        # with open(image_path, "rb") as f:
        #     content = f.read()
        # image    = vision.Image(content=content)
        # response = client.text_detection(image=image)
        # return response.full_text_annotation.text
        raise NotImplementedError("GoogleVisionOCRProvider is not yet implemented.")


# ── OpenAI GPT-4o Vision stub ─────────────────────────────────────────────────

class OpenAIVisionOCRProvider(BaseOCRProvider):
    """
    TODO: implement OpenAI GPT-4o vision OCR.

    Install: pip install openai python-dotenv
    Set:     OPENAI_API_KEY in .env or environment.

    Stub — raises NotImplementedError until implemented.
    """

    def extract_text(self, image_path: str) -> str:
        # TODO: implement
        # import base64, openai
        # with open(image_path, "rb") as f:
        #     b64 = base64.b64encode(f.read()).decode()
        # client = openai.OpenAI()
        # response = client.chat.completions.create(
        #     model="gpt-4o",
        #     messages=[{
        #         "role": "user",
        #         "content": [
        #             {"type": "text", "text": "Extract all text from this travel booking screenshot."},
        #             {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
        #         ],
        #     }],
        # )
        # return response.choices[0].message.content
        raise NotImplementedError("OpenAIVisionOCRProvider is not yet implemented.")


# ── Featherless: Tesseract + LLM cleanup pipeline ────────────────────────────

class FeatherlessOCRProvider(BaseOCRProvider):
    """
    Two-step pipeline:
      1. Tesseract extracts raw text from the image (free, local)
      2. A Featherless text LLM receives the noisy OCR output and returns
         a cleaned, faithfully structured version — fixing garbled characters,
         reordering scrambled lines, and preserving all travel-relevant fields.

    This is far more accurate than Tesseract alone on real-world screenshots.

    Install:  pip install pytesseract pillow openai python-dotenv
              brew install tesseract
    Set:      FEATHERLESS_API_KEY in .env or as environment variable.

    Model: any Featherless text model; Qwen2.5-72B-Instruct recommended.
    """

    _SYSTEM_PROMPT = """\
You are a precise travel-document OCR corrector.
You receive raw text extracted by Tesseract OCR from a travel booking screenshot.
The text may contain garbled characters, merged words, broken lines, or noise.

Your job:
1. Fix OCR errors (e.g. "0TP" → "OTP", "WlzzAlr" → "Wizz Air", "1 Apr1l" → "1 April").
2. Restore the logical reading order.
3. Preserve ALL information: flight numbers, IATA codes, dates, prices, airline names,
   hotel names, booking references, passenger counts. Do NOT remove or omit anything.
4. Output only the corrected plain text. No markdown, no headings, no commentary.
5. If a value is genuinely unreadable, write [UNREADABLE] in its place.

CRITICAL — dates and numbers:
- Digits are the most common OCR errors: 0/O, 1/I/l, 2/Z, 5/S, 6/b, 8/B
- Reproduce dates EXACTLY as they appear in the raw text. Do NOT guess or infer a date.
- If a date looks wrong (e.g. month 13, day 32), flag it with [CHECK DATE] but still copy it.
"""

    def __init__(
        self,
        model: str = "Qwen/Qwen2.5-72B-Instruct",
        api_key: str | None = None,
        tesseract_lang: str = "eng",
        tesseract_config: str = "--psm 6",
    ) -> None:
        self.model            = model
        self.tesseract_lang   = tesseract_lang
        self.tesseract_config = tesseract_config

        # ── Tesseract / Pillow ────────────────────────────────────────────
        try:
            import pytesseract
            from PIL import Image  # noqa: F401
            self._pytesseract = pytesseract
        except ImportError as exc:
            raise ImportError(
                "pytesseract and Pillow are required.\n"
                "  pip install pytesseract pillow\n"
                "  brew install tesseract"
            ) from exc

        # ── Featherless / OpenAI client ───────────────────────────────────
        resolved_key = api_key or os.environ.get("FEATHERLESS_API_KEY")
        if not resolved_key:
            try:
                from dotenv import load_dotenv
                load_dotenv()
                resolved_key = os.environ.get("FEATHERLESS_API_KEY")
            except ImportError:
                pass

        if not resolved_key:
            raise ValueError(
                "FEATHERLESS_API_KEY not found.\n"
                "  Add it to a .env file:  FEATHERLESS_API_KEY=your_key_here\n"
                "  Or export it:           export FEATHERLESS_API_KEY=your_key_here"
            )

        try:
            import openai
        except ImportError as exc:
            raise ImportError("pip install openai") from exc

        self._llm = openai.OpenAI(
            api_key=resolved_key,
            base_url="https://api.featherless.ai/v1",
        )

    def extract_text(self, image_path: str) -> str:
        """Run Tesseract then clean the result with a Featherless LLM."""
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"Image not found: {image_path}")

        # Step 1: Tesseract OCR (tolerant of corrupt JPEGs via Pillow)
        raw_ocr = self._tesseract_extract(image_path)

        if not raw_ocr.strip():
            return ""

        # Step 2: LLM cleanup
        cleaned = self._llm_clean(raw_ocr)
        return cleaned

    def _tesseract_extract(self, image_path: str) -> str:
        from PIL import Image, ImageFile, ImageEnhance, ImageFilter
        ImageFile.LOAD_TRUNCATED_IMAGES = True
        try:
            img = Image.open(image_path)
            img.load()
        except Exception as exc:
            raise RuntimeError(f"Could not open image: {exc}") from exc

        img = img.convert("RGB")
        img = self._preprocess(img)
        return self._pytesseract.image_to_string(
            img, lang=self.tesseract_lang, config=self.tesseract_config
        )

    @staticmethod
    def _preprocess(img):
        """
        Improve image quality before Tesseract reads it.
        Steps: upscale small images → greyscale → contrast boost → sharpen.
        These are the highest-impact steps for improving digit/character accuracy
        on real-world boarding pass / booking screenshots.
        """
        from PIL import Image, ImageEnhance, ImageFilter

        # 1. Upscale if the image is small — Tesseract works best at ~300 DPI.
        #    A typical phone screenshot is fine; boarding pass photos can be small.
        w, h = img.size
        if w < 1200:
            scale = 1200 / w
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)

        # 2. Convert to greyscale — removes colour noise, simplifies thresholding
        img = img.convert("L")

        # 3. Boost contrast — makes dark text stand out against light backgrounds
        img = ImageEnhance.Contrast(img).enhance(2.0)

        # 4. Sharpen — improves edge definition on blurry photos
        img = img.filter(ImageFilter.SHARPEN)
        img = img.filter(ImageFilter.SHARPEN)  # apply twice for stronger effect

        return img

    def _llm_clean(self, raw_ocr: str) -> str:
        """Send raw OCR text to Featherless LLM and return the cleaned version."""
        response = self._llm.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": self._SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": (
                        "Here is the raw OCR output from a travel booking screenshot. "
                        "Please clean and correct it:\n\n"
                        "---\n"
                        f"{raw_ocr}\n"
                        "---"
                    ),
                },
            ],
            max_tokens=1024,
            temperature=0.0,
        )
        return response.choices[0].message.content or raw_ocr


# ── Factory ───────────────────────────────────────────────────────────────────

ProviderName = Literal["mock", "tesseract", "google", "openai", "featherless"]


def get_provider(name: ProviderName = "mock") -> BaseOCRProvider:
    """
    Return an OCR provider instance by name.
    Defaults to mock for offline / demo usage.
    """
    providers: dict[str, type] = {
        "mock":        MockOCRProvider,
        "tesseract":   TesseractOCRProvider,
        "google":      GoogleVisionOCRProvider,
        "openai":      OpenAIVisionOCRProvider,
        "featherless": FeatherlessOCRProvider,
    }
    cls = providers.get(name)
    if cls is None:
        raise ValueError(f"Unknown OCR provider: {name!r}. Choose from: {list(providers)}")
    return cls()
