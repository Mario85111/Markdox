# Markdox — frontend

React 19 + TypeScript + Vite 8, Tailwind 4. Interfejs w stylu Norton Commandera:
dwa panele, obsługa klawiszami funkcyjnymi. Pełny opis aplikacji w
[README głównym](../README.md).

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # tsc -b && vite build
npm run lint      # oxlint
```

Backend jest oczekiwany pod `http://localhost:8000` — adres jest **zaszyty**
w [`src/App.tsx`](src/App.tsx) jako `API_BASE`. Przy wdrożeniu pod innym
adresem trzeba go zmienić (docelowo: zmienna `import.meta.env`).

## Pliki

| plik | rola |
|---|---|
| [`src/App.tsx`](src/App.tsx) | cały interfejs: kolejka plików, podgląd, dialog AI, skróty F2–F10 |
| [`src/ocrClient.ts`](src/ocrClient.ts) | OCR w przeglądarce — tesseract.js dla obrazów, pdf.js + tesseract.js dla skanów PDF |
| [`src/ocrLayout.ts`](src/ocrLayout.ts) | odtwarzanie nagłówków, akapitów i list z układu strony zwróconego przez OCR |
| [`src/index.css`](src/index.css) | paleta i komponenty w stylu terminala (zmienne `--nc-*`) |

## OCR po stronie przeglądarki

Gdy AI jest wyłączone, skany nie są odczytywane na serwerze — backend zwraca
`client_ocr: true`, a odczyt wykonuje przeglądarka. Model językowy tesseract.js
pobiera się przy pierwszym użyciu i jest cache'owany.

`ocrPdfFile` zwraca **tablicę stron** (`OcrPage[]`), nie sklejony tekst: numery
stron są potrzebne do prowenancji w trybie RAG, a każda strona niesie własną
pewność odczytu.

OCR jest uruchamiany z `{ text: true, blocks: true }` — od tesseract.js v5 dane
układu są opcjonalne, a bez nich zostaje sam `data.text`, czyli tekst bez
nagłówków i z twardymi łamaniami linii.

## Skróty klawiszowe

`F2` AI · `F3` podgląd · `F5` konwertuj · `F6` pobierz · `F7` ZIP ·
`F8` usuń · `F9` dodaj · `F10` wyczyść · `↑`/`↓` wybór pliku

Uwaga: `F5` jest przechwytywane i **nie odświeża strony**.
