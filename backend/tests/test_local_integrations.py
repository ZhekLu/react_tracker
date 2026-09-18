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
    monkeypatch.setenv("TRACKER_COURSE_FILES_CONFIG_PATH", str(tmp_path / "course_files.json"))
    monkeypatch.setenv("TRACKER_ANNOTATION_IMAGE_DIR", str(tmp_path / "annotation_images"))
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


def _add_local_marks(path: Path) -> None:
    with pymupdf.open(path) as doc:
        page = doc[0]
        for points, color in [
            ([(40, 100), (40, 165)], (1, 0, 0)),
            ([(80, 125), (100, 140), (120, 120)], (1, 0, 0)),
            ([(80, 280), (110, 300)], (0, 0, 1)),
        ]:
            ink = page.add_ink_annot([points])
            ink.set_colors(stroke=color)
            ink.update()
        page.add_freetext_annot((160, 190, 360, 225), "An embedded text note")
        shape = page.add_rect_annot((70, 350, 150, 400))
        shape.set_colors(stroke=(0, 0, 0))
        shape.update()
        doc.saveIncr()


def _local_rows(connection):
    return (
        connection.execute(
            text("""
        SELECT a.id, a.kind, a.status, a.origin, a.source_fingerprint,
               a.body_document_id, aa.annotation_kind, aa.selector_json, d.plain_text
        FROM annotations a
        JOIN annotation_anchors aa ON aa.annotation_id = a.id
        LEFT JOIN documents d ON d.id = a.body_document_id
        WHERE a.deleted_at IS NULL
    """)
        )
        .mappings()
        .all()
    )


def test_local_icloud_annotations_import_without_cloud_and_repeat_safely(tmp_path, monkeypatch):
    import json

    from tracker_api.services import pdf_annotation_service

    def no_cloud(*_args, **_kwargs):
        raise AssertionError("Local PDF import must never contact Drawboard Cloud")

    monkeypatch.setattr(pdf_annotation_service, "extract_drawboard_annotations", no_cloud)
    papers = tmp_path / "Mobile Documents" / "papers"
    papers.mkdir(parents=True)
    resource_id = _seed_pdf_resource(papers)
    _add_local_marks(papers / "annotated.pdf")
    with transaction() as connection:
        first = collect_resource_pdf_annotations(connection, resource_id)
        rows = _local_rows(connection)
    with transaction() as connection:
        second = collect_resource_pdf_annotations(connection, resource_id)
    assert first.created_count == 5
    assert first.kind_counts == {"question": 2, "note": 3}
    assert first.ignored == {}
    assert second.existing_count == 5
    assert second.created_count == second.updated_count == second.removed_count == 0
    assert all(row["origin"] == "pdf_import" for row in rows)
    ink = next(row for row in rows if row["annotation_kind"] == "Ink" and row["kind"] == "question")
    metadata = json.loads(ink["selector_json"])
    assert metadata["inkGroupSize"] == 2
    assert "drawboardDocumentId" not in metadata
    for row in rows:
        if row["annotation_kind"] in {"Ink", "Square"}:
            saved = json.loads(row["selector_json"])
            for key in ("contextImageUrl", "annotatedPageImageUrl"):
                image_id = saved[key].rsplit("/", 1)[1]
                image = get_settings().annotation_image_dir / resource_id / f"{image_id}.png"
                assert image.read_bytes().startswith(b"\x89PNG")
    assert any(row["plain_text"] == "An embedded text note" for row in rows)


def test_local_ink_preserves_identity_answer_and_user_notes_after_guide_deletion(tmp_path):
    import json

    resource_id = _seed_pdf_resource(tmp_path)
    path = tmp_path / "annotated.pdf"
    _add_local_marks(path)
    with transaction() as connection:
        collect_resource_pdf_annotations(connection, resource_id)
        before = next(
            row
            for row in _local_rows(connection)
            if row["annotation_kind"] == "Ink" and row["kind"] == "question"
        )
        connection.execute(
            text("UPDATE annotations SET status='answered' WHERE id=:id"), {"id": before["id"]}
        )
        connection.execute(
            text(
                "UPDATE documents SET plain_text='My own explanation', "
                "markdown='My own explanation' WHERE id=:id"
            ),
            {"id": before["body_document_id"]},
        )
    with pymupdf.open(path) as doc:
        page = doc[0]
        inks = [a for a in page.annots() if a.type[1] == "Ink"]
        page.delete_annot(inks[0])
        inks[1].set_colors(stroke=(0, 0, 1))
        inks[1].update()
        doc.saveIncr()
    with transaction() as connection:
        changed = collect_resource_pdf_annotations(connection, resource_id)
        after = next(row for row in _local_rows(connection) if row["id"] == before["id"])
    assert changed.created_count == changed.removed_count == 0
    assert after["status"] == "answered"
    assert after["kind"] == "question"
    assert after["plain_text"] == "My own explanation"
    assert after["source_fingerprint"] == before["source_fingerprint"]
    assert (
        json.loads(after["selector_json"])["contextImageUrl"]
        == json.loads(before["selector_json"])["contextImageUrl"]
    )
    with pymupdf.open(path) as doc:
        page = doc[0]
        for annotation in list(page.annots()):
            if annotation.type[1] == "Ink":
                page.delete_annot(annotation)
        doc.saveIncr()
    with transaction() as connection:
        deleted = collect_resource_pdf_annotations(connection, resource_id)
        assert all(row["annotation_kind"] != "Ink" for row in _local_rows(connection))
        assert (
            connection.execute(
                text("SELECT plain_text FROM documents WHERE id=:id"),
                {"id": before["body_document_id"]},
            ).scalar_one()
            == "My own explanation"
        )
    assert deleted.removed_count == 2


def test_local_preview_failure_does_not_persist_invisible_handwriting(tmp_path, monkeypatch):
    from tracker_api.services import pdf_annotation_service

    resource_id = _seed_pdf_resource(tmp_path)
    _add_local_marks(tmp_path / "annotated.pdf")

    def fail(*_args, **_kwargs):
        raise RuntimeError("Failed image write")

    monkeypatch.setattr(pdf_annotation_service, "render_local_annotation_images", fail)
    with transaction() as connection:
        with pytest.raises(pdf_annotation_service.PdfAnnotationError, match="Nothing was imported"):
            collect_resource_pdf_annotations(connection, resource_id)
        assert connection.execute(text("SELECT COUNT(*) FROM annotations")).scalar_one() == 0


def test_local_highlight_keeps_both_quote_and_comment(tmp_path):
    resource_id = _seed_pdf_resource(tmp_path)
    with pymupdf.open(tmp_path / "annotated.pdf") as doc:
        page = doc[0]
        annotation = page.first_annot
        annotation.set_info(content="Why is coverage required?")
        annotation.update()
        doc.saveIncr()
    with transaction() as connection:
        collect_resource_pdf_annotations(connection, resource_id)
        row = (
            connection.execute(
                text("""SELECT aa.quote, d.plain_text FROM annotations a
            JOIN annotation_anchors aa ON aa.annotation_id=a.id
            JOIN documents d ON d.id=a.body_document_id""")
            )
            .mappings()
            .one()
        )
        assert row["quote"] == "Coverage is required for off-policy evaluation."
        assert row["plain_text"] == "Why is coverage required?"


def test_repeated_pdf_annotation_ids_on_different_pages_and_old_identity_upgrade(tmp_path):
    from tracker_api.services.pdf_annotation_service import extract_pdf_annotations

    resource_id = _seed_pdf_resource(tmp_path)
    path = tmp_path / "annotated.pdf"
    with pymupdf.open(path) as doc:
        page = doc.new_page()
        page.insert_text((72, 72), "A separate question on page two.")
        annotation = page.add_highlight_annot(page.search_for("separate question"))
        annotation.set_colors(stroke=(1, 0, 0))
        annotation.update()
        assert annotation.info["id"] == doc[0].first_annot.info["id"]
        doc.saveIncr()
    captures = extract_pdf_annotations(path).captures
    assert len({capture.fingerprint for capture in captures}) == 2
    assert captures[0].previous_source_fingerprint == captures[1].previous_source_fingerprint
    with transaction() as connection:
        result = collect_resource_pdf_annotations(connection, resource_id)
        assert result.created_count == 2
        second_id = connection.execute(
            text("""SELECT a.id FROM annotations a
            JOIN annotation_anchors aa ON aa.annotation_id=a.id
            WHERE aa.page_number=2""")
        ).scalar_one()
        # Simulate a pre-fix database whose sole surviving identity is page two.
        connection.execute(text("""DELETE FROM annotations WHERE id != :id"""), {"id": second_id})
        connection.execute(
            text("UPDATE annotations SET source_fingerprint=:old, status='answered'"),
            {"old": captures[1].previous_source_fingerprint},
        )
        upgraded = collect_resource_pdf_annotations(connection, resource_id)
        assert upgraded.created_count == 1
        rows = (
            connection.execute(
                text("""SELECT a.id, a.status, aa.page_number FROM annotations a
            JOIN annotation_anchors aa ON aa.annotation_id=a.id ORDER BY aa.page_number""")
            )
            .mappings()
            .all()
        )
        assert len(rows) == 2
        assert rows[0]["status"] == "open"
        assert rows[1]["id"] == second_id
        assert rows[1]["status"] == "answered"
        assert collect_resource_pdf_annotations(connection, resource_id).existing_count == 2


def test_pdf_sync_during_collection_cannot_reconcile_a_partial_snapshot(tmp_path, monkeypatch):
    from tracker_api.services import pdf_annotation_service

    resource_id = _seed_pdf_resource(tmp_path)
    path = tmp_path / "annotated.pdf"

    def sync_during_render(*_args, **_kwargs):
        with pymupdf.open(path) as doc:
            doc.new_page()
            doc.saveIncr()
        return {}, {}

    monkeypatch.setattr(
        pdf_annotation_service, "render_local_annotation_images", sync_during_render
    )
    with transaction() as connection:
        with pytest.raises(
            pdf_annotation_service.PdfAnnotationError, match="changed during collection"
        ):
            collect_resource_pdf_annotations(connection, resource_id)
        assert connection.execute(text("SELECT COUNT(*) FROM annotations")).scalar_one() == 0


def test_denied_local_file_read_reports_permission_before_import(tmp_path, monkeypatch):
    from tracker_api.services.pdf_annotation_service import PdfAnnotationError

    resource_id = _seed_pdf_resource(tmp_path)
    path = tmp_path / 'annotated.pdf'
    original_open = Path.open

    def restricted_open(self, *args, **kwargs):
        if self == path:
            raise PermissionError('Operation not permitted')
        return original_open(self, *args, **kwargs)

    monkeypatch.setattr(Path, 'open', restricted_open)
    with transaction() as connection:
        with pytest.raises(PdfAnnotationError, match='permission denied'):
            collect_resource_pdf_annotations(connection, resource_id)
        assert connection.execute(text('SELECT COUNT(*) FROM annotations')).scalar_one() == 0
