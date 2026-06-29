from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_ROOT.parent
DATA_DIR = PROJECT_ROOT / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_ROOT / ".env",
        env_prefix="TRACKER_",
        extra="ignore",
    )

    app_name: str = "Study Tracker API"
    host: str = "127.0.0.1"
    port: int = 8787
    database_path: Path = Field(default=DATA_DIR / "tracker_v2.db")
    frontend_origin: str = "http://127.0.0.1:5174"

    @property
    def database_url(self) -> str:
        return f"sqlite+pysqlite:///{self.database_path}"


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.database_path.parent.mkdir(parents=True, exist_ok=True)
    return settings
