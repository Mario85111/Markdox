from pydantic import BaseModel


class ConvertResult(BaseModel):
    filename: str
    markdown_filename: str
    status: str  # "ok" | "error"
    track: str   # "A" | "B" | "?"
    markdown: str | None = None
    used_ai: bool = False
    client_ocr: bool = False
    ocr_confidence: float | None = None
    warning: str | None = None
    error: str | None = None


class ConvertResponse(BaseModel):
    results: list[ConvertResult]


class ZipItem(BaseModel):
    filename: str
    content: str


class ZipRequest(BaseModel):
    items: list[ZipItem]
