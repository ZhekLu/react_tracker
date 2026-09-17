from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pymupdf
import pytest
from sqlalchemy import text

from tracker_api.config import get_settings
from tracker_api.database import get_engine, transaction
from tracker_api.services import toggl_service
from tracker_api.services.pdf_annotation_service import (
    collect_resource_pdf_annotations,
)
from tracker_api.services.study_plan_service import sync_study_plan


@pytest.fixture(autouse=True)
def isolated_settings(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[None]:
    helper_config = tmp_path / "toggl_config.json"
    helper_config.write_text(
        f'{{"open_allowed_roots": ["{tmp_path}"]}}',
        encoding="utf-8",
    )
    monkeypatch.setenv("TRACKER_DATABASE_PATH", str(tmp_path / "tracker.db"))
    monkeypatch.setenv("TRACKER_HELPER_CONFIG_PATH", str(helper_config))
    monkeypatch.setenv(
        "TRACKER_HELPER_STATE_PATH",
        str(tmp_path / "toggl_state.json"),
    )
    get_settings.cache_clear()
    get_engine.cache_clear()
    yield
    if get_engine.cache_info().currsize:
        get_engine().dispose()
    get_engine.cache_clear()
    get_settings.cache_clear()


def _annotated_pdf(path: Path) -> None:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "Coverage is required for off-policy evaluation.")
    matches = page.search_for("Coverage is required for off-policy evaluation.")
    annotation = page.add_highlight_annot(matches[0])
    annotation.set_colors(stroke=(1.0, 0.0, 0.0))
    annotation.set_info(
        creationDate="D:20260701123000",
        modDate="D:20260701123000",
    )
    annotation.update()
    document.save(path)
    document.close()


def _seed_pdf_resource(tmp_path: Path) -> str:
    pdf_path = tmp_path / "annotated.pdf"
    _annotated_pdf(pdf_path)
    plan_path = tmp_path / "plan.md"
    plan_path.write_text(
        """
+++
format = "study-plan/v1"
id = "pdf_collection"
title = "PDF Collection"
mode = "full"

[resources.slides]
title = "Annotated slides"
path = "annotated.pdf"
kind = "slides"
+++

# PDF Collection

### Day 1: 2026-07-01 - Read {#day-01}

#### Reading

- [ ] Read the slides. {#read-slides resources=slides}

Stop when: the slides are read. {#day01-stop}
""".lstrip(),
        encoding="utf-8",
    )
    sync_study_plan(plan_path)
    with transaction() as connection:
        resource_id = connection.execute(
            text(
                """
                SELECT entity_id
                FROM source_bindings
                WHERE entity_type = 'resource'
                  AND source_key = 'pdf_collection:slides'
                """
            )
        ).scalar_one()
    return str(resource_id)


def test_pdf_collection_persists_and_reports_existing_captures(
    tmp_path: Path,
) -> None:
    resource_id = _seed_pdf_resource(tmp_path)
    with transaction() as connection:
        first = collect_resource_pdf_annotations(connection, resource_id)
    with transaction() as connection:
        second = collect_resource_pdf_annotations(connection, resource_id)
        row = connection.execute(
            text(
                """
                SELECT a.kind, aa.page_number, aa.quote, aa.color
                FROM annotations a
                JOIN annotation_anchors aa ON aa.annotation_id = a.id
                WHERE a.resource_id = :resource_id
                """
            ),
            {"resource_id": resource_id},
        ).mappings().one()

    assert first.extracted_count == 1
    assert first.created_count == 1
    assert first.kind_counts == {"question": 1}
    assert second.created_count == 0
    assert second.existing_count == 1
    assert row["kind"] == "question"
    assert row["page_number"] == 1
    assert row["quote"] == "Coverage is required for off-policy evaluation."
    assert row["color"] == "red"


def test_toggl_integration_recognizes_torl_without_extra_prefix_config(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    get_settings().helper_config_path.write_text(
        """
{
  "api_token": "test-token",
  "workspace_id": 10,
  "project_id": 20,
  "project_name": "Study"
}
""".strip(),
        encoding="utf-8",
    )
    current: dict[str, Any] | None = None

    def fake_request(
        _config: dict[str, Any],
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
    ) -> Any:
        nonlocal current
        if method == "GET" and path == "/me/time_entries/current":
            return current
        if method == "GET" and path.startswith("/me/time_entries?"):
            return []
        if method == "POST":
            assert payload is not None
            current = {
                "id": 99,
                "description": payload["description"],
                "project_id": 20,
                "start": payload["start"],
            }
            return current
        if method == "PATCH":
            current = None
            return {}
        raise AssertionError(f"Unexpected Toggl request: {method} {path}")

    monkeypatch.setattr(toggl_service, "_toggl_request", fake_request)
    started = toggl_service.start("[TORL] Day 2. Bandits")

    assert started["running"] is True
    assert started["current"]["plan_id"] == "torl"
    assert started["current"]["day_id"] == "day-02"

    stopped = toggl_service.stop()
    assert stopped["running"] is False
    assert stopped["current"] is None


def test_local_source_identity_survives_recolor_and_deletion(tmp_path: Path) -> None:
    resource_id = _seed_pdf_resource(tmp_path)
    path = tmp_path / "annotated.pdf"
    with transaction() as connection:
        collect_resource_pdf_annotations(connection, resource_id)
        saved = (
            connection.execute(text("SELECT id, source_fingerprint FROM annotations"))
            .mappings()
            .one()
        )
        connection.execute(
            text("UPDATE annotations SET status='answered' WHERE id=:id"), {"id": saved["id"]}
        )
    doc = pymupdf.open(path)
    page = doc[0]
    annotation = page.first_annot
    annotation.set_colors(stroke=(0, 0, 1))
    annotation.update()
    doc.saveIncr()
    doc.close()
    with transaction() as connection:
        recolored = collect_resource_pdf_annotations(connection, resource_id)
        row = (
            connection.execute(text("SELECT id, kind, status, source_fingerprint FROM annotations"))
            .mappings()
            .one()
        )
        assert recolored.created_count == 0 and recolored.updated_count == 1
        assert row["id"] == saved["id"] and row["source_fingerprint"] == saved["source_fingerprint"]
        assert row["kind"] == "question" and row["status"] == "answered"
    doc = pymupdf.open(path)
    page = doc[0]
    page.delete_annot(page.first_annot)
    doc.saveIncr()
    doc.close()
    with transaction() as connection:
        removed = collect_resource_pdf_annotations(connection, resource_id)
        assert removed.removed_count == 1
        assert connection.execute(text("SELECT deleted_at FROM annotations")).scalar_one()
        assert (
            connection.execute(
                text("SELECT COUNT(*) FROM annotation_question_identities")
            ).scalar_one()
            == 1
        )


def test_local_legacy_fingerprint_upgrade_preserves_question_id(tmp_path: Path) -> None:
    from tracker_api.services.pdf_annotation_service import extract_pdf_annotations

    resource_id = _seed_pdf_resource(tmp_path)
    capture = extract_pdf_annotations(tmp_path / "annotated.pdf").captures[0]
    with transaction() as connection:
        collect_resource_pdf_annotations(connection, resource_id)
        saved_id = connection.execute(text("SELECT id FROM annotations")).scalar_one()
        connection.execute(
            text("UPDATE annotations SET source_fingerprint=:legacy"),
            {"legacy": capture.legacy_fingerprint},
        )
        collect_resource_pdf_annotations(connection, resource_id)
        row = (
            connection.execute(text("SELECT id, source_fingerprint FROM annotations"))
            .mappings()
            .one()
        )
        assert row["id"] == saved_id
        assert row["source_fingerprint"] == capture.fingerprint
