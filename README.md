# Markdox — Konwerter dokumentów do Markdown

Web-aplikacja zamieniająca `PDF`, `JPG`, `PNG`, `DOCX`, `PPTX`, `TXT`, `MD`
na czysty **Markdown**. Działa offline; AI (chmura lub lokalne) jest opcjonalnym
boostem jakości dla skanów.

Aplikacja jest **bezstanowa** — żadne pliki nie są przechowywane na serwerze,
a klucz API pozostaje wyłącznie w przeglądarce użytkownika.

## Jak to działa — dwa tory

- **Tor A (cyfrowy):** `docx`, `pptx`, `pdf` z warstwą tekstową, `txt`, `md`
  → parsery deterministyczne, offline, bez AI.
- **Tor B (skan/OCR):** `jpg`, `png`, `pdf`-skan.
  - Bez AI → OCR **w przeglądarce** (tesseract.js dla obrazów, pdf.js + tesseract.js
    dla skanów PDF). Zero instalacji w systemie; model językowy pobiera się raz
    i jest cache'owany w przeglądarce.
  - Z AI → serwer rasteryzuje strony (PyMuPDF) i odczytuje modelem wizyjnym.

  > Backend **nie wymaga** natywnego Tesseracta.

Wybór toru jest automatyczny (PDF bez warstwy tekstowej → tor B).

## Warstwa AI (opcjonalna, multi-provider)

Ustawiana w UI, przesyłana per-request:
- **Wyłącz** — pełny offline.
- **Chmura** — Google Gemini, Anthropic (Claude) lub OpenAI (klucz API).
  Dostawca jest auto-wykrywany po prefiksie klucza (`sk-ant-`, `AIza`, `sk-`).
- **Lokalne** — dowolny endpoint zgodny z OpenAI (np. Ollama, LM Studio).

Model wybierasz z listy sugestii (lub wpisujesz własny). Wybór dostawcy jest
konieczny — każdy ma inny protokół API; sam klucz nie wystarczy. Model musi być
wizyjny (multimodalny), bo OCR czyta obraz.

## Uruchomienie — lokalnie

### Backend (FastAPI)
```bash
python -m venv .venv
.venv\Scripts\activate            # Windows (PowerShell: .venv\Scripts\Activate.ps1)
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --port 8000
```

### Frontend (React + Vite)
```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

## Uruchomienie — Docker
```bash
docker compose up --build
```
Backend: `http://localhost:8000` · Frontend: `http://localhost:5173`

## Testy
```bash
pytest backend/tests -q
```

## Limity (konfigurowalne w `.env`)
- Maks. **10** plików na batch
- Maks. **25 MB** na plik, **100 MB** na batch

## API
- `GET  /api/health` — status.
- `POST /api/convert` — multipart: `files[]` + pola AI (`ai_mode`, `ai_provider`,
  `ai_api_key`, `ai_base_url`, `ai_model`, `ocr_lang`). Zwraca listę wyników
  (jeden Markdown na plik).
- `POST /api/convert/zip` — JSON `{items:[{filename, content}]}` → paczka ZIP.
