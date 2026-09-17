from pathlib import Path

import pytest
from sqlalchemy import text
from test_plan_patch_integrity import seed, task_id
from test_plan_patch_integrity import snapshot as physical_snapshot
from test_study_plan_sync import isolated_database  # noqa: F401

from tracker_api.database import transaction
from tracker_api.editor_audit import apply_repairs, snapshot
from tracker_api.repositories.workspace_repository import upsert_note
from tracker_api.schemas.workspace import NoteUpsertCommand, TaskTutorReviewCommand
from tracker_api.services.task_review_service import import_task_review, review_blocks


def test_repair_preserves_history_links_and_mirrored_review(tmp_path: Path) -> None:
    seed(tmp_path)
    with transaction() as db:
        imported = import_task_review(
            db,
            task_id(),
            TaskTutorReviewCommand(
                import_id="editor-audit", review_markdown="**value ****$x$**** here**"
            ),
        )
        links = list(db.execute(text("SELECT * FROM note_links")))
        old_revisions = list(db.execute(text("SELECT * FROM document_revisions")))
    before = physical_snapshot()
    rows = snapshot()
    repairs = [
        {
            **row,
            "markdown": row["markdown"].replace("****$x$****", "$x$"),
            "plain_text": "value x here",
            "checks": [],
            "reasons": ["bold formula"],
        }
        for row in rows
        if "****$x$****" in row["markdown"]
    ]
    assert len(repairs) == 2
    result = apply_repairs(repairs)
    assert result["repaired"] == 2
    assert physical_snapshot(Path(result["backup"])) == before
    with transaction() as db:
        assert list(db.execute(text("SELECT * FROM note_links"))) == links
        history = list(db.execute(text("SELECT * FROM document_revisions")))
        assert history[: len(old_revisions)] == old_revisions
        assert len(history) == len(old_revisions) + 2
        note = db.execute(
            text("SELECT d.markdown FROM documents d JOIN notes n ON n.document_id=d.id")
        ).scalar_one()
        message = db.execute(
            text(
                "SELECT d.markdown FROM documents d JOIN discussion_messages m "
                "ON m.body_document_id=d.id WHERE m.id=:id"
            ),
            {"id": imported.message_id},
        ).scalar_one()
        assert review_blocks(note)[0].markdown == message
    repaired_state = physical_snapshot()
    with pytest.raises(ValueError, match="changed"):
        apply_repairs(repairs)
    assert physical_snapshot() == repaired_state


def test_stale_or_deleted_document_rejects_entire_batch(tmp_path: Path) -> None:
    course = seed(tmp_path)
    with transaction() as db:
        for content in ["first", "second"]:
            upsert_note(
                db,
                NoteUpsertCommand(
                    course_id=course,
                    entity_type="task",
                    entity_id=task_id(),
                    kind="task",
                    markdown=content,
                ),
            )
    repairs = [
        {
            **row,
            "markdown": "updated",
            "plain_text": "updated",
            "reasons": ["example"],
            "checks": [],
        }
        for row in snapshot()
    ]
    with transaction() as db:
        db.execute(
            text(
                "UPDATE documents SET markdown='newer user edit', revision=revision+1 WHERE id=:id"
            ),
            {"id": repairs[-1]["id"]},
        )
    before = physical_snapshot()
    with pytest.raises(ValueError, match="changed"):
        apply_repairs(repairs)
    assert physical_snapshot() == before
