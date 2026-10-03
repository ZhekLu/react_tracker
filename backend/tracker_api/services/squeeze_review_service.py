"""User-selected parsing examples and labels; independent of study documents."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from collections.abc import Iterator
from contextlib import closing, contextmanager
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..config import get_settings
from . import insert_debug_service


class NewReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    course_id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=160)
    raw: str = Field(min_length=1, max_length=250_000)

    @field_validator("raw", "title")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Supply non-empty text.")
        return value


class SaveReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=1)
    state: dict[str, Any]
    markdown: str = Field(max_length=250_000)

    @field_validator("state")
    @classmethod
    def bounded_state(cls, value: dict[str, Any]) -> dict[str, Any]:
        if len(json.dumps(value).encode()) > 3_000_000:
            raise ValueError("Review history is too large; export it before continuing.")
        return value


@contextmanager
def _database() -> Iterator[sqlite3.Connection]:
    path = get_settings().database_path.with_suffix(".squeeze-review.sqlite")
    path.touch(mode=0o600, exist_ok=True)
    with closing(sqlite3.connect(path, timeout=10)) as db, db:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA secure_delete = ON")
        db.execute("PRAGMA journal_mode = DELETE")
        db.execute("""CREATE TABLE IF NOT EXISTS reviews (
            id TEXT PRIMARY KEY, course_id TEXT NOT NULL, title TEXT NOT NULL,
            source TEXT NOT NULL, source_hash TEXT NOT NULL, raw TEXT NOT NULL,
            state TEXT, markdown TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            UNIQUE(course_id, source_hash)
        )""")
        yield db


def _decode(row: sqlite3.Row) -> dict[str, Any]:
    return {**dict(row), "state": json.loads(row["state"]) if row["state"] else None}


def create_review(command: NewReview, source: str = "Historical raw response") -> dict[str, Any]:
    digest = hashlib.sha256(command.raw.encode()).hexdigest()
    now = datetime.now(UTC).isoformat()
    with _database() as db:
        db.execute(
            """INSERT INTO reviews
            (id, course_id, title, source, source_hash, raw, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(course_id, source_hash) DO NOTHING""",
            (
                str(uuid.uuid4()),
                command.course_id,
                command.title,
                source,
                digest,
                command.raw,
                now,
                now,
            ),
        )
        row = db.execute(
            "SELECT * FROM reviews WHERE course_id = ? AND source_hash = ?",
            (command.course_id, digest),
        ).fetchone()
        return _decode(row)


def list_reviews(course_id: str) -> list[dict[str, Any]]:
    with _database() as db:
        return [
            dict(row)
            for row in db.execute(
                """SELECT id, title, source, revision, created_at, updated_at,
            length(raw) AS raw_length FROM reviews WHERE course_id = ?
            ORDER BY created_at DESC, rowid DESC""",
                (course_id,),
            )
        ]


def load_recent(course_id: str) -> list[dict[str, Any]]:
    # Paste snapshots retain the true pre-parser input. Saved documents do not.
    # Never mislabel a saved/edited response as historical raw text.
    with insert_debug_service._database() as db:
        rows = db.execute(
            """SELECT created_at, source, json_extract(payload, '$.input') AS raw
            FROM inserts WHERE course_id = ? AND source NOT LIKE 'Save %'
            AND length(json_extract(payload, '$.input')) >= 300
            ORDER BY created_at DESC, rowid DESC LIMIT 100""",
            (course_id,),
        ).fetchall()
    seen: set[str] = set()
    selected: list[sqlite3.Row] = []
    for row in rows:
        if row["raw"] in seen:
            continue
        seen.add(row["raw"])
        selected.append(row)
        if len(seen) == 3:
            break
    # Insert older examples first so the newest raw response opens first.
    for row in reversed(selected):
        create_review(
            NewReview(
                course_id=course_id, title=f"Raw paste · {row['created_at'][:16]}", raw=row["raw"]
            ),
            source=f"{row['source']} · {row['created_at']}",
        )
    return list_reviews(course_id)


def get_review(review_id: str) -> dict[str, Any]:
    with _database() as db:
        row = db.execute("SELECT * FROM reviews WHERE id = ?", (review_id,)).fetchone()
        if row is None:
            raise LookupError("Review example was not found.")
        return _decode(row)


def save_review(review_id: str, command: SaveReview) -> dict[str, Any]:
    with _database() as db:
        result = db.execute(
            """UPDATE reviews SET state = ?, markdown = ?, revision = revision + 1,
            updated_at = ? WHERE id = ? AND revision = ?""",
            (
                json.dumps(command.state),
                command.markdown,
                datetime.now(UTC).isoformat(),
                review_id,
                command.revision,
            ),
        )
        if not result.rowcount:
            if db.execute("SELECT 1 FROM reviews WHERE id = ?", (review_id,)).fetchone() is None:
                raise LookupError("Review example was not found.")
            raise ValueError(
                "This review changed in another tab. Export your draft, then reload it."
            )
        return _decode(db.execute("SELECT * FROM reviews WHERE id = ?", (review_id,)).fetchone())


def export_reviews(course_id: str) -> dict[str, Any]:
    with _database() as db:
        return {
            "format": "tracker-squeeze-reviews-v1",
            "course_id": course_id,
            "reviews": [
                _decode(row)
                for row in db.execute(
                    "SELECT * FROM reviews WHERE course_id = ? ORDER BY created_at",
                    (course_id,),
                )
            ],
        }
