"""Testy obróbki wyniku pod RAG: żywa pagina, prowenancja, łączenie stron."""
from backend.app.converters.postprocess import (
    assemble,
    build_front_matter,
    join_pages,
    strip_running_heads,
)


def _pages(n: int, body: str = "Tresc merytoryczna strony {i}.") -> list[str]:
    return [
        f"Poufne - ACME - strona {i} z {n}\n\n{body.format(i=i)}\n\nPoufne - ACME - strona {i} z {n}"
        for i in range(1, n + 1)
    ]


# ---------- żywa pagina ----------

def test_strips_header_and_footer_with_varying_page_numbers():
    out = strip_running_heads(_pages(5))
    assert not any("Poufne" in p for p in out)
    assert "Tresc merytoryczna strony 3." in out[2]


def test_keeps_everything_when_too_few_pages():
    """Przy dwóch stronach statystyka powtórzeń nie ma podstaw."""
    pages = _pages(2)
    assert strip_running_heads(pages) == pages


def test_never_strips_numbered_headings():
    """"# Rozdział 1".."# Rozdział 4" mają wspólny odcisk luźny."""
    pages = [f"# Rozdzial {i}\n\nTresc {i}." for i in range(1, 5)]
    out = strip_running_heads(pages)
    assert [f"# Rozdzial {i}" in out[i - 1] for i in range(1, 5)] == [True] * 4


def test_does_not_strip_body_lines_differing_only_by_number():
    """Regresja: normalizacja cyfr nie może zlewać wierszy z kwotami."""
    pages = [
        f"Faktura ACME\n\nKwota: {i}00 zl\n\nstrona {i}" for i in range(1, 6)
    ]
    out = strip_running_heads(pages)
    assert all(f"Kwota: {i}00 zl" in out[i - 1] for i in range(1, 6))
    assert not any("strona" in p for p in out)   # skrajna linia = stopka


def test_keeps_table_rows():
    pages = ["Naglowek X\n\n| A | B |\n| --- | --- |" for _ in range(4)]
    out = strip_running_heads(pages)
    assert all("| A | B |" in p for p in out)


# ---------- prowenancja ----------

def test_front_matter_contains_provenance():
    fm = build_front_matter(source="umowa.pdf", track="A", used_ai=False, pages=12)
    assert fm.startswith("---") and fm.endswith("---")
    assert 'source: "umowa.pdf"' in fm
    assert "pages: 12" in fm
    assert "used_ai: false" in fm


def test_front_matter_escapes_quotes_in_filename():
    fm = build_front_matter(source='dziwna"nazwa.pdf', track="A", used_ai=False)
    assert 'source: "dziwna\\"nazwa.pdf"' in fm
    assert "pages:" not in fm


# ---------- łączenie stron ----------

def test_faithful_mode_uses_horizontal_rule():
    assert join_pages(["A", "B"], rag_mode=False) == "A\n\n---\n\nB"


def test_rag_mode_marks_pages_without_hard_break():
    out = join_pages(["A", "B"], rag_mode=True)
    assert "<!-- markdox:strona 1 -->" in out
    assert "<!-- markdox:strona 2 -->" in out
    assert "\n---\n" not in out   # brak twardej granicy dla splittera


def test_page_numbering_survives_empty_pages():
    """Pusta strona nie może przesunąć numeracji — psułaby cytowania."""
    out = join_pages(["A", "   ", "C"], rag_mode=True)
    assert "<!-- markdox:strona 3 -->" in out
    assert "strona 2" not in out


# ---------- montaż ----------

def test_assemble_prepends_front_matter():
    md = assemble(["Tresc"], source="x.pdf", track="A", used_ai=False, rag_mode=True)
    assert md.startswith('---\nsource: "x.pdf"')
    assert "Tresc" in md
