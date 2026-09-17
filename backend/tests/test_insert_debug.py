from __future__ import annotations

import sqlite3
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tracker_api.api.insert_debug_routes import router
from tracker_api.config import get_settings
from tracker_api.services import insert_debug_service as debug


@pytest.fixture(autouse=True)
def isolated_database(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):  # type: ignore[no-untyped-def]
    monkeypatch.setenv("TRACKER_DATABASE_PATH", str(tmp_path / "study.db"))
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def record() -> debug.InsertRecord:
    return debug.InsertRecord(
        id=uuid.uuid4(),
        source="Paste",
        course_id="course",
        input="full private response",
        parsed="**value $x$**",
        serialized="**value $x$**",
        reopened="**value $x$**",
        checks=[],
        parser_version="test",
    )


def test_review_keeps_only_explicit_small_fixture_and_erases_full_record() -> None:
    item = record()
    debug.create_record(item)
    debug.review_record(str(item.id), debug.ReviewRecord(status="incorrect", feedback="bold"))
    with pytest.raises(ValueError):
        debug.complete_review(str(item.id), debug.CompleteReview())
    fixture = debug.DebugFixture(
        title="Bold formula", kind="roundtrip", input="**$x$**", expected="**$x$**"
    )
    debug.complete_review(str(item.id), debug.CompleteReview(fixture=fixture))
    with pytest.raises(LookupError):
        debug.get_record(str(item.id))
    assert debug.list_fixtures() == [fixture.model_dump()]
    path = get_settings().database_path.with_suffix(".editor-debug.sqlite")
    assert b"full private response" not in path.read_bytes()
    assert not get_settings().database_path.exists()


def test_retry_is_idempotent_and_local_day_range_is_timezone_aware() -> None:
    item = record()
    debug.create_record(item)
    debug.create_record(item)
    now = datetime.now(UTC)
    result = debug.list_records("course", now - timedelta(days=1), now + timedelta(days=1))
    assert len(result["records"]) == 1
    assert "input" not in result["records"][0]
    assert (
        debug.list_records("other", now - timedelta(days=1), now + timedelta(days=1))["records"]
        == []
    )
    with pytest.raises(ValueError):
        debug.list_records("course", now.replace(tzinfo=None), now)
    debug.complete_review(str(item.id), debug.CompleteReview())
    assert debug.list_fixtures() == []


def test_expiry_and_size_limits_apply_to_flagged_records_too(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(debug, "MAX_RECORDS", 2)
    items = [record() for _ in range(3)]
    for item in items:
        debug.create_record(item)
    with pytest.raises(LookupError):
        debug.get_record(str(items[0].id))
    debug.review_record(str(items[1].id), debug.ReviewRecord(status="improvement"))
    path = get_settings().database_path.with_suffix(".editor-debug.sqlite")
    with sqlite3.connect(path) as db:
        db.execute(
            "UPDATE inserts SET created_at = ? WHERE id = ?",
            ((datetime.now(UTC) - timedelta(days=8)).isoformat(), str(items[1].id)),
        )
    debug.cleanup()
    with pytest.raises(LookupError):
        debug.get_record(str(items[1].id))
    assert debug.get_record(str(items[2].id))["input"] == "full private response"
    monkeypatch.setattr(debug, "MAX_PAYLOAD_BYTES", 1)
    debug.cleanup()
    with pytest.raises(LookupError):
        debug.get_record(str(items[2].id))


def test_explicit_discard_can_remove_flagged_content_without_retaining_it() -> None:
    item = record()
    debug.create_record(item)
    debug.review_record(str(item.id), debug.ReviewRecord(status="incorrect"))
    debug.discard_record(str(item.id))
    debug.discard_record(str(item.id))
    assert debug.list_fixtures() == []


def test_api_review_fixture_and_delete_contract() -> None:
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        item = record()
        assert (
            client.post("/api/debug/inserts", json=item.model_dump(mode="json")).status_code == 200
        )
        path = f"/api/debug/inserts/{item.id}"
        assert (
            client.patch(path, json={"status": "incorrect", "feedback": "bold"}).status_code == 200
        )
        assert client.post(path + "/complete", json={}).status_code == 422
        assert client.get(path).json()["feedback"] == "bold"
        fixture = {
            "title": "Minimal bold",
            "kind": "roundtrip",
            "input": "**$x$**",
            "expected": "**$x$**",
        }
        assert client.post(path + "/complete", json={"fixture": fixture}).status_code == 200
        assert client.get(path).status_code == 404
        assert client.get("/api/debug/fixtures").json() == [fixture]
