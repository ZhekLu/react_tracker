from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest

from tracker_api.config import get_settings
from tracker_api.services.lecture_note_image_service import (
    LectureNoteImageError,
    recent_maccy_images,
)


@pytest.fixture(autouse=True)
def clear_settings_cache() -> Iterator[None]:
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _create_maccy_database(path: Path) -> None:
    with sqlite3.connect(path) as connection:
        connection.executescript(
            """
            CREATE TABLE ZHISTORYITEM (
              Z_PK INTEGER PRIMARY KEY,
              ZLASTCOPIEDAT REAL NOT NULL
            );
            CREATE TABLE ZHISTORYITEMCONTENT (
              Z_PK INTEGER PRIMARY KEY,
              ZITEM INTEGER NOT NULL,
              ZTYPE TEXT NOT NULL,
              ZVALUE BLOB
            );
            """
        )
        connection.executemany(
            "INSERT INTO ZHISTORYITEM (Z_PK, ZLASTCOPIEDAT) VALUES (?, ?)",
            [(1, 100.0), (2, 300.0), (3, 200.0), (4, 400.0)],
        )
        connection.executemany(
            """
            INSERT INTO ZHISTORYITEMCONTENT (Z_PK, ZITEM, ZTYPE, ZVALUE)
            VALUES (?, ?, ?, ?)
            """,
            [
                (1, 1, "public.jpeg", b"older-jpeg"),
                (2, 2, "public.tiff", b"newest-tiff-fallback"),
                (3, 2, "public.png", b"newest-png"),
                (4, 3, "public.heic", b"middle-heic"),
                (5, 4, "public.utf8-plain-text", b"not-an-image"),
            ],
        )


def test_recent_maccy_images_returns_one_preferred_image_per_history_item(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_path = tmp_path / "Application Support" / "Storage.sqlite"
    database_path.parent.mkdir()
    _create_maccy_database(database_path)
    monkeypatch.setenv("TRACKER_MACCY_DATABASE_PATH", str(database_path))
    get_settings.cache_clear()

    assert recent_maccy_images(2) == [b"newest-png", b"middle-heic"]
    assert recent_maccy_images(10) == [
        b"newest-png",
        b"middle-heic",
        b"older-jpeg",
    ]


def test_recent_maccy_images_reports_missing_history(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TRACKER_MACCY_DATABASE_PATH", str(tmp_path / "missing.sqlite"))
    get_settings.cache_clear()

    with pytest.raises(LectureNoteImageError, match="Maccy history was not found"):
        recent_maccy_images(5)
