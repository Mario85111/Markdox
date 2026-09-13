# Zasoby OCR — pochodzenie i licencje

Plik generowany przez `npm run ocr:assets`
([`scripts/fetch-ocr-assets.mjs`](../../scripts/fetch-ocr-assets.mjs)).
Nie edytuj ręcznie — zmiany przepadną przy następnym uruchomieniu.

Żaden plik w tym katalogu nie jest częścią Markdoxa. Wszystkie pochodzą
z projektów zewnętrznych i są tu kopiowane po to, żeby OCR w przeglądarce
działał bez sięgania po CDN. Markdox jest na licencji MIT ([`LICENSE`](../../../LICENSE)),
ale poniższe zasoby zachowują własne warunki.

| plik | pochodzenie | wersja | licencja |
|---|---|---|---|
| `worker.min.js` | [tesseract.js](https://github.com/naptha/tesseract.js) | 7.0.0 | Apache-2.0 |
| `core/*.wasm.js` | [tesseract.js-core](https://github.com/naptha/tesseract.js-core) | 7.0.0 | Apache-2.0 |
| `tessdata/*.traineddata.gz` | [tessdata_best](https://github.com/tesseract-ocr/tessdata_best) przez [@tesseract.js-data](https://github.com/naptha/tessdata) | 4.0.0_best_int | Apache-2.0 |

Pełny tekst licencji: [`LICENSE-Apache-2.0.txt`](LICENSE-Apache-2.0.txt).
Modele językowe (`pol`, `eng`) pochodzą z projektu Tesseract OCR,
którego autorami praw autorskich są Google Inc. i współtwórcy Tesseracta.

Rdzeń WASM jest kompilacją Tesseracta emscriptenem; obejmują go dodatkowo
warunki bibliotek, z którymi Tesseract jest linkowany (m.in. Leptonica).
Wszystkie są permisywne i zgodne z Apache-2.0.
