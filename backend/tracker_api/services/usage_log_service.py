"""Disposable, content-free UX observations. Never part of study-data backups."""

from __future__ import annotations

import sqlite3
import uuid
from collections import Counter
from collections.abc import Iterator
from contextlib import closing, contextmanager
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from ..config import get_settings

View = Literal["roadmap", "resources", "skills", "exams", "notes", "discussions", "debug"]
Action = Literal[
    "view.open",
    "view.active",
    "control.button",
    "control.change",
    "control.expand",
    "control.edit",
    "question.search",
    "question.filter",
    "question.source",
    "question.preview",
    "question.open_answer",
    "question.prepare",
    "question.open_source",
    "discussion.finder",
    "discussion.conversations",
    "discussion.open",
    "discussion.create",
    "discussion.import",
    "discussion.qa",
    "discussion.copy",
    "discussion.delete",
    "task.copy",
    "task.import",
    "task.next",
    "task.qa",
    "qa.next",
    "qa.previous",
    "qa.filter",
    "qa.group",
    "qa.close",
    "qa.understood",
    "api.read",
    "api.write",
]
RETENTION_DAYS = 7
MAX_EVENTS = 50_000


class UsageEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: uuid.UUID
    session_id: uuid.UUID
    course_id: uuid.UUID
    at: datetime
    view: View
    action: Action
    duration_ms: int = Field(default=0, ge=0, le=300_000)
    result_count: int | None = Field(default=None, ge=0, le=1_000_000)
    outcome: Literal["ok", "error"] = "ok"


class EventBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    events: list[UsageEvent] = Field(max_length=100)


class CaptureCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["start", "stop", "clear"]


def _now() -> datetime:
    return datetime.now(UTC)


def _prune(db: sqlite3.Connection) -> None:
    db.execute(
        "DELETE FROM events WHERE at < ?", ((_now() - timedelta(days=RETENTION_DAYS)).isoformat(),)
    )
    db.execute(
        "DELETE FROM events WHERE id IN (SELECT id FROM events "
        "ORDER BY at DESC, rowid DESC LIMIT -1 OFFSET ?)",
        (MAX_EVENTS,),
    )


@contextmanager
def _database() -> Iterator[sqlite3.Connection]:
    path = get_settings().database_path.with_suffix(".usage.sqlite")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch(mode=0o600, exist_ok=True)
    with closing(sqlite3.connect(path, timeout=10)) as db, db:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA secure_delete = ON")
        db.execute("PRAGMA journal_mode = DELETE")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS capture (
                id INTEGER PRIMARY KEY CHECK(id=1), until_at TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS events (
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL, course_id TEXT NOT NULL,
                at TEXT NOT NULL, view TEXT NOT NULL, action TEXT NOT NULL,
                duration_ms INTEGER NOT NULL, result_count INTEGER, outcome TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS usage_course_at ON events(course_id, at);
        """)
        # User requested a few days of observation; never auto-restart after expiry/stop.
        db.execute(
            "INSERT OR IGNORE INTO capture VALUES (1, ?)",
            ((_now() + timedelta(days=3)).isoformat(),),
        )
        _prune(db)
        yield db


def cleanup() -> None:
    with _database():
        pass


def _settings(db: sqlite3.Connection) -> dict[str, Any]:
    until = db.execute("SELECT until_at FROM capture WHERE id=1").fetchone()[0]
    return {
        "until": until,
        "recording": until > _now().isoformat(),
        "retention_days": RETENTION_DAYS,
    }


def settings(command: CaptureCommand | None = None) -> dict[str, Any]:
    with _database() as db:
        if command:
            until = _now() + timedelta(days=3) if command.action == "start" else _now()
            db.execute("UPDATE capture SET until_at=? WHERE id=1", (until.isoformat(),))
            if command.action == "clear":
                db.execute("DELETE FROM events")
        return _settings(db)


def record(batch: EventBatch) -> dict[str, Any]:
    with _database() as db:
        state = _settings(db)
        if not state["recording"]:
            return state
        now = _now()
        for event in batch.events:
            if event.at.tzinfo is None or not now - timedelta(
                minutes=10
            ) <= event.at <= now + timedelta(seconds=30):
                continue
            db.execute(
                "INSERT OR IGNORE INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    str(event.id),
                    str(event.session_id),
                    str(event.course_id),
                    event.at.astimezone(UTC).isoformat(),
                    event.view,
                    event.action,
                    min(event.duration_ms, 10_000)
                    if event.action == "view.active"
                    else event.duration_ms,
                    event.result_count,
                    event.outcome,
                ),
            )
        _prune(db)
        return state


def summary(course_id: uuid.UUID, start: datetime, end: datetime) -> dict[str, Any]:
    if start.tzinfo is None or end.tzinfo is None or end <= start:
        raise ValueError("Supply an increasing date range with a timezone.")
    with _database() as db:
        rows = [
            dict(r)
            for r in db.execute(
                "SELECT * FROM events WHERE course_id=? AND at>=? AND at<? ORDER BY at, rowid",
                (
                    str(course_id),
                    start.astimezone(UTC).isoformat(),
                    end.astimezone(UTC).isoformat(),
                ),
            )
        ]
        state = _settings(db)
    counts: Counter[tuple[str, str]] = Counter()
    minutes: Counter[str] = Counter()
    transitions: Counter[str] = Counter()
    repeats: Counter[str] = Counter()
    previous: dict[str, dict[str, Any]] = {}
    for row in rows:
        if row["action"] == "view.active":
            minutes[row["view"]] += row["duration_ms"] / 60_000
            continue
        if row["action"].startswith("api."):
            continue
        counts[(row["view"], row["action"])] += 1
        prior = previous.get(row["session_id"])
        if prior:
            gap = (
                datetime.fromisoformat(row["at"]) - datetime.fromisoformat(prior["at"])
            ).total_seconds()
            if 0 <= gap <= 30:
                transitions[
                    f"{prior['view']}/{prior['action']} → {row['view']}/{row['action']}"
                ] += 1
            if 0 <= gap <= 1 and row["action"] == prior["action"] and row["view"] == prior["view"]:
                repeats[f"{row['view']}/{row['action']}"] += 1
        previous[row["session_id"]] = row
    searches = [r for r in rows if r["action"] == "question.search"]
    return {
        **state,
        "event_count": len(rows),
        "sessions": len({r["session_id"] for r in rows}),
        "active_minutes": dict(minutes),
        "searches": len(searches),
        "empty_searches": sum(r["result_count"] == 0 for r in searches),
        "failed_requests": sum(
            r["outcome"] == "error" and r["action"].startswith("api.") for r in rows
        ),
        "slow_requests": sum(
            r["duration_ms"] >= 1500 and r["action"].startswith("api.") for r in rows
        ),
        "actions": [{"view": v, "action": a, "count": n} for (v, a), n in counts.most_common(50)],
        "sequences": [{"sequence": k, "count": n} for k, n in transitions.most_common(15)],
        "repeated_actions": [{"action": k, "count": n} for k, n in repeats.most_common(10)],
    }
