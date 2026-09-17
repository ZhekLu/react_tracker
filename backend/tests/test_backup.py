from __future__ import annotations

import sqlite3
from contextlib import closing
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
    with pytest.raises(FileExistsError):
        backup_database(destination)
    with sqlite3.connect(destination) as connection:
        migration_count = connection.execute(
            "SELECT COUNT(*) FROM schema_migrations",
        ).fetchone()
    assert migration_count is not None
    assert migration_count[0] > 0

    get_engine().dispose()
    get_engine.cache_clear()
    get_settings.cache_clear()


def test_backup_of_checkpointed_wal_database_without_sidecars(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = tmp_path / "checkpointed.db"
    # A SQLite backup carries the WAL header but has no WAL sidecars yet.
    with closing(sqlite3.connect(tmp_path / "source.db")) as source:
        source.execute("PRAGMA journal_mode=WAL")
        source.execute("CREATE TABLE sample (value TEXT)")
        source.execute("INSERT INTO sample VALUES ('keep me')")
        source.commit()
        with closing(sqlite3.connect(path)) as target:
            source.backup(target)
    assert not Path(str(path) + "-wal").exists()
    monkeypatch.setenv("TRACKER_DATABASE_PATH", str(path))
    get_settings.cache_clear()
    try:
        destination = backup_database(tmp_path / "copy.db")
        with closing(sqlite3.connect(destination)) as db:
            assert db.execute("SELECT value FROM sample").fetchone() == ("keep me",)
    finally:
        get_settings.cache_clear()
