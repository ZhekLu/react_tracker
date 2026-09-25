from __future__ import annotations

import io
import json
import urllib.error

import pytest
from sqlalchemy import text

from tracker_api.config import get_settings
from tracker_api.database import transaction
from tracker_api.services import toggl_service as service
from tracker_api.repositories.workspace_repository import (
    reconcile_toggl_entries, record_toggl_start, toggl_task_id, toggl_task_totals,
)
from test_workspace_mutations import isolated_database, _seed_course  # noqa: F401


def configure():
    config = {"api_token": "test", "workspace_id": 10, "project_id": 20}
    get_settings().helper_config_path.write_text(json.dumps(config))
    return config


def entry(id="phone", description="[Mutation] Day 1. Read paper"):
    return {"id": id, "description": description, "project_id": 20, "workspace_id": 10,
            "start": "2026-07-01T10:00:00Z", "stop": "2026-07-01T10:10:00Z", "duration": 600}


def test_routine_snapshot_contains_entries_but_cache_does_not_repeat_sync(monkeypatch):
    configure()
    calls = []
    def request(config, method, path):
        calls.append(path)
        return None if path.endswith("/current") else [entry(description="[TORL] Day 1. Read paper")]
    monkeypatch.setattr(service, "_toggl_request", request)
    result = service.public_status()
    assert len(result["_entries"]) == 1
    assert result["days"]["torl"]["day-01"] == 600
    assert "_entries" not in service.public_status(force=True)
    assert len(calls) == 2
    assert result["sync_interval_seconds"] == 600


def test_force_cannot_bypass_402_pause_and_saved_totals_survive(monkeypatch):
    configure()
    service._save_state({"status_cache": {"timestamp": 1, "payload": {
        "configured": True, "running": True, "current": {}, "totals": {"torl": 600},
        "days": {}, "error": "", "synced_at": "2026-07-01T10:10:00Z"}}})
    calls = []
    def request(*args):
        calls.append(args)
        raise service.TogglApiError(402, "Payment Required")
    monkeypatch.setattr(service, "_toggl_request", request)
    for _ in range(3):
        result = service.public_status(force=True)
        assert result["totals"] == {"torl": 600}
        assert not result["running"]
        assert "rate-limited" in result["error"]
    assert len(calls) == 1


@pytest.mark.parametrize("response", [{"error": "bad"}, [{"id": 1}], [entry()] * 1000])
def test_incomplete_snapshot_cannot_erase_local_records(monkeypatch, response):
    configure()
    monkeypatch.setattr(service, "_toggl_request", lambda config, method, path: None if path.endswith("/current") else response)
    result = service.public_status()
    assert result["error"]
    assert "_entries" not in result


def test_quota_persists_and_does_not_count_cached_reads(monkeypatch):
    config = configure()
    calls = []
    def urlopen(*args, **kwargs):
        calls.append(args)
        return io.BytesIO(b"null")
    monkeypatch.setattr(service.urllib.request, "urlopen", urlopen)
    for _ in range(24):
        service._toggl_request(config, "GET", "/me/time_entries/current")
    with pytest.raises(service.TogglApiError):
        service._toggl_request(config, "GET", "/me/time_entries/current")
    assert len(calls) == 24
    # Workspace mutations have their own conservative allowance.
    service._toggl_request(config, "PATCH", "/workspaces/10/time_entries/1/stop")
    assert len(calls) == 25


def test_phone_restart_reuses_unique_task_binding_and_reconciles_idempotently(tmp_path):
    course_id, _ = _seed_course(tmp_path)
    with transaction() as connection:
        task = connection.execute(text("SELECT id, day_id FROM tasks LIMIT 1")).mappings().one()
        record_toggl_start(connection, course_id=course_id, day_id=task["day_id"], task_id=task["id"],
                           external_id="old", description=entry()["description"], started_at=entry()["start"])
        remote = [service._reconciliation_entry(entry("old")), service._reconciliation_entry(entry())]
        for _ in range(2):
            reconcile_toggl_entries(connection, remote, window_start="2026-07-01T00:00:00Z")
        assert toggl_task_id(connection, "phone") == task["id"]
        assert toggl_task_totals(connection)[task["id"]] == 1200
        remote[1]["duration_seconds"] = 300
        reconcile_toggl_entries(connection, remote[1:], window_start="2026-07-01T00:00:00Z")
        assert toggl_task_totals(connection)[task["id"]] == 300


def test_ambiguous_titles_stay_at_day_level_and_wrong_project_is_excluded(tmp_path):
    config = configure()
    course_id, _ = _seed_course(tmp_path)
    with transaction() as connection:
        tasks = connection.execute(text("SELECT id, day_id FROM tasks LIMIT 2")).mappings().all()
        assert len(tasks) == 2
        for i, task in enumerate(tasks):
            record_toggl_start(connection, course_id=course_id, day_id=task["day_id"], task_id=task["id"],
                               external_id=str(i), description=entry()["description"], started_at=entry()["start"])
        reconcile_toggl_entries(connection, [service._reconciliation_entry(entry())], window_start="2026-07-01T00:00:00Z")
        assert toggl_task_id(connection, "phone") is None
        assert connection.execute(text("SELECT COUNT(*) FROM time_entries WHERE external_id='phone'")).scalar_one() == 1
    assert not service._entry_matches_project(config, {**entry(), "project_id": 99})
    assert not service._entry_matches_project(config, {**entry(), "workspace_id": 99})
