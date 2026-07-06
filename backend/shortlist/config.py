from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SHORTLIST_", env_file=".env", extra="ignore")

    db_path: str = "shortlist.db"
    data_dir: Path = Path(__file__).resolve().parents[2] / "data"
    model_fast: str = "claude-haiku-4-5"
    model_strong: str = "claude-opus-4-8"
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
