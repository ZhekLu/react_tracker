"""Bounded, disposable editor diagnostics, deliberately outside study backups."""

from __future__ import annotations

import json
import sqlite3
import uuid
from collections.abc import Iterator
from contextlib import closing, contextmanager
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from ..config import get_settings

RETENTION_DAYS = 7
MAX_RECORDS = 500
MAX_PAYLOAD_BYTES = 20_000_000


class InsertRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: uuid.UUID
    source: str = Field(max_length=160)
    course_id: str = Field(default="", max_length=80)
    location: str = Field(default="", max_length=500)
    input: str = Field(max_length=250_000)
    parsed: str = Field(max_length=250_000)
    serialized: str = Field(max_length=250_000)
    reopened: str = Field(max_length=250_000)
    checks: list[str] = Field(max_length=20)
    parser_version: str = Field(max_length=80)
    outcome: str = Field(default="preview", max_length=80)


class ReviewRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["pending", "incorrect", "improvement"]
    feedback: str = Field(default="", max_length=2000)


class DebugFixture(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=120)
    kind: Literal["paste", "roundtrip"]
    input: str = Field(min_length=1, max_length=3000)
    expected: str = Field(min_length=1, max_length=3000)


class CompleteReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fixture: DebugFixture | None = None


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _prune(db: sqlite3.Connection) -> None:
    cutoff = (datetime.now(UTC) - timedelta(days=RETENTION_DAYS)).isoformat()
    db.execute("DELETE FROM inserts WHERE created_at < ?", (cutoff,))
    db.execute(
        """DELETE FROM inserts WHERE id IN (
        SELECT id FROM inserts ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?
    )""",
        (MAX_RECORDS,),
    )
    total = db.execute(
        "SELECT COALESCE(SUM(length(CAST(payload AS BLOB))), 0) FROM inserts"
    ).fetchone()[0]
    while total > MAX_PAYLOAD_BYTES:
        row = db.execute(
            "SELECT id, length(CAST(payload AS BLOB)) FROM inserts "
            "ORDER BY created_at, rowid LIMIT 1"
        ).fetchone()
        db.execute("DELETE FROM inserts WHERE id = ?", (row[0],))
        total -= row[1]


@contextmanager
def _database() -> Iterator[sqlite3.Connection]:
    path = get_settings().database_path.with_suffix(".editor-debug.sqlite")
    path.touch(mode=0o600, exist_ok=True)
    with closing(sqlite3.connect(path, timeout=10)) as db, db:
        db.row_factory = sqlite3.Row
        # No WAL containing deleted responses; removed cells are overwritten.
        db.execute("PRAGMA secure_delete = ON")
        db.execute("PRAGMA journal_mode = DELETE")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS inserts (
                id TEXT PRIMARY KEY, created_at TEXT NOT NULL, course_id TEXT NOT NULL,
                source TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
                feedback TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS fixtures (
                id TEXT PRIMARY KEY, created_at TEXT NOT NULL, payload TEXT NOT NULL
            );
        """)
        _prune(db)
        yield db


def cleanup() -> None:
    with _database():
        pass


def create_record(record: InsertRecord) -> dict[str, str]:
    with _database() as db:
        db.execute(
            """INSERT INTO inserts (id, created_at, course_id, source, payload)
            VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING""",
            (str(record.id), _now(), record.course_id, record.source, record.model_dump_json()),
        )
        _prune(db)
    return {"id": str(record.id)}


def list_records(course_id: str, start: datetime, end: datetime) -> dict[str, Any]:
    if start.tzinfo is None or end.tzinfo is None or end <= start:
        raise ValueError("Supply an increasing date range with a timezone.")
    with _database() as db:
        rows = db.execute(
            """SELECT id, created_at, source, status, feedback,
            json_extract(payload, '$.checks') AS checks,
            json_extract(payload, '$.outcome') AS outcome
            FROM inserts WHERE course_id = ? AND created_at >= ? AND created_at < ?
            ORDER BY created_at DESC, rowid DESC""",
            (course_id, start.astimezone(UTC).isoformat(), end.astimezone(UTC).isoformat()),
        ).fetchall()
        count = db.execute(
            "SELECT count(*) FROM inserts WHERE course_id = ?", (course_id,)
        ).fetchone()[0]
        return {
            "records": [{**dict(row), "checks": json.loads(row["checks"])} for row in rows],
            "retained_count": count,
            "retention_days": RETENTION_DAYS,
        }


def get_record(record_id: str) -> dict[str, Any]:
    with _database() as db:
        row = db.execute("SELECT * FROM inserts WHERE id = ?", (record_id,)).fetchone()
        if row is None:
            raise LookupError("Insert record expired or was already deleted.")
        return {**dict(row), **json.loads(row["payload"]), "payload": None}


def review_record(record_id: str, review: ReviewRecord) -> None:
    with _database() as db:
        result = db.execute(
            "UPDATE inserts SET status = ?, feedback = ? WHERE id = ?",
            (review.status, review.feedback, record_id),
        )
        if not result.rowcount:
            raise LookupError("Insert record expired or was already deleted.")


def complete_review(record_id: str, command: CompleteReview) -> None:
    with _database() as db:
        row = db.execute("SELECT status FROM inserts WHERE id = ?", (record_id,)).fetchone()
        if row is None:
            raise LookupError("Insert record expired or was already deleted.")
        if row["status"] != "pending" and command.fixture is None:
            raise ValueError(
                "Extract a small regression fixture before completing a flagged review."
            )
        if command.fixture:
            db.execute(
                "INSERT INTO fixtures VALUES (?, ?, ?)",
                (str(uuid.uuid4()), _now(), command.fixture.model_dump_json()),
            )
        db.execute("DELETE FROM inserts WHERE id = ?", (record_id,))


def discard_record(record_id: str) -> None:
    with _database() as db:
        db.execute("DELETE FROM inserts WHERE id = ?", (record_id,))


def list_fixtures() -> list[dict[str, Any]]:
    with _database() as db:
        return [
            json.loads(row[0])
            for row in db.execute("SELECT payload FROM fixtures ORDER BY created_at")
        ]
