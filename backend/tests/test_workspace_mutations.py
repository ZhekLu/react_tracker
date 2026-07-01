from __future__ import annotations

import subprocess
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import text

from tracker_api.config import get_settings
from tracker_api.database import get_engine, transaction
from tracker_api.repositories.workspace_repository import (
    create_annotation,
    create_discussion,
    create_discussion_message,
    create_prompt_batch,
    delete_discussion,
    get_workspace,
    link_discussion_question,
    resource_content_target,
    update_annotation,
    update_resource_progress,
)
from tracker_api.schemas.workspace import (
    AnnotationAnchorCreate,
    AnnotationCommand,
    AnnotationCreateCommand,
    DiscussionCreateCommand,
    DiscussionDeleteCommand,
    DiscussionMessageCreateCommand,
    DiscussionQuestionLinkCommand,
    PromptBatchCreateCommand,
    ResourceProgressCommand,
)
from tracker_api.services.resource_content_service import read_resource_content
from tracker_api.services.resource_open_service import ResourceOpenError, open_resource
from tracker_api.services.study_plan_service import sync_study_plan


@pytest.fixture(autouse=True)
def isolated_database(
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


def _seed_course(tmp_path: Path) -> tuple[str, str]:
    (tmp_path / "paper.txt").write_text(
        "Coverage assumption\n\nWhy it matters.",
        encoding="utf-8",
    )
    plan_path = tmp_path / "plan.md"
    plan_path.write_text(
        """
+++
format = "study-plan/v1"
id = "mutation_course"
title = "Mutation Course"
mode = "full"

[resources.paper]
title = "Paper"
path = "paper.txt"
kind = "paper"
+++

# Mutation Course

### Day 1: 2026-07-01 - Read {#day-01}

#### Reading

- [ ] Read the paper. {#read-paper resources=paper}

Stop when: the paper is read. {#day01-stop}
""".lstrip(),
        encoding="utf-8",
    )
    result = sync_study_plan(plan_path)
    with transaction() as connection:
        resource_id = connection.execute(
            text(
                """
                SELECT entity_id
                FROM source_bindings
                WHERE entity_type = 'resource'
                  AND source_key = 'mutation_course:paper'
                LIMIT 1
                """
            )
        ).scalar_one()
    return result.course_id, str(resource_id)


def test_configured_pdf_application_is_used_without_system_fallback(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pdf_path = tmp_path / "paper.pdf"
    pdf_path.write_bytes(b"%PDF-1.4")
    config_path = get_settings().helper_config_path
    config_path.write_text(
        (
            '{"open_allowed_roots": ["'
            f'{tmp_path}"], "pdf_app": "Drawboard PDF"'
            "}"
        ),
        encoding="utf-8",
    )
    calls: list[list[str]] = []

    def fail_open(command: list[str], **_kwargs: object) -> None:
        calls.append(command)
        raise subprocess.CalledProcessError(
            returncode=1,
            cmd=command,
            stderr="application not found",
        )

    monkeypatch.setattr(subprocess, "run", fail_open)
    with pytest.raises(ResourceOpenError, match="Drawboard PDF"):
        open_resource(local_path=str(pdf_path), source_url=None)

    assert calls == [["open", "-a", "Drawboard PDF", str(pdf_path)]]


def test_pdf_annotation_import_is_idempotent_and_prompt_snapshot_is_saved(
    tmp_path: Path,
) -> None:
    course_id, resource_id = _seed_course(tmp_path)
    command = AnnotationCreateCommand(
        resource_id=resource_id,
        kind="question",
        origin="pdf_import",
        external_id="pdf-fingerprint",
        source_fingerprint="pdf-fingerprint",
        markdown="Why is this assumption needed?",
        plain_text="Why is this assumption needed?",
        anchor=AnnotationAnchorCreate(
            anchor_type="pdf_rect",
            quote="Coverage assumption",
            page_number=7,
            rect=[10.0, 20.0, 30.0, 40.0],
            color="red",
            annotation_kind="Highlight",
        ),
    )
    with transaction() as connection:
        first = create_annotation(connection, command)
        second = create_annotation(connection, command)
        prompt = create_prompt_batch(
            connection,
            PromptBatchCreateCommand(
                course_id=course_id,
                title="Question batch",
                source_scope="course_questions",
                markdown="# Questions\n\nWhy is this assumption needed?",
                annotation_ids=[first.id],
            ),
        )

    assert second.id == first.id
    with transaction() as connection:
        annotation_count = connection.execute(
            text(
                """
                SELECT COUNT(*)
                FROM annotations
                WHERE resource_id = :resource_id
                  AND source_fingerprint = 'pdf-fingerprint'
                """
            ),
            {"resource_id": resource_id},
        ).scalar_one()
        prompt_item = connection.execute(
            text(
                """
                SELECT question_label, quote_snapshot, question_snapshot_markdown
                FROM prompt_batch_items
                WHERE prompt_batch_id = :prompt_batch_id
                """
            ),
            {"prompt_batch_id": prompt.id},
        ).mappings().one()
    assert annotation_count == 1
    assert prompt_item["question_label"] == "Q-001"
    assert prompt_item["quote_snapshot"] == "Coverage assumption"
    assert prompt_item["question_snapshot_markdown"] == (
        "Why is this assumption needed?"
    )


def test_reader_content_and_progress_are_persisted(tmp_path: Path) -> None:
    _course_id, resource_id = _seed_course(tmp_path)
    with transaction() as connection:
        _title, _version_id, local_path = resource_content_target(
            connection,
            resource_id,
        )
        first = update_resource_progress(
            connection,
            resource_id,
            ResourceProgressCommand(progress_percent=35, position={"scrollTop": 100}),
        )
        second = update_resource_progress(
            connection,
            resource_id,
            ResourceProgressCommand(progress_percent=72, position={"scrollTop": 300}),
        )

    assert local_path is not None
    content = read_resource_content(local_path)
    assert content.format == "text"
    assert "Coverage assumption" in content.content
    assert first.id == second.id
    assert second.revision == 2
    with transaction() as connection:
        row = connection.execute(
            text(
                """
                SELECT progress_percent, position_json
                FROM resource_reading_progress
                WHERE id = :id
                """
            ),
            {"id": second.id},
        ).mappings().one()
    assert row["progress_percent"] == 72
    assert '"scrollTop":300' in row["position_json"]


def test_prompt_discussion_tracks_question_coverage_and_answer_state(
    tmp_path: Path,
) -> None:
    course_id, resource_id = _seed_course(tmp_path)
    with transaction() as connection:
        question = create_annotation(
            connection,
            AnnotationCreateCommand(
                resource_id=resource_id,
                kind="question",
                markdown=r"Why does $V^\pi$ require support?",
                plain_text="Why does V-pi require support?",
            ),
        )
        batch = create_prompt_batch(
            connection,
            PromptBatchCreateCommand(
                course_id=course_id,
                title="Support question",
                source_scope="resource_questions",
                source_resource_id=resource_id,
                markdown=r"# Question\n\nWhy does $V^\pi$ require support?",
                annotation_ids=[question.id],
            ),
        )
        discussion = create_discussion(
            connection,
            DiscussionCreateCommand(
                course_id=course_id,
                source_resource_id=resource_id,
                initial_prompt_batch_id=batch.id,
            ),
        )
        assistant = create_discussion_message(
            connection,
            discussion.id,
            DiscussionMessageCreateCommand(
                role="assistant",
                markdown=r"Because $\pi(a|s)>0$ must overlap with the logger.",
                imported_from_clipboard=True,
                link_prompt_questions=True,
            ),
        )
        before = get_workspace(connection, course_id)
        link_discussion_question(
            connection,
            assistant.id,
            question.id,
            DiscussionQuestionLinkCommand(relation="answers"),
        )
        followup = create_annotation(
            connection,
            AnnotationCreateCommand(
                resource_id=before.discussions[0].resource_id,
                kind="question",
                markdown="What changes under weak overlap?",
                anchor=AnnotationAnchorCreate(
                    anchor_type="discussion_message",
                    discussion_message_id=assistant.id,
                    quote="overlap with the logger",
                ),
            ),
        )
        after = get_workspace(connection, course_id)

    thread = before.discussions[0]
    assert thread.resource_id != resource_id
    assert thread.source_resource_ids == [resource_id]
    assert thread.question_ids == [question.id]
    assert thread.messages[0].role == "user"
    assert thread.messages[0].annotation_links[0].relation == "generated_from"
    assert thread.messages[1].imported_from_clipboard is True
    assert thread.messages[1].annotation_links[0].relation == "references"
    answered = next(item for item in after.annotations if item.id == question.id)
    assert answered.status == "answered"
    answered_message = after.discussions[0].messages[1]
    assert answered_message.annotation_links[0].relation == "answers"
    assert followup.id in after.discussions[0].question_ids


def test_deleting_discussion_soft_deletes_thread_resource_and_messages(
    tmp_path: Path,
) -> None:
    course_id, resource_id = _seed_course(tmp_path)
    with transaction() as connection:
        discussion = create_discussion(
            connection,
            DiscussionCreateCommand(
                course_id=course_id,
                source_resource_id=resource_id,
            ),
        )
        create_discussion_message(
            connection,
            discussion.id,
            DiscussionMessageCreateCommand(
                role="assistant",
                markdown="A disposable answer.",
            ),
        )
        before = get_workspace(connection, course_id)
        generated_resource_id = before.discussions[0].resource_id
        deleted = delete_discussion(
            connection,
            discussion.id,
            DiscussionDeleteCommand(revision=before.discussions[0].revision),
        )
        after = get_workspace(connection, course_id)
        rows = connection.execute(
            text(
                """
                SELECT
                  dt.deleted_at AS thread_deleted_at,
                  r.deleted_at AS resource_deleted_at,
                  dm.deleted_at AS message_deleted_at
                FROM discussion_threads dt
                JOIN resources r ON r.id = dt.resource_id
                JOIN discussion_messages dm ON dm.thread_id = dt.id
                WHERE dt.id = :discussion_id
                """
            ),
            {"discussion_id": discussion.id},
        ).mappings().one()

    assert deleted.revision == before.discussions[0].revision + 1
    assert after.discussions == []
    assert all(item.id != generated_resource_id for item in after.resources)
    assert rows["thread_deleted_at"]
    assert rows["resource_deleted_at"]
    assert rows["message_deleted_at"]


def test_question_body_can_be_edited_with_document_revision(tmp_path: Path) -> None:
    course_id, resource_id = _seed_course(tmp_path)
    with transaction() as connection:
        created = create_annotation(
            connection,
            AnnotationCreateCommand(
                resource_id=resource_id,
                kind="question",
                markdown="Original question",
            ),
        )
        workspace = get_workspace(connection, course_id)
        question = next(item for item in workspace.annotations if item.id == created.id)
        assert question.body is not None
        update_annotation(
            connection,
            question.id,
            AnnotationCommand(
                revision=question.revision,
                markdown=r"Updated question with $\rho(s, a)$",
                plain_text="Updated question with rho",
                document_revision=question.body.revision,
                priority="high",
            ),
        )
        updated_workspace = get_workspace(connection, course_id)

    updated = next(
        item for item in updated_workspace.annotations if item.id == created.id
    )
    assert updated.priority == "high"
    assert updated.body is not None
    assert updated.body.markdown == r"Updated question with $\rho(s, a)$"
