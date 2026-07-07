"""Tor B — skany i obrazy (jpg, png, pdf-skan).

Model dwutorowy dla OCR:
- AI wyłączone → serwer NIE wykonuje OCR; zwraca flagę `client_ocr`,
  a odczyt robi przeglądarka (tesseract.js / pdf.js). Zero natywnych zależności.
- AI włączone → serwer rasteryzuje strony (PyMuPDF) i odczytuje je modelem
  wizyjnym (Gemini / OpenAI-compatible / lokalny).
"""
import io

import fitz  # PyMuPDF
from PIL import Image


def _pdf_to_images(file_bytes: bytes, dpi: int = 200) -> list[Image.Image]:
    images = []
    with fitz.open(stream=file_bytes, filetype="pdf") as doc:
        for page in doc:
            pix = page.get_pixmap(dpi=dpi)
            images.append(Image.open(io.BytesIO(pix.tobytes("png"))))
    return images


def _load_images(file_bytes: bytes, ext: str) -> list[Image.Image]:
    if ext == "pdf":
        return _pdf_to_images(file_bytes)
    return [Image.open(io.BytesIO(file_bytes))]


def convert_track_b_ai(file_bytes: bytes, ext: str, options: dict) -> str:
    """OCR przez AI (wymaga włączonego trybu chmura/lokalne)."""
    from backend.app.converters.ai_ocr import ai_ocr_image

    images = _load_images(file_bytes, ext)
    pages = [ai_ocr_image(img, options) for img in images]
    return "\n\n---\n\n".join(p for p in pages if p).strip()
