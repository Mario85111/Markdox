# TODO

## Normalizacja interpunkcji w `postprocess.py`

Deterministyczny krok czyszczący interpunkcję, obok istniejących
`strip_running_heads` / `build_front_matter` / `join_pages`.

**Powód.** Dziś w całym potoku nie ma żadnej normalizacji interpunkcji.
Jedyne czyszczenie po stronie serwera to `.strip()` oraz — wewnątrz komórek
tabel — zamiana `\n` na spację i escape `|` ([`track_a.py`](backend/app/converters/track_a.py)).
Warstwa układu ([`ocrLayout.ts`](frontend/src/ocrLayout.ts)) skleja wiersze
w zdania i cofa przeniesienia wyrazów, ale znaków interpunkcyjnych nie tyka.
Na ścieżce AI porządek zależy wyłącznie od modelu, więc jest niedeterministyczny.

### Zakres reguł
- spacja przed `,` `.` `;` `:` `!` `?` — usuwana; brak spacji po — dodawana
- zdublowana interpunkcja: `,,` `..` `?!?` → forma pojedyncza
- cudzysłowy ujednolicane do polskich `„…”` (wejście: `"` `»…«` `“…”`)
- myślniki: dywiz `-` w złożeniach vs półpauza `–` w zakresach i wtrąceniach
- wielokropek: `...` → `…`
- typowe pomyłki OCR w kontekście liczbowym/wyrazowym: `rn`→`m`, `l`→`1`, `0`→`O`
  (osobno przemyśleć — ryzyko fałszywych trafień jest tu największe)

### Wymagania
- **Nie dotykać** bloków kodu (otoczonych ```), wierszy tabel (`|`),
  front-mattera YAML i znaczników `<!-- markdox:strona N -->`.
- Reguły świadome polskiego — nie stosować odstępów typograficznych
  spod reguł francuskich.
- Osobny przełącznik, niezależny od `rag_mode`. Tryb wierny ma pozostać
  wiernym odwzorowaniem dokumentu, a normalizacja jest ingerencją w treść.
  Wymaga pola w `POST /api/convert`, w `schemas.py` i w UI (okno F2).
- Testy w `backend/tests/test_postprocess.py`, w tym regresje na to,
  czego krok NIE wolno mu ruszyć.

### Decyzja do podjęcia
Czy krok ma również działać na wyniku OCR w przeglądarce. Dziś
`strip_running_heads` tam nie dociera — heurystyka jest wyłącznie serwerowa
i ten sam podział dotknie normalizację, o ile nie przeniesie się jej
do wspólnej warstwy.

## Tryb konwersji do JSON jako drugi tryb wyjścia

Obok Markdowna — drugi format wyniku, wybierany w UI.

### Decyzja do podjęcia przed implementacją
Czym ma być ten JSON. Dwie różne rzeczy, o różnym koszcie:

1. **Opakowanie** — metadane z front-mattera jako pola obiektu plus gotowy
   Markdown w jednym polu. Tanie: `assemble()` w
   [`postprocess.py`](backend/app/converters/postprocess.py) już produkuje
   oba składniki, wystarczy nie sklejać ich w tekst.
2. **Struktura dokumentu** — drzewo nagłówków, akapitów, list i tabel.
   Dużo droższe: parsery toru A oddają Markdown, nie strukturę pośrednią,
   więc albo trzeba je przepisać, albo parsować własny wynik z powrotem.

Wariant 1 pokrywa typowe zastosowanie (podanie dokumentu do pipeline'u RAG
razem z prowenancją). Wariant 2 ma sens tylko wtedy, gdy odbiorca ma czytać
sekcje osobno.

### Czego dotknie
- `ConvertResult` w [`schemas.py`](backend/app/schemas.py) — pole `markdown`
  przestaje być jedynym nośnikiem wyniku
- `convert_file` w [`service.py`](backend/app/converters/service.py) i sam
  `assemble` — dziś zawsze zwracają sklejony tekst
- nowe pole formularza w [`convert.py`](backend/app/routes/convert.py)
  obok `rag_mode`, plus przełącznik w oknie **F2**
- frontend: rozszerzenie pliku przy pobieraniu (`.md` jest zaszyte w
  `_markdown_filename`), podgląd, nazwy w paczce ZIP
- OCR w przeglądarce składa wynik po swojej stronie — musi znać tryb,
  inaczej tor B zwróci Markdown mimo wybranego JSON-a

### Uwaga na styk z trybem RAG
Znaczniki stron (`<!-- markdox:strona N -->`) i granice `---` to rozwiązania
**tekstowe**. W JSON-ie strony powinny być listą, nie komentarzami w ciągu
znaków — inaczej powielamy ten sam problem w gorszej formie. To znaczy, że
`rag_mode` i tryb JSON nie są niezależne i trzeba rozstrzygnąć, co znaczy
ich połączenie.
