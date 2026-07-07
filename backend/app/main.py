from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app.config import settings
from backend.app.routes import convert

app = FastAPI(title=settings.PROJECT_NAME)

# CORS — na czas developmentu zezwalamy na wszystko.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(convert.router, prefix="/api")


@app.get("/api/health")
def health_check():
    return {"status": "ok", "project": settings.PROJECT_NAME}
