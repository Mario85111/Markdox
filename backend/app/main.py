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
    return {"status": "ok", "project": settings.PROJECT_NAME}
