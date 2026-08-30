"""Obróbka wyniku konwersji pod kątem dalszego użycia w RAG.

Trzy niezależne kroki, każdy testowalny osobno:
- `strip_running_heads` — usuwa powtarzalne nagłówki i stopki stron,
- `build_front_matter` — dopisuje prowenancję (źródło, strony, narzędzie),
- `join_pages`         — łączy strony separatorem właściwym dla trybu.
"""
import re
from datetime import datetime, timezone

# Obszar żywej paginy. Nagłówek bywa dwuliniowy (firma + sekcja),
# stopka prawie zawsze jednoliniowa.
_HEAD_LINES = 2
_FOOT_LINES = 1
# Minimalna liczba stron, przy której statystyka powtórzeń ma sens.
_MIN_PAGES = 3
# Żywa pagina jest krótka; dłuższa linia to już treść.
_MAX_LEN = 120

_DIGITS = re.compile(r"\d+")
_WS = re.compile(r"\s+")


def _exact_fp(line: str) -> str:
    """Odcisk dosłowny — różnica w cyfrach różnicuje linie."""
    return _WS.sub(" ", line.strip().lower())


def _loose_fp(line: str) -> str:
    """Odcisk z pominięciem liczb: "str. 3" i "str. 7" to ta sama stopka."""
    return _DIGITS.sub("#", _exact_fp(line))


def _is_protected(line: str) -> bool:
    """Linie, których nigdy nie kasujemy.

    Nagłówek jest kotwicą semantyczną chunka, a "# Rozdział 1".."# Rozdział 9"
    dają ten sam odcisk luźny — bez tej reguły znikałyby wszystkie nagłówki
    numerowane. Wiersze tabel i długie linie to treść.
    """
    stripped = line.strip()
    return (
        not stripped
        or stripped.startswith("#")
        or stripped.startswith("|")
        or len(stripped) > _MAX_LEN
    )


def _edges(lines: list[str]) -> tuple[set[int], set[int]]:
    """Zwraca (pas krawędziowy, linie skrajne).

    Rozróżnienie jest istotne: dopasowanie z pominięciem liczb stosujemy
    WYŁĄCZNIE do linii skrajnych, bo tylko tam mieszka numer strony.
    Gdyby objąć nim cały pas, wiersz "Kwota: 1200" i "Kwota: 3400"
    zlałyby się w jeden odcisk i zniknęłyby jako rzekoma żywa pagina.
    """
    filled = [i for i, l in enumerate(lines) if not _is_protected(l)]
    if not filled:
        return set(), set()
    band = set(filled[:_HEAD_LINES]) | set(filled[-_FOOT_LINES:])
    outer = {filled[0], filled[-1]}
    return band, outer


def strip_running_heads(pages: list[str], threshold: float = 0.6) -> list[str]:
    """Usuwa linie powtarzające się na krawędziach większości stron."""
    if len(pages) < _MIN_PAGES:
        return pages

    split = [p.split("\n") for p in pages]
    exact: dict[str, int] = {}
    loose: dict[str, int] = {}
    for lines in split:
        band, outer = _edges(lines)
        for fp in {_exact_fp(lines[i]) for i in band}:
            if len(fp) >= 3:
                exact[fp] = exact.get(fp, 0) + 1
        for fp in {_loose_fp(lines[i]) for i in outer}:
            if len(fp) >= 3:
                loose[fp] = loose.get(fp, 0) + 1

    limit = max(_MIN_PAGES, threshold * len(pages))
    noise_exact = {fp for fp, n in exact.items() if n >= limit}
    noise_loose = {fp for fp, n in loose.items() if n >= limit}
    if not noise_exact and not noise_loose:
        return pages

    out = []
    for lines in split:
        band, outer = _edges(lines)
        kept = [
            l for i, l in enumerate(lines)
            if not (
                (i in band and _exact_fp(l) in noise_exact)
                or (i in outer and _loose_fp(l) in noise_loose)
            )
        ]
        out.append("\n".join(kept).strip())
    return out


def _yaml_str(value: str) -> str:
    return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"') + '"'


def build_front_matter(
    *, source: str, track: str, used_ai: bool, pages: int | None = None
) -> str:
    """Front-matter YAML z prowenancją — bez niego RAG nie zbuduje cytowania."""
    fields = [
        ("source", _yaml_str(source)),
        ("track", _yaml_str(track)),
        ("used_ai", "true" if used_ai else "false"),
        ("converter", '"markdox"'),
        ("converted_at", _yaml_str(datetime.now(timezone.utc).isoformat(timespec="seconds"))),
    ]
    if pages is not None:
        fields.insert(2, ("pages", str(pages)))
    body = "\n".join(f"{k}: {v}" for k, v in fields)
    return f"---\n{body}\n---"


def join_pages(pages: list[str], *, rag_mode: bool) -> str:
    """Łączy strony.

    Tryb wierny: pozioma linia `---` odwzorowuje łamanie strony.
    Tryb RAG: komentarz HTML — zachowuje numer strony do cytowania,
    ale nie tworzy twardej granicy, na której splitter przetnie zdanie.
    """
    filled = [(n, p) for n, p in enumerate(pages, start=1) if p.strip()]
    if not filled:
        return ""
    if not rag_mode:
        return "\n\n---\n\n".join(p for _, p in filled)
    return "\n\n".join(f"<!-- markdox:strona {n} -->\n\n{p}" for n, p in filled)


def assemble(
    pages: list[str], *, source: str, track: str, used_ai: bool, rag_mode: bool
) -> str:
    """Pełny montaż dokumentu wyjściowego."""
    if rag_mode:
        pages = strip_running_heads(pages)
    front = build_front_matter(
        source=source, track=track, used_ai=used_ai, pages=len(pages) or None
    )
    body = join_pages(pages, rag_mode=rag_mode)
    return f"{front}\n\n{body}".strip()
