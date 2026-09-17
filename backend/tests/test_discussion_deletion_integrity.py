from pathlib import Path

import pytest
from sqlalchemy import text
from test_workspace_mutations import _seed_course, isolated_database  # noqa: F401

from tracker_api.database import transaction
from tracker_api.repositories import workspace_repository as repo
from tracker_api.schemas.workspace import (
    AnnotationCommand,
    AnnotationCreateCommand,
    DiscussionAnswerDeleteCommand,
    DiscussionCreateCommand,
    DiscussionDeleteCommand,
    DiscussionMessageCreateCommand,
    DiscussionMessageDeleteCommand,
)


def seed(tmp_path: Path, second_answer: bool = False):
    course, resource = _seed_course(tmp_path)
    with transaction() as db:
        question = repo.create_annotation(
            db, AnnotationCreateCommand(resource_id=resource, kind="question", markdown="Why?")
        )
        thread = repo.create_discussion(
            db, DiscussionCreateCommand(course_id=course, source_resource_id=resource)
        )
        for _ in range(2 if second_answer else 1):
            repo.create_discussion_message(
                db,
                thread.id,
                DiscussionMessageCreateCommand(
                    role="assistant",
                    markdown="## Explanation\n\nUseful answer.",
                    annotation_links=[{"annotation_id": question.id, "relation": "answers"}],
                ),
            )
    return course, question.id


@pytest.mark.parametrize("archive", [False, True])
def test_final_answer_removes_shell_preserves_history_and_applies_question_choice(
    tmp_path, archive
):
    course, question = seed(tmp_path)
    with transaction() as db:
        message = repo.get_workspace(db, course).discussions[0].messages[0]
        repo.delete_discussion_answer(
            db,
            message.id,
            DiscussionAnswerDeleteCommand(
                revision=message.revision,
                document_revision=message.body.revision,
                markdown="",
                question_ids=[question],
                archive_questions=archive,
            ),
        )
        workspace = repo.get_workspace(db, course)
        assert workspace.discussions[0].messages == []
        assert next(a for a in workspace.annotations if a.id == question).status == (
            "archived" if archive else "open"
        )
        assert (
            db.execute(
                text("SELECT markdown FROM documents WHERE id=:id"), {"id": message.body.id}
            ).scalar_one()
            == message.body.markdown
        )


@pytest.mark.parametrize("stale_document", [False, True])
def test_final_answer_requires_both_revisions(tmp_path, stale_document):
    course, _ = seed(tmp_path)
    with transaction() as db:
        message = repo.get_workspace(db, course).discussions[0].messages[0]
    with pytest.raises(repo.RevisionConflictError), transaction() as db:
        repo.delete_discussion_answer(
            db,
            message.id,
            DiscussionAnswerDeleteCommand(
                revision=message.revision + (not stale_document),
                document_revision=message.body.revision + stale_document,
                markdown="",
            ),
        )
    with transaction() as db:
        assert len(repo.get_workspace(db, course).discussions[0].messages) == 1


def test_remaining_canonical_answer_preserves_understood_and_archive_stays_archived(tmp_path):
    course, question = seed(tmp_path, second_answer=True)
    with transaction() as db:
        messages = repo.get_workspace(db, course).discussions[0].messages
        repo.delete_discussion_message(
            db, messages[0].id, DiscussionMessageDeleteCommand(revision=messages[0].revision)
        )
        annotation = next(a for a in repo.get_workspace(db, course).annotations if a.id == question)
        assert annotation.status == "answered"
        repo.update_annotation(
            db, question, AnnotationCommand(revision=annotation.revision, status="archived")
        )
        repo.delete_discussion_message(
            db, messages[1].id, DiscussionMessageDeleteCommand(revision=messages[1].revision)
        )
        assert (
            next(a for a in repo.get_workspace(db, course).annotations if a.id == question).status
            == "archived"
        )


def test_deleting_thread_reconciles_questions_and_removes_message_links(tmp_path):
    course, question = seed(tmp_path, second_answer=True)
    with transaction() as db:
        thread = repo.get_workspace(db, course).discussions[0]
        repo.delete_discussion(db, thread.id, DiscussionDeleteCommand(revision=thread.revision))
        workspace = repo.get_workspace(db, course)
        assert not workspace.discussions
        assert next(a for a in workspace.annotations if a.id == question).status == "open"
        assert not db.execute(text("SELECT 1 FROM discussion_message_annotations")).first()


def test_historical_cleanup_only_retires_unlinked_empty_shells(tmp_path):
    course, question = seed(tmp_path)
    migration = (
        Path(__file__).parents[1]
        / "tracker_api/migrations/0025_retire_empty_discussion_messages.sql"
    )
    with transaction() as db:
        thread = repo.get_workspace(db, course).discussions[0]
        linked = thread.messages[0]
        shell = repo.create_discussion_message(
            db, thread.id, DiscussionMessageCreateCommand(role="assistant", markdown="temporary")
        )
        # Reproduce the former final-section delete, retaining document history.
        db.execute(
            text(
                "UPDATE documents SET markdown='', plain_text='', editor_json=NULL "
                "WHERE id IN (SELECT body_document_id FROM discussion_messages "
                "WHERE id IN (:a,:b))"
            ),
            {"a": shell.id, "b": linked.id},
        )
        db.execute(text(migration.read_text()))
        after = repo.get_workspace(db, course)
        assert [m.id for m in after.discussions[0].messages] == [linked.id]
        assert next(a for a in after.annotations if a.id == question).status == "answered"
        assert (
            db.execute(
                text(
                    "SELECT count(*) FROM document_revisions WHERE document_id="
                    "(SELECT body_document_id FROM discussion_messages WHERE id=:id)"
                ),
                {"id": shell.id},
            ).scalar_one()
            > 0
        )
