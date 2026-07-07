FROM python:3.12-slim

WORKDIR /app

# Brak natywnych zależności — OCR bez AI wykonuje przeglądarka (tesseract.js).
# AI OCR (opcjonalne) rasteryzuje PDF przez PyMuPDF (czysty Python).

COPY requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r ./backend/requirements.txt

COPY . .

CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
