import json
import sqlite3
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import text
from test_plan_patch_integrity import patch, seed, snapshot, task_id
from test_study_plan_sync import _full_plan, isolated_database  # noqa: F401

from tracker_api.database import transaction
from tracker_api.repositories.workspace_repository import (
    RevisionConflictError,
    get_workspace,
    upsert_note,
)
from tracker_api.schemas.workspace import NoteUpsertCommand
from tracker_api.services import task_admin_service as admin
from tracker_api.services.study_plan_service import StudyPlanSyncError, sync_study_plan


def perform(id: str, action: str = "edit", **fields):
    with transaction() as db:
        revision = db.execute(text("SELECT revision FROM tasks WHERE id=:id"),
                              {"id": id}).scalar_one()
    command = admin.TaskAdminCommand(request_id=uuid4(), revision=revision,
                                    action=action, **fields)
    with transaction() as db:
        return admin.apply(db, id, command)


def state(id: str):
    with transaction() as db:
        return admin._snapshot(db, id)


def test_rename_backup_and_receipt_retries(tmp_path):
    seed(tmp_path)
    id = task_id()
    command = admin.TaskAdminCommand(request_id=uuid4(), revision=1, action="edit", title="Renamed")
    with transaction() as db:
        first = admin.apply(db, id, command)
    with sqlite3.connect(first["backup_path"]) as backup:
        assert backup.execute("SELECT title FROM tasks WHERE id=?", (id,)).fetchone()[0] != "Renamed"
    with transaction() as db:
        assert admin.apply(db, id, command) == first
    assert state(id)["revision"] == 2
    with transaction() as db:
        assert db.execute(text("SELECT count(*) FROM task_admin_events")).scalar_one() == 1
    with pytest.raises(RevisionConflictError):
        with transaction() as db:
            admin.apply(db, id, command.model_copy(update={"title": "Different"}))


def test_delete_restore_keeps_notes_resource_progress_and_time(tmp_path):
    course = seed(tmp_path)
    id = task_id()
    with transaction() as db:
        upsert_note(db, NoteUpsertCommand(course_id=course, entity_type="task", entity_id=id,
                                         kind="task", markdown="My work **stays**. ?? Why?"))
    original = state(id)
    with transaction() as db:
        saved_tables = {table: list(db.execute(text(f"SELECT * FROM {table}"))) for table in [
            "notes", "documents", "document_revisions", "note_links", "annotations",
            "resources", "resource_reading_progress", "time_entries", "task_resources",
        ]}
    deleted = perform(id, "delete")["task"]
    assert deleted["removed_at"] and deleted["deleted_at"]
    with transaction() as db:
        assert id not in [task.id for day in get_workspace(db, course).days
                          for section in day.sections for task in section.tasks]
        assert admin.overview(db, course)["tasks"][0]["removed_at"]
        for table, rows in saved_tables.items():
            assert list(db.execute(text(f"SELECT * FROM {table}"))) == rows
    restored = perform(id, "restore")["task"]
    assert restored["removed_at"] is None and restored["deleted_at"] is None
    assert restored["note_count"] == 1
    assert restored["resource_ids"] == original["resource_ids"]
    assert restored["order_index"] == original["order_index"]


def test_stale_revision_and_failed_backup_do_not_write(tmp_path, monkeypatch):
    seed(tmp_path)
    id = task_id()
    perform(id, title="Manual")
    before = snapshot()
    with pytest.raises(RevisionConflictError):
        with transaction() as db:
            admin.apply(db, id, admin.TaskAdminCommand(request_id=uuid4(), revision=1,
                                                     action="delete"))
    assert snapshot() == before
    def fail():
        raise OSError("Disk unavailable")
    monkeypatch.setattr(admin, "backup_database", fail)
    with pytest.raises(OSError):
        perform(id, "delete")
    assert snapshot() == before


def test_failure_after_write_rolls_back_receipt_and_study_data(tmp_path, monkeypatch):
    seed(tmp_path)
    id = task_id()
    before = snapshot()
    real_snapshot = admin._snapshot
    calls = 0
    def fail_after(db, task):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise ValueError("Simulated mid-transaction failure")
        return real_snapshot(db, task)
    monkeypatch.setattr(admin, "_snapshot", fail_after)
    with pytest.raises(ValueError):
        perform(id, "delete")
    assert snapshot() == before


def test_resource_attachment_validation_and_unlink_preserves_resource(tmp_path):
    seed(tmp_path)
    id = task_id()
    resource = state(id)["resource_ids"][0]
    before = snapshot()
    for resources in [["missing"], [str(uuid4())]]:
        with pytest.raises(ValueError):
            perform(id, resource_ids=resources)
        assert snapshot() == before
    assert perform(id, resource_ids=[])["task"]["resource_ids"] == []
    assert perform(id, resource_ids=[resource])["task"]["resource_ids"] == [resource]
    with transaction() as db:
        assert db.execute(text("SELECT deleted_at FROM resources WHERE id=:id"),
                          {"id": resource}).scalar_one() is None


@pytest.mark.parametrize("status", ["todo", "in_progress", "done", "later", "skipped"])
def test_explicit_status_reconciles_timestamps(tmp_path, status):
    seed(tmp_path)
    id = task_id()
    perform(id, status="done")
    result = perform(id, status=status)["task"]
    for field, target in [("completed_at", "done"), ("skipped_at", "skipped"),
                          ("deferred_at", "later")]:
        assert bool(result[field]) == (status == target)


@pytest.mark.parametrize("fields", [
    {"title": " "}, {"title": "two\nlines"}, {"title": None}, {"resource_ids": None},
    {"resource_ids": ["same", "same"]}, {"estimated_minutes": -1},
    {"status": "unknown"}, {"unexpected": True}, {},
])
def test_input_validation(fields):
    with pytest.raises(ValidationError):
        admin.TaskAdminCommand(request_id=uuid4(), revision=1, action="edit", **fields)


def test_patch_cannot_resurrect_removed_task(tmp_path):
    seed(tmp_path)
    id = task_id()
    perform(id, "delete")
    before = snapshot()
    with pytest.raises(StudyPlanSyncError, match="deleted in Administration"):
        sync_study_plan(patch(tmp_path, "- [ ] Old task {#read-book}"))
    assert snapshot() == before


def test_patch_cannot_overwrite_manual_title_but_release_allows_it(tmp_path):
    seed(tmp_path)
    id = task_id()
    perform(id, title="My deliberate title")
    before = snapshot()
    path = patch(tmp_path, "- [ ] Tutor title {#read-book}")
    with pytest.raises(StudyPlanSyncError, match="title was edited"):
        sync_study_plan(path)
    assert snapshot() == before
    perform(id, "release")
    sync_study_plan(path)
    assert state(id)["title"] == "Tutor title"


def test_full_plan_cannot_remove_manually_edited_task(tmp_path):
    seed(tmp_path)
    with transaction() as db:
        id = str(db.execute(text("SELECT id FROM tasks WHERE title LIKE 'Write%'" )).scalar_one())
    perform(id, title="My summary")
    path = tmp_path / "replacement.md"
    path.write_text(_full_plan(second_task=False))
    before = snapshot()
    with pytest.raises(StudyPlanSyncError, match="remove manually edited"):
        sync_study_plan(path)
    assert snapshot() == before


def test_noop_does_not_create_backup_or_event(tmp_path):
    seed(tmp_path)
    id = task_id()
    before = snapshot()
    assert perform(id, title=state(id)["title"])["event_id"] is None
    assert snapshot() == before


def test_api_errors_and_history_are_scoped(tmp_path):
    course = seed(tmp_path)
    id = task_id()
    from tracker_api.main import create_app

    with TestClient(create_app()) as client:
        command = {"request_id": str(uuid4()), "revision": 1, "action": "edit", "title": "API"}
        assert client.post(f"/api/tasks/{id}/admin", json=command).status_code == 200
        command.update(request_id=str(uuid4()), title="Stale")
        assert client.post(f"/api/tasks/{id}/admin", json=command).status_code == 409
        assert client.post("/api/tasks/missing/admin", json=command).status_code == 404
        assert client.get("/api/courses/missing/task-admin").status_code == 404
        result = client.get(f"/api/courses/{course}/task-admin").json()
        assert result["plan_id"] == "native_course"
        assert "delete=true" in client.get("/api/plan-patching-guide").json()["markdown"]
        assert len(result["history"]) == 1
        assert result["history"][0]["after"]["title"] == "API"
        assert "markdown" not in json.dumps(result["history"])


def test_foreign_course_resource_is_rejected(tmp_path):
    seed(tmp_path)
    id = task_id()
    other = tmp_path / "other.md"
    other.write_text(_full_plan().replace('id = "native_course"', 'id = "other_course"'))
    other_course = sync_study_plan(other).course_id
    with transaction() as db:
        resource = str(db.execute(text("SELECT id FROM resources WHERE course_id=:id LIMIT 1"),
                                  {"id": other_course}).scalar_one())
    before = snapshot()
    with pytest.raises(ValueError, match="belong to this course"):
        perform(id, resource_ids=[resource])
    assert snapshot() == before


def test_running_timer_blocks_delete_and_cancel(tmp_path):
    course = seed(tmp_path)
    id = task_id()
    with transaction() as db:
        db.execute(text("""
            INSERT INTO time_entries(id,course_id,task_id,provider,started_at,created_at,updated_at)
            VALUES ('timer',:course,:task,'internal','now','now','now')
        """), {"course": course, "task": id})
    before = snapshot()
    for action, fields in [("delete", {}), ("edit", {"status": "skipped"})]:
        with pytest.raises(ValueError, match="running timer"):
            perform(id, action, **fields)
        assert snapshot() == before


def test_restore_appends_when_old_order_is_taken(tmp_path):
    seed(tmp_path)
    id = task_id()
    old = state(id)["order_index"]
    perform(id, "delete")
    with transaction() as db:
        db.execute(text("UPDATE tasks SET order_index=:ord WHERE title LIKE 'Write%'"), {"ord": old})
    assert perform(id, "restore")["task"]["order_index"] > old


def test_patch_preserves_detached_resource_and_rejects_reattachment(tmp_path):
    seed(tmp_path)
    id = task_id()
    perform(id, resource_ids=[])
    sync_study_plan(patch(tmp_path, "- [ ] Read the book {#read-book}"))
    assert state(id)["resource_ids"] == []
    before = snapshot()
    resource_patch = tmp_path / "resource.md"
    resource_patch.write_text(_full_plan().replace('mode = "full"', 'mode = "patch"'))
    with pytest.raises(StudyPlanSyncError, match="resource_ids was edited"):
        sync_study_plan(resource_patch)
    assert snapshot() == before


@pytest.mark.parametrize("action", ["delete", "restore", "release"])
def test_non_edit_actions_reject_hidden_field_changes(action):
    with pytest.raises(ValidationError, match="Only edit"):
        admin.TaskAdminCommand(request_id=uuid4(), revision=1, action=action, title="Hidden change")
