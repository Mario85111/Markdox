"""Tor B — skany i obrazy (jpg, png, pdf-skan).

Model dwutorowy dla OCR:
- AI wyłączone → serwer NIE wykonuje OCR; zwraca flagę `client_ocr`,
  a odczyt robi przeglądarka (tesseract.js / pdf.js). Zero natywnych zależności.
- AI włączone → serwer rasteryzuje strony (PyMuPDF) i odczytuje je modelem
  wizyjnym (Gemini / OpenAI-compatible / lokalny).
"""
import io

import pymupdf
from PIL import Image


def _pdf_to_images(file_bytes: bytes, dpi: int = 200) -> list[Image.Image]:
    images = []
    with pymupdf.open(stream=file_bytes, filetype="pdf") as doc:
        for page in doc:
            pix = page.get_pixmap(dpi=dpi)
            images.append(Image.open(io.BytesIO(pix.tobytes("png"))))
    return images


def _load_images(file_bytes: bytes, ext: str) -> list[Image.Image]:
    if ext == "pdf":
        return _pdf_to_images(file_bytes)
    return [Image.open(io.BytesIO(file_bytes))]


def convert_track_b_ai_pages(file_bytes: bytes, ext: str, options: dict) -> list[str]:
    """OCR przez AI, strona po stronie (wymaga trybu chmura/lokalne).

    Zwracamy listę stron, a nie sklejony tekst — orkiestrator potrzebuje
    granic stron do prowenancji i do usuwania powtarzalnych stopek.
    """
    from backend.app.converters.ai_ocr import ai_ocr_image

    images = _load_images(file_bytes, ext)
    return [(ai_ocr_image(img, options) or "").strip() for img in images]
