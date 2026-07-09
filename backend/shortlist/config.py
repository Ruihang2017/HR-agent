from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SHORTLIST_", env_file=".env", extra="ignore")

    # Standard OpenAI key. The explicit alias bypasses the SHORTLIST_ prefix, and
    # pydantic-settings also reads it from backend/.env — so no shell export needed.
    openai_api_key: str | None = Field(default=None, validation_alias="OPENAI_API_KEY")
    db_path: str = "shortlist.db"
    data_dir: Path = Path(__file__).resolve().parents[2] / "data"
    model_fast: str = "gpt-4o-mini"
    model_strong: str = "gpt-4o"
    max_intake_questions: int = 5


settings = Settings()

# PRD cost envelope: cheap model on parsing/redaction, strong model on generation/scoring.
STAGE_MODELS: dict[str, str] = {
    "parse": settings.model_fast,
    "redact": settings.model_fast,
    "intake": settings.model_strong,
    "jd_gen": settings.model_strong,
    "lint": settings.model_strong,
    "score": settings.model_strong,
    "kit_gen": settings.model_strong,
    "question_filter": settings.model_strong,
}
