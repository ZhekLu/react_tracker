from pathlib import Path

import pytest
from sqlalchemy import text
from test_plan_patch_integrity import seed, snapshot, task_id
from test_study_plan_sync import isolated_database  # noqa: F401

from tracker_api.database import transaction
from tracker_api.repositories import workspace_repository as repo
from tracker_api.schemas.workspace import (
    DiscussionAnswerDeleteCommand,
    DiscussionAnswerImportItem,
    DiscussionDeleteCommand,
    DiscussionMessageAnnotationInput,
    DiscussionMessageDeleteCommand,
    DiscussionMessageUpdateCommand,
    NoteUpsertCommand,
    TaskTutorReviewCommand,
)
from tracker_api.services.task_review_service import (
    import_task_review,
    original_note,
    review_blocks,
)


def command(**kwargs) -> TaskTutorReviewCommand:
    return TaskTutorReviewCommand(
        import_id="test-import", review_markdown="## Feedback\n\nUse $Q_\\theta$.", **kwargs
    )


def test_review_import_replay_and_two_way_edit_lifecycle(tmp_path: Path) -> None:
    course = seed(tmp_path)
    task = task_id()
    with transaction() as connection:
        result = import_task_review(connection, task, command())
    with transaction() as connection:
        assert import_task_review(connection, task, command()) == result
        workspace = repo.get_workspace(connection, course)
        note = workspace.notes[0]
        assert review_blocks(note.document.markdown)[0].message_id == result.message_id
        root = next(a for a in workspace.annotations if a.id == result.question_id)
        assert root.anchor.metadata["taskId"] == task
        assert "Read the book" in root.body.markdown
        assert workspace.discussions[0].source_day_id == workspace.days[0].id
        assert workspace.days[0].open_question_count == 1
        assert (
            next(
                t for s in workspace.days[0].sections for t in s.tasks if t.id == task
            ).open_question_count
            == 1
        )
    with transaction() as connection:
        message = repo.get_workspace(connection, course).discussions[0].messages[-1]
        repo.update_discussion_message(
            connection,
            message.id,
            DiscussionMessageUpdateCommand(
                revision=message.revision,
                document_revision=message.body.revision,
                markdown="## Edited in Q&A\n\nKeep  spaces around $w$.",
            ),
        )
        workspace = repo.get_workspace(connection, course)
        note = workspace.notes[0]
        assert "Keep  spaces around $w$." in note.document.markdown
        repo.upsert_note(
            connection,
            NoteUpsertCommand(
                course_id=course,
                entity_type="task",
                entity_id=task,
                kind="task",
                note_id=note.id,
                note_revision=note.revision,
                document_revision=note.document.revision,
                markdown=note.document.markdown.replace(
                    "Keep  spaces", "Edited in task note: keep  spaces"
                ),
            ),
        )
        message = repo.get_workspace(connection, course).discussions[0].messages[-1]
        assert "Edited in task note" in message.body.markdown
        repo.delete_discussion_message(
            connection, message.id, DiscussionMessageDeleteCommand(revision=message.revision)
        )
        assert not review_blocks(repo.get_workspace(connection, course).notes[0].document.markdown)


def test_original_work_snapshot_and_delete_from_note(tmp_path: Path) -> None:
    course = seed(tmp_path)
    task = task_id()
    with transaction() as connection:
        repo.upsert_note(
            connection,
            NoteUpsertCommand(
                course_id=course,
                entity_type="task",
                entity_id=task,
                kind="task",
                markdown="My closed-book answer: $G_t$.",
            ),
        )
        note = repo.get_workspace(connection, course).notes[0]
    with transaction() as connection:
        result = import_task_review(
            connection,
            task,
            command(
                note_id=note.id,
                note_revision=note.revision,
                document_revision=note.document.revision,
            ),
        )
    with transaction() as connection:
        workspace = repo.get_workspace(connection, course)
        root = next(a for a in workspace.annotations if a.id == result.question_id)
        assert "My closed-book answer: $G_t$." in root.body.markdown
        note = workspace.notes[0]
        repo.upsert_note(
            connection,
            NoteUpsertCommand(
                course_id=course,
                entity_type="task",
                entity_id=task,
                kind="task",
                note_id=note.id,
                note_revision=note.revision,
                document_revision=note.document.revision,
                markdown=original_note(note.document.markdown),
            ),
        )
        assert not repo.get_workspace(connection, course).annotations
        assert not connection.execute(
            text("SELECT id FROM discussion_messages WHERE id=:id AND deleted_at IS NULL"),
            {"id": result.message_id},
        ).first()


def test_stale_note_and_invalid_question_roll_back_everything(tmp_path: Path) -> None:
    course = seed(tmp_path)
    task = task_id()
    before = snapshot()
    with pytest.raises(repo.WorkspaceRepositoryError), transaction() as connection:
        import_task_review(
            connection,
            task,
            command(
                answers=[
                    DiscussionAnswerImportItem(
                        markdown="## Q-001\nAnswer",
                        annotation_links=[
                            DiscussionMessageAnnotationInput(
                                annotation_id="does-not-exist", relation="references"
                            )
                        ],
                    )
                ]
            ),
        )
    assert snapshot() == before
    with transaction() as connection:
        repo.upsert_note(
            connection,
            NoteUpsertCommand(
                course_id=course,
                entity_type="task",
                entity_id=task,
                kind="task",
                markdown="An independently saved note",
            ),
        )
    before = snapshot()
    with pytest.raises(repo.RevisionConflictError), transaction() as connection:
        import_task_review(connection, task, command())
    assert snapshot() == before


def test_malformed_or_foreign_boundary_is_rejected_without_losing_note(tmp_path: Path) -> None:
    course = seed(tmp_path)
    task = task_id()
    with transaction() as connection:
        import_task_review(connection, task, command())
        note = repo.get_workspace(connection, course).notes[0]
    before = snapshot()
    with (
        pytest.raises(repo.WorkspaceRepositoryError, match="boundary"),
        transaction() as connection,
    ):
        repo.upsert_note(
            connection,
            NoteUpsertCommand(
                course_id=course,
                entity_type="task",
                entity_id=task,
                kind="task",
                note_id=note.id,
                note_revision=note.revision,
                document_revision=note.document.revision,
                markdown=note.document.markdown.replace(
                    "<!-- /tutor-review:", "<!-- /tutor-review:broken-"
                ),
            ),
        )
    assert snapshot() == before


def test_markers_inside_fenced_code_are_literal() -> None:
    markdown = "```md\n<!-- tutor-review:example -->\n```\n\nMy answer."
    assert review_blocks(markdown) == []
    assert original_note(markdown) == markdown


def test_resource_free_task_notes_create_direct_questions(tmp_path: Path) -> None:
    course = seed(tmp_path)
    with transaction() as connection:
        task = str(
            connection.execute(
                text("SELECT id FROM tasks WHERE title LIKE 'Write a summary%' ")
            ).scalar_one()
        )
        repo.upsert_note(
            connection,
            NoteUpsertCommand(
                course_id=course,
                entity_type="task",
                entity_id=task,
                kind="task",
                markdown="Why is the baseline unbiased??",
            ),
        )
        workspace = repo.get_workspace(connection, course)
        annotation = next(a for a in workspace.annotations if a.origin == "note_marker")
        assert annotation.anchor.metadata["sourceNoteId"] == workspace.notes[0].id
        assert (
            next(r for r in workspace.resources if r.id == annotation.resource_id).title
            == "Task notes"
        )


def test_multiple_reviews_and_discussion_deletion_keep_the_note_consistent(tmp_path: Path) -> None:
    course = seed(tmp_path)
    task = task_id()
    with transaction() as connection:
        first = import_task_review(connection, task, command())
        note = repo.get_workspace(connection, course).notes[0]
    with transaction() as connection:
        second = import_task_review(
            connection,
            task,
            TaskTutorReviewCommand(
                import_id="second-import",
                discussion_id=first.discussion_id,
                note_id=note.id,
                note_revision=note.revision,
                document_revision=note.document.revision,
                review_markdown="Second review: $G_t$.",
            ),
        )
        workspace = repo.get_workspace(connection, course)
        root = next(a for a in workspace.annotations if a.id == second.question_id)
        assert "Feedback" not in root.body.markdown
        assert len(review_blocks(workspace.notes[0].document.markdown)) == 2
    with transaction() as connection:
        workspace = repo.get_workspace(connection, course)
        message = next(m for m in workspace.discussions[0].messages if m.id == first.message_id)
        repo.delete_discussion_answer(
            connection,
            message.id,
            DiscussionAnswerDeleteCommand(
                revision=message.revision,
                document_revision=message.body.revision,
                markdown="",
                question_ids=[first.question_id],
            ),
        )
        workspace = repo.get_workspace(connection, course)
        assert [b.message_id for b in review_blocks(workspace.notes[0].document.markdown)] == [
            second.message_id
        ]
        discussion = workspace.discussions[0]
        repo.delete_discussion(
            connection, discussion.id, DiscussionDeleteCommand(revision=discussion.revision)
        )
        assert not review_blocks(repo.get_workspace(connection, course).notes[0].document.markdown)
