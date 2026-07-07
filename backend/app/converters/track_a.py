"""Tor A — dokumenty cyfrowe (docx, pptx, pdf-tekst, txt/md) → Markdown.

Deterministyczne parsery, bez AI, offline.
"""
import io

import fitz  # PyMuPDF
from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph
from pptx import Presentation


# ---------- helpery wspólne ----------

def _rows_to_gfm(rows: list[list[str]]) -> str:
    """Lista wierszy → tabela w składni GFM. Pierwszy wiersz = nagłówek."""
    rows = [[(c or "").strip().replace("\n", " ").replace("|", "\\|") for c in r] for r in rows]
    rows = [r for r in rows if any(r)]
    if not rows:
        return ""
    ncol = max(len(r) for r in rows)
    rows = [r + [""] * (ncol - len(r)) for r in rows]
    out = ["| " + " | ".join(rows[0]) + " |",
           "| " + " | ".join(["---"] * ncol) + " |"]
    for r in rows[1:]:
        out.append("| " + " | ".join(r) + " |")
    return "\n".join(out)


# ---------- DOCX ----------

def _iter_block_items(parent):
    """Iteruje akapity i tabele w kolejności występowania w dokumencie."""
    from docx.document import Document as _Doc
    from docx.oxml.table import CT_Tbl
    from docx.oxml.text.paragraph import CT_P

    parent_elm = parent.element.body if isinstance(parent, _Doc) else parent
    for child in parent_elm.iterchildren():
        if isinstance(child, CT_P):
            yield Paragraph(child, parent)
        elif isinstance(child, CT_Tbl):
            yield Table(child, parent)


def _run_md(run) -> str:
    text = run.text or ""
    if not text.strip():
        return text
    lead = text[: len(text) - len(text.lstrip())]
    trail = text[len(text.rstrip()):]
    core = text.strip()
    if run.bold and run.italic:
        core = f"***{core}***"
    elif run.bold:
        core = f"**{core}**"
    elif run.italic:
        core = f"*{core}*"
    return f"{lead}{core}{trail}"


def _paragraph_md(p: Paragraph) -> str:
    text = "".join(_run_md(r) for r in p.runs).strip()
    if not text:
        return ""
    style = (p.style.name or "").lower() if p.style else ""
    if style.startswith("heading"):
        digits = "".join(ch for ch in style if ch.isdigit())
        level = min(max(int(digits) if digits else 1, 1), 6)
        return "#" * level + " " + text
    if style in ("title",):
        return "# " + text
    if style in ("subtitle",):
        return "## " + text
    if "list" in style:
        return "- " + text
    return text


def _docx_table_md(table: Table) -> str:
    rows = [[cell.text for cell in row.cells] for row in table.rows]
    return _rows_to_gfm(rows)


def docx_to_md(file_bytes: bytes) -> str:
    doc = Document(io.BytesIO(file_bytes))
    parts: list[str] = []
    for block in _iter_block_items(doc):
        if isinstance(block, Paragraph):
            md = _paragraph_md(block)
        else:
            md = _docx_table_md(block)
        if md:
            parts.append(md)
    return "\n\n".join(parts).strip()


# ---------- PPTX ----------

def _pptx_table_md(table) -> str:
    rows = [[cell.text for cell in row.cells] for row in table.rows]
    return _rows_to_gfm(rows)


def pptx_to_md(file_bytes: bytes) -> str:
    prs = Presentation(io.BytesIO(file_bytes))
    slides_md: list[str] = []
    for i, slide in enumerate(prs.slides, start=1):
        lines = [f"## Slajd {i}", ""]
        for shape in slide.shapes:
            if shape.has_table:
                lines.append(_pptx_table_md(shape.table))
                lines.append("")
            elif shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    text = "".join(run.text for run in para.runs).strip()
                    if not text:
                        continue
                    level = para.level or 0
                    lines.append("  " * level + "- " + text)
                lines.append("")
        slides_md.append("\n".join(lines).strip())
    return "\n\n".join(s for s in slides_md if s).strip()


# ---------- PDF (warstwa tekstowa) ----------

def pdf_text_to_md(file_bytes: bytes) -> str:
    pages: list[str] = []
    with fitz.open(stream=file_bytes, filetype="pdf") as doc:
        for page in doc:
            blocks = page.get_text("blocks")
            blocks = sorted(blocks, key=lambda b: (round(b[1]), round(b[0])))
            para = []
            for b in blocks:
                text = (b[4] or "").strip()
                if text:
                    para.append(" ".join(text.split()))
            if para:
                pages.append("\n\n".join(para))
    return "\n\n---\n\n".join(pages).strip()


# ---------- TXT / MD ----------

def text_passthrough(file_bytes: bytes) -> str:
    for enc in ("utf-8", "utf-16", "windows-1250", "iso-8859-2"):
        try:
            return file_bytes.decode(enc).strip()
        except UnicodeDecodeError:
            continue
    return file_bytes.decode("utf-8", errors="replace").strip()


# ---------- dispatcher ----------

def convert_track_a(file_bytes: bytes, ext: str) -> str:
    if ext == "docx":
        return docx_to_md(file_bytes)
    if ext == "pptx":
        return pptx_to_md(file_bytes)
    if ext == "pdf":
        return pdf_text_to_md(file_bytes)
    if ext in ("txt", "md", "markdown"):
        return text_passthrough(file_bytes)
    raise ValueError(f"Tor A nie obsługuje rozszerzenia .{ext}")
