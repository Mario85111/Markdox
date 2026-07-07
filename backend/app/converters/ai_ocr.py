"""Warstwa AI dla toru B — multi-provider OCR z obrazu do Markdown.

Obsługiwane:
- "gemini"    → google-genai (chmura)
- "anthropic" → Claude przez oficjalny SDK `anthropic` (chmura)
- "openai"    → dowolny endpoint zgodny z OpenAI (chmura OpenAI lub lokalny,
                np. Ollama / LM Studio) przez pole base_url.

Każdy dostawca ma inny protokół sieciowy — sam klucz API nie wystarczy,
kod musi wiedzieć, którym providerem mówić.

Klucz API i konfiguracja przychodzą per-request (options) — nic nie jest
zapisywane po stronie serwera.
"""
import base64
import io

import httpx

OCR_PROMPT = (
    "Wyodrębnij CAŁY tekst z tego obrazu i sformatuj go jako czysty Markdown. "
    "Zachowaj strukturę: nagłówki, listy oraz tabele (tabele w składni GFM). "
    "Zwróć wyłącznie Markdown — bez komentarzy, bez wyjaśnień, bez otaczających ``` ."
)


def _img_to_png_bytes(img) -> bytes:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return buf.getvalue()


def ai_ocr_image(img, options: dict) -> str:
    provider = (options.get("ai_provider") or "gemini").lower()
    if provider == "gemini":
        return _gemini_ocr(img, options)
    if provider == "anthropic":
        return _anthropic_ocr(img, options)
    # openai + lokalny endpoint dzielą ten sam protokół
    return _openai_compatible_ocr(img, options)


def _anthropic_ocr(img, options: dict) -> str:
    import anthropic

    api_key = options.get("ai_api_key") or ""
    if not api_key:
        raise RuntimeError("Brak klucza API Anthropic.")
    model = options.get("ai_model") or "claude-haiku-4-5"
    client = anthropic.Anthropic(api_key=api_key)
    b64 = base64.b64encode(_img_to_png_bytes(img)).decode()
    message = client.messages.create(
        model=model,
        max_tokens=8192,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "image",
                     "source": {"type": "base64", "media_type": "image/png", "data": b64}},
                    {"type": "text", "text": OCR_PROMPT},
                ],
            }
        ],
    )
    return "".join(b.text for b in message.content if b.type == "text").strip()


def _gemini_ocr(img, options: dict) -> str:
    from google import genai
    from google.genai import types

    api_key = options.get("ai_api_key") or ""
    if not api_key:
        raise RuntimeError("Brak klucza API Gemini.")
    model = options.get("ai_model") or "gemini-2.5-flash"
    client = genai.Client(api_key=api_key)
    png = _img_to_png_bytes(img)
    resp = client.models.generate_content(
        model=model,
        contents=[
            types.Part.from_bytes(data=png, mime_type="image/png"),
            OCR_PROMPT,
        ],
    )
    return (resp.text or "").strip()


def _openai_compatible_ocr(img, options: dict) -> str:
    base_url = (options.get("ai_base_url") or "https://api.openai.com/v1").rstrip("/")
    api_key = options.get("ai_api_key") or ""
    model = options.get("ai_model") or "gpt-4o-mini"
    png = _img_to_png_bytes(img)
    b64 = base64.b64encode(png).decode()

    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": OCR_PROMPT},
                    {"type": "image_url",
                     "image_url": {"url": f"data:image/png;base64,{b64}"}},
                ],
            }
        ],
        "temperature": 0,
    }
    with httpx.Client(timeout=180) as client:
        r = client.post(base_url + "/chat/completions", headers=headers, json=payload)
        r.raise_for_status()
        data = r.json()
    return (data["choices"][0]["message"]["content"] or "").strip()
