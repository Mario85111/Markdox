# Markdox — Konwerter dokumentów do Markdown

Web-aplikacja zamieniająca `PDF`, `JPG`, `PNG`, `DOCX`, `PPTX`, `TXT`, `MD`
na czysty **Markdown**. Działa offline; AI (chmura lub lokalne) jest opcjonalne.

Aplikacja jest **bezstanowa** — żaden plik ani klucz nie jest zapisywany
na serwerze. Zakres przetwarzania klucza API opisuje sekcja
[Bezpieczeństwo i prywatność](#bezpieczeństwo-i-prywatność).

## Jak to działa — dwa tory

- **Tor A (cyfrowy):** `docx`, `pptx`, `pdf` z warstwą tekstową, `txt`, `md`
  → parsery deterministyczne, offline, bez AI.
- **Tor B (skan/OCR):** `jpg`, `png`, `pdf`-skan.
  - Bez AI → OCR **w przeglądarce** (tesseract.js dla obrazów, pdf.js + tesseract.js
    dla skanów PDF). Zero instalacji w systemie. Skrypt workera, rdzeń WASM
    i modele językowe są serwowane z własnego origin, więc pierwszy OCR
    również działa bez internetu (patrz [Zasoby OCR](#zasoby-ocr)).
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

**Czy AI jest potrzebne?** Dla toru A — nie, parsery dają nagłówki i tabele
deterministycznie. Dla skanów AI podnosi jakość, ale nie jest warunkiem
uzyskania struktury: OCR w przeglądarce odtwarza ją z układu strony
(patrz [OCR w przeglądarce](#ocr-w-przeglądarce)). Tryb **Lokalne** daje przy
tym tę samą jakość co chmura, bez kosztu za stronę i bez wysyłania skanów
na zewnątrz.

## Tryb pod RAG

Przełącznik w oknie **F2**. Domyślnie wyłączony — wtedy wynik jest wiernym
odwzorowaniem dokumentu. Włączony zmienia układ pliku `.md` pod chunking:

| | tryb wierny | tryb pod RAG |
|---|---|---|
| granica strony | pozioma linia `---` | `<!-- markdox:strona N -->` |
| żywa pagina | zachowana | usuwana, jeśli powtarza się na ≥60% stron |
| prowenancja | front-matter YAML | front-matter YAML |

Powód rozdzielenia: `---` to dla większości splitterów twarda granica cięcia,
więc zdanie przechodzące przez łamanie strony trafia do dwóch chunków.
Komentarz HTML zachowuje numer strony do cytowania, nie tworząc takiej granicy.

Front-matter jest dodawany **zawsze**, w obu trybach — bez niego RAG nie zbuduje
odsyłacza do źródła:

```yaml
---
source: "umowa.pdf"
track: "A"
pages: 12
used_ai: false
converter: "markdox"
converted_at: "2026-08-30T05:49:47+00:00"
---
```

Usuwanie żywej paginy jest dwupoziomowe, żeby nie kasować treści:
w pasie krawędziowym strony dopasowanie jest **dosłowne**, a dopasowanie
z pominięciem liczb (dla numerów stron) obowiązuje wyłącznie w linii pierwszej
i ostatniej. Nagłówki (`#`) oraz wiersze tabel nie są nigdy usuwane — inaczej
zniknęłyby wszystkie numerowane nagłówki typu „Rozdział 1", które po pominięciu
cyfr są nieodróżnialne od siebie.

### Czego ten tryb nie robi
- Nie powtarza nagłówka tabeli przy podziale — to zadanie splittera, nie
  konwertera; na etapie konwersji granice chunków nie są znane.
- OCR w przeglądarce dostaje front-matter, znaczniki stron i odtworzoną
  strukturę, ale **nie** usuwanie żywej paginy; ta heurystyka działa tylko
  po stronie serwera.

## Jakość konwersji

### PDF
PDF-y przechodzą przez `pymupdf4llm`: rozpoznaje kolejność czytania w układach
wielokolumnowych, wyprowadza nagłówki z rozmiaru czcionki i wyciąga tabele jako
GFM. Wcześniejsze sortowanie bloków po współrzędnych (y, x) przeplatało kolumny
i potrafiło skleić zdania z dwóch kolumn w jeden akapit.

Ograniczenie: rozpoznanie kolumn opiera się na analizie układu i działa
niezawodnie przy akapitach normalnej długości. Krótkie, rozproszone pola
tekstowe w siatce potrafią zostać zinterpretowane jako tabela albo scalone —
w takim wypadku warto włączyć OCR przez AI, który czyta stronę jako obraz.

### DOCX
Style `Heading 1..6`, `Title` i `Subtitle` mapują się na `#`..`######`.
Tabele trafiają do GFM. Znane ograniczenia: zagnieżdżenie list jest spłaszczane
do jednego poziomu, a komórki scalone bywają powielane.

### PPTX
Tytuł slajdu staje się nagłówkiem `##`. Wcześniej jedynym nagłówkiem było
`## Slajd N` — etykieta bez treści, powtarzalna w każdej prezentacji, a właściwy
tytuł lądował wśród punktorów. Pozostałe kształty stają się listą, z wcięciem
odpowiadającym poziomowi akapitu.

### OCR w przeglądarce
Tesseract zwraca nie tylko tekst, ale i układ strony: bloki → akapity → linie
→ słowa, każde z `bbox` i pewnością odczytu.
[`ocrLayout.ts`](frontend/src/ocrLayout.ts) odtwarza z tego strukturę:

- **nagłówki** — z wysokości wiersza względem mediany strony
  (≥1,8× → `#`, ≥1,35× → `##`, ≥1,15× → `###`, tylko dla wierszy ≤90 znaków),
- **akapity** — wiersze sklejane z powrotem w zdania, z cofnięciem przeniesień
  wyrazów; to usuwa twarde łamania linii, na których splitter ciął w połowie zdania,
- **listy** — punktory i numeracja jako zwarta lista,
- **`ocr_confidence`** — średnia pewność odczytu, trafia do front-mattera
  i na pasek statusu (żółty poniżej 70%).

Dwie uwagi z implementacji. Nie używamy `rowAttributes.rowHeight`: dla tego
samego tekstu 20 px potrafi zwrócić raz 28,1, raz 18, bo zawiera zapas na
wydłużenia liter. Stabilny jest `bbox`. Klasyfikacja idzie też po **wierszach,
nie akapitach** — Tesseract potrafi wstawić nagłówek do tego samego akapitu
co poprzedzająca treść.

Ograniczenie: to heurystyka geometryczna. Skan przekrzywiony, wielokolumnowy
albo o jednolitej wielkości czcionki nie da nagłówków — wtedy pomaga AI.

### Zasoby OCR

tesseract.js domyślnie pobiera w czasie działania trzy rzeczy z jsDelivr:
skrypt workera, rdzeń WASM i model językowy. Aplikacja deklarująca pracę
offline realizowałaby ją więc dopiero od drugiego uruchomienia — i tylko
w tej samej przeglądarce, do pierwszego wyczyszczenia danych witryny.

Dlatego wszystkie trzy są serwowane z własnego origin. Ścieżki ustawia
[`ocrClient.ts`](frontend/src/ocrClient.ts) (`workerPath`, `corePath`,
`langPath`), a pliki generuje `npm run ocr:assets`
([`fetch-ocr-assets.mjs`](frontend/scripts/fetch-ocr-assets.mjs)):

| zasób | skąd | rozmiar |
|---|---|---|
| `worker.min.js` | `node_modules/tesseract.js` | 0,1 MB |
| rdzeń WASM, 3 warianty | `node_modules/tesseract.js-core` | 11,2 MB |
| `pol` + `eng` `.traineddata.gz` | `@tesseract.js-data` (jsDelivr) | 5,3 MB |

Worker i rdzeń idą z `node_modules`, nie z sieci — dzięki temu ich wersja
zawsze zgadza się z zainstalowaną biblioteką. Po podbiciu `tesseract.js`
trzeba skrypt uruchomić ponownie, inaczej worker zostanie na starej wersji.

Wariantów rdzenia są trzy, bo worker wybiera go dopiero w przeglądarce, po
wykryciu relaxed SIMD / SIMD / braku obu. Wszystkie są w odmianie `-lstm`:
`createWorker(lang, 1, …)` to OEM 1, czyli wyłącznie model LSTM — warianty
z modelem Legacy nie zostaną użyte i nie ma powodu ich wozić.

Fallbacku na CDN nie ma: w tesseract.js `langPath` i `corePath` wchodzą
w miejsce adresu CDN, a nie obok niego. Zła ścieżka nie powoduje cichego
sięgnięcia do sieci — worker po prostu nie wstaje.

### TXT / MD
Kolejność rozpoznawania kodowania: BOM → UTF-8 → ocena wiarygodności kandydatów
(`cp1250`, `iso-8859-2`, `cp1252`, `cp852`) → detektor ogólny → błąd.

Ocena jest świadoma języka: punktuje polskie znaki diakrytyczne i karze znaki
spoza repertuaru prozy. Powód — samo próbowanie kodowań po kolei nie działa,
bo `cp1250` jest jednobajtowe i praktycznie nigdy nie zgłasza błędu, więc plik
w `iso-8859-2` stawał się cicho mojibake. Detektory ogólnego przeznaczenia też
nie wystarczają: dla polskiego zdania wskazują `cp1257` albo `iso8859-10`.
Gdy żaden kandydat nie wygląda sensownie, konwersja **kończy się błędem**
zamiast wpuszczać uszkodzony tekst do bazy.

## Wysyłka partiami

`/api/convert` przerabia wszystko, co dostał, i odpowiada dopiero na końcu.
Przy jednym żądaniu na cały batch oznaczało to, że przy trzydziestu
dokumentach biurowych wskaźnik postępu stał na zerze przez kilka minut —
konwersja szła poprawnie, ale wyglądała na zawieszoną. Dla toru A, czyli
głównego zastosowania aplikacji, licznik nie ruszał się ani razu.

Frontend dzieli więc pliki na partie po **cztery**, dodatkowo ograniczone
łącznym rozmiarem (połowa `MAX_BATCH_MB`, żeby pojedyncza partia nigdy nie
dotknęła limitu serwera). Plik większy od tego zapasu jedzie sam.

Konsekwencje, wszystkie zamierzone:

- pasek postępu przesuwa się po każdej partii, a nie raz na końcu,
- wyniki pojawiają się na bieżąco — pierwsze pliki można podejrzeć, zanim
  reszta się skończy,
- **błąd partii nie przekreśla batcha**: pliki z nieudanego żądania dostają
  status błędu, pozostałe konwertują się dalej,
- łączny rozmiar zadania może przekroczyć `MAX_BATCH_MB`, bo limit obowiązuje
  per żądanie. Duży batch daje ostrzeżenie o czasie trwania, nie odmowę.

Czas konwersji to koszt parserów, nie narzut aplikacji — `pymupdf4llm` ciągnie
`pymupdf_layout` i `onnxruntime`, które analizują układ każdej strony.
Podział na partie tego nie skraca; sprawia tylko, że widać postęp.

Progresu **wewnątrz** jednej partii nie ma i bez zmiany API nie będzie —
wymagałby strumieniowania odpowiedzi albo osobnego kanału na zdarzenia.

## Bezpieczeństwo i prywatność

**Klucz API.** Jest przechowywany w `localStorage` przeglądarki i **przesyłany
do backendu przy każdym żądaniu** — inaczej serwer nie mógłby wywołać modelu.
Backend używa go wyłącznie w obrębie żądania: nie zapisuje go, nie loguje
i nie cache'uje. Twierdzenie „klucz nie opuszcza przeglądarki" byłoby nieprawdziwe.
Przechowywanie w `localStorage` oznacza też, że klucz jest dostępny dla kodu
JavaScript na tej stronie.

**Endpoint AI od klienta.** Pole `ai_base_url` pochodzi od użytkownika, więc
przed każdym żądaniem wychodzącym przechodzi walidację
([`net_guard.py`](backend/app/converters/net_guard.py)): dozwolone tylko `http`
i `https`, sprawdzane są **wszystkie** rekordy DNS hosta, a adresy link-local
i metadanych chmury (`169.254.0.0/16`, `fe80::/10`, CGNAT) są blokowane zawsze.
Bez tego backend byłby proxy do sieci wewnętrznej.

**CORS.** Lista originów pochodzi z konfiguracji; `allow_credentials` jest
wyłączone, bo aplikacja nie używa sesji ani ciasteczek.

## Uruchomienie — lokalnie

### Backend (FastAPI)
```bash
python -m venv .venv
.venv\Scripts\activate            # Windows (PowerShell: .venv\Scripts\Activate.ps1)
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --port 8000
```

> `pymupdf4llm` pociąga `pymupdf_layout`, a ten `onnxruntime`, `numpy`
> i `networkx` — razem około **90 MB** ponad samo PyMuPDF. To zależność twarda,
> istotna przy rozmiarze obrazu Dockera.

### Frontend (React + Vite)
```bash
cd frontend
npm install
npm run ocr:assets # jednorazowo — zasoby OCR do public/ (ok. 17 MB)
npm run dev        # http://localhost:5173
```

Adres backendu bierze się z `VITE_API_BASE`, a gdy zmiennej nie ma —
z `http://localhost:8000/api`. Domyślny przypadek nie wymaga więc żadnej
konfiguracji. Vite podstawia tę wartość **w czasie budowania**, nie startu,
więc po zmianie `.env` trzeba przebudować frontend (wzór:
[`frontend/.env.example`](frontend/.env.example)).

## Uruchomienie — Docker
```bash
docker compose up --build
```
Backend: `http://localhost:8000` · Frontend: `http://localhost:5173`

> Obecna konfiguracja Dockera jest **deweloperska**: `--reload`, montowanie
> katalogu projektu jako wolumenu i użytkownik root. Nie nadaje się w tej
> postaci na wdrożenie produkcyjne.

## Testy
```bash
pytest backend/tests -q
```
- [`test_converters.py`](backend/tests/test_converters.py) — tory konwersji,
  w tym regresje kolejności czytania w PDF i rozpoznawania kodowania.
- [`test_postprocess.py`](backend/tests/test_postprocess.py) — żywa pagina,
  front-matter, łączenie stron.
- [`test_net_guard.py`](backend/tests/test_net_guard.py) — walidacja adresów
  wychodzących.

## Limity (konfigurowalne w `.env`)
- Maks. **50** plików na batch
- Maks. **25 MB** na plik, **100 MB** na jedno żądanie

Limity są egzekwowane przez backend i wystawiane w `/api/health` — frontend
je stamtąd czyta, zamiast trzymać własną kopię.

Ograniczenie **100 MB dotyczy pojedynczego żądania**, nie tego, co użytkownik
wrzuci na listę. Frontend dzieli wysyłkę na partie (patrz
[Wysyłka partiami](#wysyłka-partiami)), więc łączny rozmiar zadania może być
większy. Do limitu nie wliczają się też skany czytane w przeglądarce — te
nigdy nie trafiają na serwer.

## Wdrożenie publiczne — wymagane ustawienia
Domyślna konfiguracja zakłada, że backend działa na maszynie użytkownika.
Przed wystawieniem go do sieci ustaw w `.env`:
- `ALLOWED_ORIGINS` — konkretne originy frontendu (domyślnie `localhost:5173`).
- `ALLOW_PRIVATE_AI_ENDPOINTS=false` — blokuje wskazywanie przez klienta
  endpointów AI w sieci prywatnej. Wyłącza to tryb **Lokalne** (Ollama na
  loopbacku), który ma sens wyłącznie przy backendzie uruchomionym lokalnie.

Po stronie frontendu ustaw `VITE_API_BASE` na publiczny adres backendu
i przebuduj — domyślny `localhost:8000` wskazuje na maszynę odwiedzającego,
nie na serwer.

## API

### `GET /api/health`
Status usługi wraz z obowiązującymi limitami:

```json
{
  "status": "ok",
  "project": "<nazwa z konfiguracji>",
  "limits": { "max_files": 50, "max_upload_mb": 25, "max_batch_mb": 100 }
}
```

Frontend czyta stąd limity zamiast trzymać własną kopię. Wcześniej `MAX_FILES`
był zapisany po obu stronach i przy zmianie jednej z nich użytkownik dostawał
albo martwy limit w UI, albo odrzucenie batcha dopiero po wysłaniu plików.

### `POST /api/convert`
Multipart. Zwraca obiekt `{"results": [...]}` — jeden wpis na plik.

| pole | domyślnie | opis |
|---|---|---|
| `files[]` | — | pliki do konwersji |
| `ai_mode` | `off` | `off` \| `cloud` \| `local` |
| `ai_provider` | `gemini` | `gemini` \| `anthropic` \| `openai` |
| `ai_api_key` | `""` | klucz dostawcy chmurowego |
| `ai_base_url` | `""` | endpoint zgodny z OpenAI (walidowany) |
| `ai_model` | `""` | model wizyjny |
| `ocr_lang` | `pol+eng` | język OCR |
| `rag_mode` | `false` | układ wyjścia pod chunking |

Wpis w `results`: `filename`, `markdown_filename`, `status`, `track`,
`markdown`, `used_ai`, `client_ocr`, `ocr_confidence`, `warning`, `error`.

`client_ocr: true` oznacza, że serwer nie wykonał OCR — odczyt ma zrobić
przeglądarka.

Błąd pojedynczego pliku (np. przekroczony limit rozmiaru) nie przerywa batcha:
wpis dostaje `status: "error"` i wypełnione `error`, reszta konwertuje się
normalnie. Całe żądanie kończy się natomiast kodem `400`, gdy plików jest
więcej niż `MAX_FILES` albo ich łączny rozmiar przekracza `MAX_BATCH_MB`.
Brak samego pola `files` daje `422` z walidacji FastAPI — pole jest wymagane,
więc żądanie nie dociera do kontroli w handlerze.

Endpoint przerabia wszystko, co dostał, i odpowiada dopiero na końcu. Nie ma
strumieniowania ani postępu per plik — stąd podział wysyłki po stronie
frontendu.

> `ocr_lang` jest po stronie serwera nieaktywne — OCR językowy wykonuje
> przeglądarka, która czyta to ustawienie lokalnie. `ocr_confidence` jest
> wypełniane wyłącznie na ścieżce OCR w przeglądarce; przy OCR przez model AI
> pozostaje `null`, bo dostawcy nie zwracają miary pewności.

### `POST /api/convert/zip`
JSON `{items:[{filename, content}]}` → paczka ZIP z gotowych plików `.md`
(bez ponownej konwersji), jako `markdox_export.zip`. Rozszerzenie `.md` jest
dopisywane, gdy brakuje, a powtórzone nazwy dostają przyrostek `_1`, `_2` —
inaczej drugi plik nadpisywałby pierwszy w archiwum. Pusta lista → `400`.

## Struktura projektu

```
backend/app/
  config.py              ustawienia (limity, CORS, polityka endpointów AI)
  routes/convert.py      endpointy /api/convert i /api/convert/zip
  converters/
    detect.py            wybór toru A/B na podstawie typu i warstwy tekstowej
    service.py           orkiestracja: jeden plik → jeden wynik
    track_a.py           docx, pptx, pdf-tekst, txt/md
    track_b.py           rasteryzacja skanów pod OCR przez AI
    ai_ocr.py            klienci Gemini / Anthropic / OpenAI-compatible
    net_guard.py         walidacja adresów wychodzących (SSRF)
    postprocess.py       żywa pagina, front-matter, łączenie stron
frontend/src/
  App.tsx                interfejs w stylu Norton Commandera
  ocrClient.ts           OCR w przeglądarce (tesseract.js + pdf.js)
  scripts/fetch-ocr-assets.mjs  pobranie workera, rdzenia WASM i modeli OCR
  public/tesseract/             te zasoby, serwowane z własnego origin
```

## Licencja

MIT — patrz [`LICENSE`](LICENSE).
