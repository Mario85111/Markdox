from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    PROJECT_NAME: str = "Markdox — Konwerter do Markdown"

    # Limity (konfigurowalne przez .env) — zgodne z briefem
    MAX_FILES: int = 10            # maks. plików na jeden batch
    MAX_UPLOAD_MB: int = 25        # maks. rozmiar pojedynczego pliku
    MAX_BATCH_MB: int = 100        # maks. łączny rozmiar batcha

    # OCR (tor B)
    DEFAULT_OCR_LANG: str = "pol+eng"
    OCR_CONF_THRESHOLD: float = 70.0  # poniżej tej pewności próbujemy dopalić AI

    class Config:
        env_file = ".env"
        extra = "ignore"  # tolerujemy nadmiarowe zmienne w .env


settings = Settings()
