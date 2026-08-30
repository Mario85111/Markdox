"""Endpointy konwersji. Bezstanowe — nic nie jest zapisywane na serwerze."""
import io
import zipfile

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from backend.app.config import settings
from backend.app.converters.service import convert_file
from backend.app.schemas import ConvertResponse, ZipRequest

router = APIRouter(tags=["convert"])


@router.post("/convert", response_model=ConvertResponse)
async def convert(
    files: list[UploadFile] = File(...),
    ai_mode: str = Form("off"),          # "off" | "cloud" | "local"
    ai_provider: str = Form("gemini"),   # "gemini" | "openai"
    ai_api_key: str = Form(""),
    ai_base_url: str = Form(""),
    ai_model: str = Form(""),
    ocr_lang: str = Form(""),
    rag_mode: bool = Form(False),   # układ wyjścia pod chunking w RAG
):
    if not files:
        raise HTTPException(status_code=400, detail="Nie przesłano żadnych plików.")
    if len(files) > settings.MAX_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"Maksymalnie {settings.MAX_FILES} plików na jeden raz.",
        )

    # tryb "cloud"/"local" włącza AI; "off" pozostaje offline
    effective_ai_mode = "off" if ai_mode == "off" else "on"
    options = {
        "ai_mode": effective_ai_mode,
        "ai_provider": ai_provider,
        "ai_api_key": ai_api_key,
        "ai_base_url": ai_base_url,
        "ai_model": ai_model,
        "ocr_lang": ocr_lang or settings.DEFAULT_OCR_LANG,
        "ocr_threshold": settings.OCR_CONF_THRESHOLD,
        "rag_mode": rag_mode,
    }

    results = []
    total_bytes = 0
    for f in files:
        data = await f.read()
        total_bytes += len(data)

        if len(data) > settings.MAX_UPLOAD_MB * 1024 * 1024:
            results.append({
                "filename": f.filename,
                "markdown_filename": (f.filename or "plik") + ".md",
                "status": "error", "track": "?", "markdown": None,
                "used_ai": False, "ocr_confidence": None, "warning": None,
                "error": f"Plik przekracza limit {settings.MAX_UPLOAD_MB} MB.",
            })
            continue
        if total_bytes > settings.MAX_BATCH_MB * 1024 * 1024:
            raise HTTPException(
                status_code=400,
                detail=f"Łączny rozmiar batcha przekracza {settings.MAX_BATCH_MB} MB.",
            )

        results.append(convert_file(data, f.filename or "plik", options))

    return {"results": results}


@router.post("/convert/zip")
def convert_zip(req: ZipRequest):
    """Pakuje już przekonwertowane pliki .md w jeden ZIP (bez ponownej konwersji)."""
    if not req.items:
        raise HTTPException(status_code=400, detail="Brak plików do spakowania.")

    buf = io.BytesIO()
    used_names: dict[str, int] = {}
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for item in req.items:
            name = item.filename or "dokument.md"
            if not name.lower().endswith(".md"):
                name += ".md"
            if name in used_names:
                used_names[name] += 1
                name = f"{name[:-3]}_{used_names[name]}.md"
            else:
                used_names[name] = 0
            zf.writestr(name, item.content or "")

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="markdox_export.zip"'},
    )
