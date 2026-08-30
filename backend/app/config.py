from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    PROJECT_NAME: str = "Markdox — Konwerter do Markdown"

    # Limity (konfigurowalne przez .env) — zgodne z briefem
    MAX_FILES: int = 10            # maks. plików na jeden batch
    MAX_UPLOAD_MB: int = 25        # maks. rozmiar pojedynczego pliku
    MAX_BATCH_MB: int = 100        # maks. łączny rozmiar batcha

    # CORS — konkretne originy frontendu. "*" tylko na czas developmentu.
    ALLOWED_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Czy endpoint AI podany przez klienta może wskazywać na sieć prywatną.
    # True jest bezpieczne tylko gdy backend działa na maszynie użytkownika
    # (tryb "Lokalne" = Ollama na loopbacku). Przy wdrożeniu publicznym: false.
    ALLOW_PRIVATE_AI_ENDPOINTS: bool = True

    # OCR (tor B)
    DEFAULT_OCR_LANG: str = "pol+eng"
    OCR_CONF_THRESHOLD: float = 70.0  # poniżej tej pewności próbujemy dopalić AI

    class Config:
        env_file = ".env"
        extra = "ignore"  # tolerujemy nadmiarowe zmienne w .env


    @property
    def allowed_origins_list(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]


settings = Settings()
