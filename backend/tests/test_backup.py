from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from tracker_api.backup import backup_database
from tracker_api.config import get_settings
from tracker_api.database import get_engine
from tracker_api.migrations.runner import run_migrations


def test_backup_database_copies_a_consistent_sqlite_database(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_path = tmp_path / "tracker.db"
    monkeypatch.setenv("TRACKER_DATABASE_PATH", str(database_path))
    get_settings.cache_clear()
    get_engine.cache_clear()
    run_migrations()

    destination = backup_database(tmp_path / "backup" / "tracker-copy.db")

    assert destination.exists()
    with sqlite3.connect(destination) as connection:
        migration_count = connection.execute(
            "SELECT COUNT(*) FROM schema_migrations",
        ).fetchone()
    assert migration_count is not None
    assert migration_count[0] > 0

    get_engine().dispose()
    get_engine.cache_clear()
    get_settings.cache_clear()
