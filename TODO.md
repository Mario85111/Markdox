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
