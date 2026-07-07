"""Orkiestrator konwersji: jeden plik → jeden wynik Markdown."""
from backend.app.converters import track_a, track_b
from backend.app.converters.detect import detect, get_ext


def _markdown_filename(filename: str) -> str:
    base = filename.rsplit(".", 1)[0] if "." in filename else filename
    return (base or "dokument") + ".md"


def convert_file(file_bytes: bytes, filename: str, options: dict) -> dict:
    ext = get_ext(filename)
    track, _ = detect(file_bytes, filename)
    ai_on = (options.get("ai_mode") or "off") != "off"

    result = {
        "filename": filename,
        "markdown_filename": _markdown_filename(filename),
        "status": "ok",
        "track": track,
        "markdown": None,
        "used_ai": False,
        "client_ocr": False,
        "ocr_confidence": None,
        "warning": None,
        "error": None,
    }

    try:
        if track == "A":
            result["markdown"] = track_a.convert_track_a(file_bytes, ext)
            if not (result["markdown"] or "").strip():
                result["warning"] = "Konwersja nie wykryła żadnego tekstu w pliku."
        elif track == "B":
            if ai_on:
                result["markdown"] = track_b.convert_track_b_ai(file_bytes, ext, options)
                result["used_ai"] = True
            else:
                # OCR wykona przeglądarka (tesseract.js / pdf.js)
                result["client_ocr"] = True
        else:
            result["status"] = "error"
            result["error"] = f"Nieobsługiwany format pliku: .{ext or '?'}"
    except Exception as e:
        result["status"] = "error"
        result["error"] = str(e)

    return result
