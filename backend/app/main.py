from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.config import settings
from backend.app.routes import convert

app = FastAPI(title=settings.PROJECT_NAME)

# CORS — lista originów z konfiguracji. Aplikacja nie używa ciasteczek ani sesji,
# więc allow_credentials pozostaje wyłączone.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

app.include_router(convert.router, prefix="/api")


@app.get("/api/health")
def health_check():
    # Limity wychodzą stąd, żeby frontend nie trzymał własnej kopii. Wcześniej
    # MAX_FILES był zapisany po obu stronach i przy zmianie jednej z nich
    # użytkownik albo dostawał martwy limit w UI, albo odrzucenie batcha
    # dopiero po wysłaniu plików.
    return {
        "status": "ok",
        "project": settings.PROJECT_NAME,
        "limits": {
            "max_files": settings.MAX_FILES,
            "max_upload_mb": settings.MAX_UPLOAD_MB,
            "max_batch_mb": settings.MAX_BATCH_MB,
        },
    }
