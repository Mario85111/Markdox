"""Wykrywanie typu pliku i wyboru toru konwersji (A = cyfrowy, B = skan/OCR)."""
import pymupdf

TRACK_A_EXTS = {"docx", "pptx", "txt", "md", "markdown"}
IMAGE_EXTS = {"jpg", "jpeg", "png", "webp", "bmp", "tiff", "tif"}


def get_ext(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def pdf_has_text_layer(file_bytes: bytes) -> bool:
    """True, jeśli PDF ma warstwę tekstową (choć jedna strona z tekstem)."""
    try:
        with pymupdf.open(stream=file_bytes, filetype="pdf") as doc:
            for page in doc:
                if page.get_text().strip():
                    return True
    except Exception:
        return False
    return False


def detect(file_bytes: bytes, filename: str) -> tuple[str, str]:
    """Zwraca (track, ext), gdzie track ∈ {"A", "B", "?"}."""
    ext = get_ext(filename)
    if ext in TRACK_A_EXTS:
        return "A", ext
    if ext in IMAGE_EXTS:
        return "B", ext
    if ext == "pdf":
        return ("A" if pdf_has_text_layer(file_bytes) else "B"), "pdf"
    return "?", ext
