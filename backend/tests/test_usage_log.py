import uuid
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError
from test_insert_debug import isolated_database  # noqa: F401

from tracker_api.config import get_settings
from tracker_api.services import usage_log_service as usage


def event(**kwargs):
    return usage.UsageEvent(
        id=uuid.uuid4(),
        session_id=uuid.uuid4(),
        course_id=uuid.uuid4(),
        at=datetime.now(UTC),
        view="discussions",
        action="question.search",
        result_count=0,
        **kwargs,
    )


def report(item):
    return usage.summary(
        item.course_id, datetime.now(UTC) - timedelta(days=8), datetime.now(UTC) + timedelta(days=1)
    )


def test_idempotent_metadata_only_capture_stops_and_clear_erases():
    item = event()
    batch = usage.EventBatch(events=[item])
    usage.record(batch)
    usage.record(batch)
    result = report(item)
    assert result["event_count"] == 1 and result["empty_searches"] == 1
    assert result["recording"]
    usage.settings(usage.CaptureCommand(action="stop"))
    usage.record(usage.EventBatch(events=[item.model_copy(update={"id": uuid.uuid4()})]))
    assert report(item)["event_count"] == 1
    usage.settings(usage.CaptureCommand(action="clear"))
    assert report(item)["event_count"] == 0
    assert not report(item)["recording"]
    assert not get_settings().database_path.exists()
    with pytest.raises(ValidationError):
        event(query="secret question")
    with pytest.raises(ValidationError):
        usage.UsageEvent.model_validate({**item.model_dump(), "action": "secret response text"})


def test_expiry_bounds_and_no_automatic_restart(monkeypatch):
    item = event()
    usage.record(usage.EventBatch(events=[item]))
    with usage._database() as db:
        db.execute("UPDATE events SET at=?", ((datetime.now(UTC) - timedelta(days=8)).isoformat(),))
        db.execute(
            "UPDATE capture SET until_at=?",
            ((datetime.now(UTC) - timedelta(seconds=1)).isoformat(),),
        )
    usage.cleanup()
    assert not usage.settings()["recording"]
    assert report(item)["event_count"] == 0
    usage.settings(usage.CaptureCommand(action="start"))
    monkeypatch.setattr(usage, "MAX_EVENTS", 2)
    usage.record(
        usage.EventBatch(events=[item.model_copy(update={"id": uuid.uuid4()}) for _ in range(3)])
    )
    assert report(item)["event_count"] == 2


def test_active_time_is_capped_and_invalid_timestamps_are_ignored():
    item = event()
    active = item.model_copy(update={"action": "view.active", "duration_ms": 300_000})
    usage.record(
        usage.EventBatch(
            events=[
                active,
                item.model_copy(
                    update={"id": uuid.uuid4(), "at": datetime.now(UTC) - timedelta(hours=2)}
                ),
            ]
        )
    )
    result = report(item)
    assert result["event_count"] == 1
    assert result["active_minutes"]["discussions"] == pytest.approx(1 / 6)
