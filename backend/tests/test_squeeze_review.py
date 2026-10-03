from __future__ import annotations

import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.test_insert_debug import record
from tracker_api.api.insert_debug_routes import router
from tracker_api.config import get_settings
from tracker_api.services import insert_debug_service as inserts
from tracker_api.services import squeeze_review_service as reviews


@pytest.fixture(autouse=True)
def isolated_database(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):  # type: ignore[no-untyped-def]
    monkeypatch.setenv("TRACKER_DATABASE_PATH", str(tmp_path / "study.db"))
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_loads_three_distinct_recent_raw_pastes_only_for_the_selected_course() -> None:
    for index in range(5):
        item = record().model_copy(update={"input": f"Raw {index} " * 60})
        inserts.create_record(item)
    inserts.create_record(
        record().model_copy(
            update={"source": "Save /discussion-messages/id", "input": "Saved document " * 60}
        )
    )
    inserts.create_record(
        record().model_copy(update={"course_id": "other", "input": "Other course " * 60})
    )
    result = reviews.load_recent("course")
    assert len(result) == 3
    examples = [reviews.get_review(item["id"]) for item in result]
    assert examples[0]["raw"] == "Raw 4 " * 60
    assert {item["raw"] for item in examples} == {f"Raw {index} " * 60 for index in (2, 3, 4)}
    assert all(item["source"].startswith("Paste") for item in examples)
    assert all("raw" not in item for item in result)
    assert len(reviews.load_recent("course")) == 3
    assert reviews.list_reviews("missing") == []
    assert not get_settings().database_path.exists()


def test_review_copy_survives_raw_log_expiration_without_touching_study_data() -> None:
    item = record().model_copy(update={"input": "Original response " * 40})
    inserts.create_record(item)
    review = reviews.load_recent("course")[0]
    path = get_settings().database_path.with_suffix(".editor-debug.sqlite")
    with sqlite3.connect(path) as db:
        db.execute(
            "UPDATE inserts SET created_at = ?",
            ((datetime.now(UTC) - timedelta(days=8)).isoformat(),),
        )
    inserts.cleanup()
    assert reviews.get_review(review["id"])["raw"] == item.input
    assert reviews.export_reviews("course")["reviews"][0]["raw"] == item.input
    assert not get_settings().database_path.exists()


def test_api_saves_labels_exports_original_and_rejects_stale_writes() -> None:
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        response = client.post(
            "/api/debug/squeeze-reviews",
            json={"course_id": "course", "title": "Tutor", "raw": "First.\n\nSecond."},
        )
        assert response.status_code == 200
        review = response.json()
        assert (
            client.post(
                "/api/debug/squeeze-reviews",
                json={"course_id": "course", "title": "Same input", "raw": review["raw"]},
            ).json()["id"]
            == review["id"]
        )
        path = f"/api/debug/squeeze-reviews/{review['id']}"
        state = {"version": "source-squeeze-v1", "actions": [{"command": "join"}]}
        command = {"revision": 1, "state": state, "markdown": "First. Second."}
        assert client.put(path, json=command).json()["revision"] == 2
        assert client.put(path, json=command).status_code == 409
        saved = client.get(path).json()
        assert saved["raw"] == "First.\n\nSecond."
        assert saved["state"] == state
        assert saved["markdown"] == "First. Second."
        assert client.get("/api/debug/squeeze-reviews/export?course_id=course").json()[
            "reviews"
        ] == [saved]
        assert (
            client.get("/api/debug/squeeze-reviews/export?course_id=other").json()["reviews"] == []
        )
        assert client.get("/api/debug/squeeze-reviews/missing").status_code == 404
        assert client.put("/api/debug/squeeze-reviews/missing", json=command).status_code == 404
        assert (
            client.post(
                "/api/debug/squeeze-reviews",
                json={"course_id": "course", "title": "Tutor", "raw": " "},
            ).status_code
            == 422
        )
