from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_ROOT.parent
DATA_DIR = PROJECT_ROOT / "data"
TRACKER_ROOT = PROJECT_ROOT.parent


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
    helper_config_path: Path = Field(default=TRACKER_ROOT / "toggl_config.json")
    helper_state_path: Path = Field(default=TRACKER_ROOT / "toggl_state.json")
    drawboard_state_path: Path = Field(default=TRACKER_ROOT / "drawboard_state.json")
    frontend_dist_path: Path = Field(default=PROJECT_ROOT / "frontend" / "dist")

    @property
    def database_url(self) -> str:
        return f"sqlite+pysqlite:///{self.database_path}"


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.database_path.parent.mkdir(parents=True, exist_ok=True)
    return settings
