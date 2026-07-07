"""Testy jednostkowe torów konwersji (bez zależności od sieci/AI)."""
import io

from docx import Document
from pptx import Presentation

from backend.app.converters import track_a
from backend.app.converters.detect import detect, get_ext
from backend.app.converters.service import convert_file


def _docx_bytes() -> bytes:
    doc = Document()
    doc.add_heading("Tytuł dokumentu", level=1)
    doc.add_paragraph("Zwykły akapit tekstu.")
    doc.add_heading("Sekcja", level=2)
    table = doc.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "A"
    table.cell(0, 1).text = "B"
    table.cell(1, 0).text = "1"
    table.cell(1, 1).text = "2"
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _pptx_bytes() -> bytes:
    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[5])
    slide.shapes.title.text = "Slajd tytułowy"
    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


def test_get_ext():
    assert get_ext("plik.PDF") == "pdf"
    assert get_ext("obraz.JPG") == "jpg"
    assert get_ext("bez_rozszerzenia") == ""


def test_docx_to_markdown():
    md = track_a.docx_to_md(_docx_bytes())
    assert "# Tytuł dokumentu" in md
    assert "## Sekcja" in md
    assert "| A | B |" in md
    assert "| --- | --- |" in md


def test_pptx_to_markdown():
    md = track_a.pptx_to_md(_pptx_bytes())
    assert "## Slajd 1" in md
    assert "Slajd tytułowy" in md


def test_detect_track_a_for_docx():
    data = _docx_bytes()
    track, ext = detect(data, "test.docx")
    assert track == "A"
    assert ext == "docx"


def test_detect_image_is_track_b():
    track, ext = detect(b"\x89PNG\r\n", "skan.png")
    assert track == "B"


def test_text_passthrough_roundtrip():
    md = track_a.text_passthrough("# Cześć\n\nĄĘŚ".encode("utf-8"))
    assert "Cześć" in md and "ĄĘŚ" in md


def test_service_full_docx():
    result = convert_file(_docx_bytes(), "raport.docx", {})
    assert result["status"] == "ok"
    assert result["track"] == "A"
    assert result["markdown_filename"] == "raport.md"
    assert "# Tytuł dokumentu" in result["markdown"]


def test_service_unsupported_format():
    result = convert_file(b"dane", "plik.xyz", {})
    assert result["status"] == "error"
    assert "Nieobsługiwany" in result["error"]
