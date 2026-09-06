from __future__ import annotations

import re
import subprocess
from collections.abc import Iterator
from pathlib import Path

import pymupdf
import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from tracker_api.config import get_settings
from tracker_api.database import get_engine, transaction
from tracker_api.repositories.workspace_repository import (
    WorkspaceRepositoryError,
    create_annotation,
    create_discussion,
    create_discussion_message,
    create_prompt_batch,
    delete_discussion,
    delete_discussion_answer,
    delete_discussion_message,
    get_workspace,
    import_discussion_answers,
    link_discussion_question,
    reconcile_toggl_entries,
    record_toggl_start,
    resource_content_target,
    review_discussion_message,
    review_discussion_qa,
    toggl_task_id,
    toggl_task_totals,
    update_annotation,
    update_discussion_message,
    update_resource_chapter_progress,
    update_resource_progress,
    upsert_note,
)
from tracker_api.schemas.workspace import (
    AnnotationAnchorCreate,
    AnnotationCommand,
    AnnotationCreateCommand,
    DiscussionAnswerDeleteCommand,
    DiscussionAnswerImportCommand,
    DiscussionAnswerImportItem,
    DiscussionCreateCommand,
    DiscussionDeleteCommand,
    DiscussionMessageCreateCommand,
    DiscussionMessageDeleteCommand,
    DiscussionMessageReviewCommand,
    DiscussionMessageUpdateCommand,
    DiscussionQaReviewCommand,
    DiscussionQuestionLinkCommand,
    DiscussionReviewItem,
    NoteUpsertCommand,
    PromptBatchCreateCommand,
    ResourceChapterProgressCommand,
    ResourceProgressCommand,
)
from tracker_api.services.lecture_note_image_service import import_image_questions
from tracker_api.services.pdf_annotation_service import collect_resource_pdf_annotations
from tracker_api.services.pdf_ink_image_service import annotation_image_path
from tracker_api.services.prompt_attachment_service import preview_prompt_attachments
from tracker_api.services.prompt_batch_service import (
    create_prompt_batch as create_prompt_batch_with_attachments,
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
    monkeypatch.setenv(
        "TRACKER_ANNOTATION_IMAGE_DIR",
        str(tmp_path / "annotation-images"),
    )
    monkeypatch.setenv(
        "TRACKER_CHATGPT_ATTACHMENT_DIR",
        str(tmp_path / "chatgpt-attachments"),
    )
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
    (tmp_path / "slides.txt").write_text(
        "Bellman equations\n\nDynamic programming.",
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

[resources.slides]
title = "Slides"
path = "slides.txt"
kind = "slides"
+++

# Mutation Course

### Day 1: 2026-07-01 - Read {#day-01}

#### Reading

- [ ] Read the paper and slides. {#read-paper resources="paper,slides"}

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


def test_day_prompt_discussion_links_every_day_resource(tmp_path: Path) -> None:
    course_id, resource_id = _seed_course(tmp_path)
    with transaction() as connection:
        day_id = str(
            connection.execute(
                text(
                    """
                    SELECT id
                    FROM study_days
                    WHERE course_id = :course_id
                    """
                ),
                {"course_id": course_id},
            ).scalar_one()
        )
        question = create_annotation(
            connection,
            AnnotationCreateCommand(
                resource_id=resource_id,
                kind="question",
                markdown="How do both sources explain the backup?",
            ),
        )
        batch = create_prompt_batch(
            connection,
            PromptBatchCreateCommand(
                course_id=course_id,
                title="Day discussion",
                source_scope="day_status",
                source_day_id=day_id,
                markdown="# Day questions",
                annotation_ids=[question.id],
            ),
        )
        create_discussion(
            connection,
            DiscussionCreateCommand(
                course_id=course_id,
                initial_prompt_batch_id=batch.id,
            ),
        )
        workspace = get_workspace(connection, course_id)

    source_titles = {
        resource.title
        for resource in workspace.resources
        if resource.id in workspace.discussions[0].source_resource_ids
    }
    assert source_titles == {"Paper", "Slides"}
    assert workspace.discussions[0].scope_type == "day"
    assert workspace.discussions[0].source_day_id == day_id


def test_resource_question_discussion_exposes_explicit_scope(tmp_path: Path) -> None:
    course_id, resource_id = _seed_course(tmp_path)
    with transaction() as connection:
        question = create_annotation(
            connection,
            AnnotationCreateCommand(
                resource_id=resource_id,
                kind="question",
                markdown="A resource-wide question",
            ),
        )
        batch = create_prompt_batch(
            connection,
            PromptBatchCreateCommand(
                course_id=course_id,
                title="Paper questions",
                source_scope="resource_questions",
                source_resource_id=resource_id,
                markdown="# Paper questions",
                annotation_ids=[question.id],
            ),
        )
        created = create_discussion(
            connection,
            DiscussionCreateCommand(
                course_id=course_id,
                source_resource_id=resource_id,
                initial_prompt_batch_id=batch.id,
            ),
        )
        workspace = get_workspace(connection, course_id)

    discussion = next(item for item in workspace.discussions if item.id == created.id)
    assert discussion.scope_type == "resource"
    assert discussion.source_day_id is None
    assert discussion.source_resource_ids == [resource_id]


def test_toggl_task_binding_tracks_time_by_stable_task_id(tmp_path: Path) -> None:
    course_id, _resource_id = _seed_course(tmp_path)
    with transaction() as connection:
        task = connection.execute(
            text(
                """
                SELECT t.id AS task_id, t.day_id
                FROM tasks t
                JOIN study_days d ON d.id = t.day_id
                WHERE d.course_id = :course_id AND t.deleted_at IS NULL
                ORDER BY t.order_index
                LIMIT 1
                """
            ),
            {"course_id": course_id},
        ).mappings().one()
        task_id = str(task["task_id"])
        day_id = str(task["day_id"])
        record_toggl_start(
            connection,
            course_id=course_id,
            day_id=day_id,
            task_id=task_id,
            external_id="toggl-42",
            description="[Mutation] Day 1. Read paper",
            started_at="2026-07-01T10:00:00Z",
        )
        connection.execute(
            text(
                """
                UPDATE time_entries
                SET stopped_at = '2026-07-01T10:30:00Z'
                WHERE provider = 'toggl' AND external_id = 'toggl-42'
                """
            )
        )

        assert toggl_task_id(connection, "toggl-42") == task_id
        assert toggl_task_totals(connection)[task_id] == 1800


def test_toggl_reconciliation_applies_remote_edits_and_deletions(
    tmp_path: Path,
) -> None:
    course_id, _resource_id = _seed_course(tmp_path)
    with transaction() as connection:
        task = connection.execute(
            text(
                """
                SELECT t.id AS task_id, t.day_id
                FROM tasks t
                JOIN study_days d ON d.id = t.day_id
                WHERE d.course_id = :course_id AND t.deleted_at IS NULL
                LIMIT 1
                """
            ),
            {"course_id": course_id},
        ).mappings().one()
        task_id = str(task["task_id"])
        day_id = str(task["day_id"])
        for external_id, started_at, stopped_at in (
            ("toggl-edited", "2026-07-01T10:00:00Z", "2026-07-01T10:30:00Z"),
            ("toggl-deleted", "2026-07-01T11:00:00Z", "2026-07-01T11:15:00Z"),
        ):
            record_toggl_start(
                connection,
                course_id=course_id,
                day_id=day_id,
                task_id=task_id,
                external_id=external_id,
                description="[Mutation] Day 1. Read paper",
                started_at=started_at,
            )
            connection.execute(
                text(
                    """
                    UPDATE time_entries
                    SET stopped_at = :stopped_at
                    WHERE provider = 'toggl' AND external_id = :external_id
                    """
                ),
                {"external_id": external_id, "stopped_at": stopped_at},
            )

        assert toggl_task_totals(connection)[task_id] == 2700
        reconcile_toggl_entries(
            connection,
            [
                {
                    "description": "[Mutation] Day 1. Read edited paper",
                    "duration_seconds": 600,
                    "external_id": "toggl-edited",
                    "payload": {"id": "toggl-edited", "duration": 600},
                    "started_at": "2026-07-01T10:05:00Z",
                    "stopped_at": "2026-07-01T10:15:00Z",
                }
            ],
            window_start="2026-07-01T00:00:00Z",
        )

        assert toggl_task_totals(connection)[task_id] == 600
        remaining = connection.execute(
            text(
                """
                SELECT external_id, description, started_at, stopped_at,
                       duration_override_seconds
                FROM time_entries
                WHERE provider = 'toggl'
                """
            )
        ).mappings().all()
        assert [row["external_id"] for row in remaining] == ["toggl-edited"]
        assert remaining[0]["description"].endswith("edited paper")
        assert remaining[0]["started_at"] == "2026-07-01T10:05:00Z"
        assert remaining[0]["stopped_at"] == "2026-07-01T10:15:00Z"
        assert remaining[0]["duration_override_seconds"] == 600
        assert connection.execute(
            text(
                """
                SELECT COUNT(*)
                FROM integration_sync_states
                WHERE integration = 'toggl'
                  AND last_successful_sync_at IS NOT NULL
                """
            )
        ).scalar_one() == 1


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


def test_question_identity_is_immutable_and_shared_by_context_group(
    tmp_path: Path,
) -> None:
    course_id, resource_id = _seed_course(tmp_path)
    with transaction() as connection:
        first = create_annotation(
            connection,
            AnnotationCreateCommand(
                resource_id=resource_id,
                kind="question",
                markdown="First capture",
                anchor=AnnotationAnchorCreate(
                    page_number=4,
                    metadata={"contextGroupId": "shared-question"},
                ),
            ),
        )
        second = create_annotation(
            connection,
            AnnotationCreateCommand(
                resource_id=resource_id,
                kind="question",
                markdown="Second capture",
                anchor=AnnotationAnchorCreate(
                    page_number=4,
                    metadata={"contextGroupId": "shared-question"},
                ),
            ),
        )
        third = create_annotation(
            connection,
            AnnotationCreateCommand(
                resource_id=resource_id,
                kind="question",
                markdown="Independent question",
                anchor=AnnotationAnchorCreate(page_number=5),
            ),
        )
        workspace = get_workspace(connection, course_id)
        by_id = {annotation.id: annotation for annotation in workspace.annotations}
        batch = create_prompt_batch(
            connection,
            PromptBatchCreateCommand(
                course_id=course_id,
                title="Stable labels",
                source_scope="course_questions",
                markdown="# Questions",
                annotation_ids=[first.id, second.id, third.id],
                question_labels={
                    first.id: by_id[first.id].stable_label or "",
                    second.id: by_id[second.id].stable_label or "",
                    third.id: by_id[third.id].stable_label or "",
                },
            ),
        )
        prompt_labels = connection.execute(
            text(
                """
                SELECT annotation_id, question_label
                FROM prompt_batch_items
                WHERE prompt_batch_id = :batch_id
                ORDER BY order_index
                """
            ),
            {"batch_id": batch.id},
        ).mappings().all()

    assert by_id[first.id].stable_label == by_id[second.id].stable_label
    assert by_id[first.id].stable_label != by_id[third.id].stable_label
    assert re.fullmatch(r"Q-p[0-9a-f]{6}-00-001", by_id[first.id].stable_label or "")
    assert re.fullmatch(r"Q-p[0-9a-f]{6}-00-002", by_id[third.id].stable_label or "")
    assert [row["question_label"] for row in prompt_labels] == [
        by_id[first.id].stable_label,
        by_id[second.id].stable_label,
        by_id[third.id].stable_label,
    ]

    with pytest.raises(IntegrityError, match="question identity is immutable"):
        with transaction() as connection:
            connection.execute(
                text(
                    """
                    UPDATE question_identities
                    SET readable_label = 'Q-illegal-00-999'
                    WHERE readable_label = :readable_label
                    """
                ),
                {"readable_label": by_id[first.id].stable_label},
            )

    with pytest.raises(
        IntegrityError,
        match="annotation question identity is immutable",
    ):
        with transaction() as connection:
            connection.execute(
                text(
                    """
                    UPDATE annotation_question_identities
                    SET question_identity_id = (
                      SELECT question_identity_id
                      FROM annotation_question_identities
                      WHERE annotation_id = :replacement_annotation_id
                    )
                    WHERE annotation_id = :annotation_id
                    """
                ),
                {
                    "annotation_id": first.id,
                    "replacement_annotation_id": third.id,
                },
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
    assert len(thread.question_labels) == 1
    assert thread.question_labels[0].label == "Q-001"
    assert thread.question_labels[0].annotation_ids == [question.id]
    assert len(thread.messages) == 1
    assert thread.messages[0].role == "assistant"
    assert thread.messages[0].imported_from_clipboard is True
    assert thread.messages[0].annotation_links[0].relation == "references"
    answered = next(item for item in after.annotations if item.id == question.id)
    assert answered.status == "answered"
    answered_message = after.discussions[0].messages[0]
    assert answered_message.annotation_links[0].relation == "answers"
    assert followup.id in after.discussions[0].question_ids


def test_discussion_accepts_continuation_prompt_batches_with_stable_labels(
    tmp_path: Path,
) -> None:
    course_id, resource_id = _seed_course(tmp_path)
    with transaction() as connection:
        questions = [
            create_annotation(
                connection,
                AnnotationCreateCommand(
                    resource_id=resource_id,
                    kind="question",
                    markdown=markdown,
                    plain_text=markdown,
                ),
            )
            for markdown in ("First question", "Next task question")
        ]
        initial = create_prompt_batch(
            connection,
            PromptBatchCreateCommand(
                course_id=course_id,
                title="Day prompt",
                source_scope="day",
                markdown="# Q-001\n\nFirst question",
                annotation_ids=[questions[0].id],
                question_labels={questions[0].id: "Q-001"},
            ),
        )
        discussion = create_discussion(
            connection,
            DiscussionCreateCommand(
                course_id=course_id,
                source_resource_id=resource_id,
                initial_prompt_batch_id=initial.id,
            ),
        )
        continuation = create_prompt_batch(
            connection,
            PromptBatchCreateCommand(
                course_id=course_id,
                title="Next task questions",
                source_scope="task_questions_continuation",
                source_resource_id=resource_id,
                parent_discussion_thread_id=discussion.id,
                question_label_start=2,
                markdown="# Q-002\n\nNext task question",
                annotation_ids=[questions[1].id],
                question_labels={questions[1].id: "Q-002"},
            ),
        )
        repeated = create_prompt_batch(
            connection,
            PromptBatchCreateCommand(
                course_id=course_id,
                title="Repeated next task questions",
                source_scope="task_questions_continuation",
                source_resource_id=resource_id,
                parent_discussion_thread_id=discussion.id,
                question_label_start=99,
                markdown="# Q-002\n\nNext task question",
                annotation_ids=[questions[1].id],
                question_labels={questions[1].id: "Q-002"},
            ),
        )
        workspace = get_workspace(connection, course_id)
        rows = connection.execute(
            text(
                """
                SELECT id, parent_discussion_thread_id
                FROM prompt_batches
                WHERE id IN (:initial_id, :continuation_id, :repeated_id)
                ORDER BY id
                """
            ),
            {
                "initial_id": initial.id,
                "continuation_id": continuation.id,
                "repeated_id": repeated.id,
            },
        ).mappings().all()

    thread = workspace.discussions[0]
    assert thread.question_ids == [questions[0].id, questions[1].id]
    assert [item.label for item in thread.question_labels] == ["Q-001", "Q-002"]
    assert [item.annotation_ids for item in thread.question_labels] == [
        [questions[0].id],
        [questions[1].id],
    ]
    assert {str(row["parent_discussion_thread_id"]) for row in rows} == {
        discussion.id
    }


def test_continuation_rejects_a_label_owned_by_another_question(
    tmp_path: Path,
) -> None:
    course_id, resource_id = _seed_course(tmp_path)
    with transaction() as connection:
        questions = [
            create_annotation(
                connection,
                AnnotationCreateCommand(
                    resource_id=resource_id,
                    kind="question",
                    markdown=markdown,
                ),
            )
            for markdown in ("First", "Second")
        ]
        initial = create_prompt_batch(
            connection,
            PromptBatchCreateCommand(
                course_id=course_id,
                title="Day prompt",
                source_scope="day",
                markdown="# Q-001\n\nFirst",
                annotation_ids=[questions[0].id],
                question_labels={questions[0].id: "Q-001"},
            ),
        )
        discussion = create_discussion(
            connection,
            DiscussionCreateCommand(
                course_id=course_id,
                source_resource_id=resource_id,
                initial_prompt_batch_id=initial.id,
            ),
        )
        with pytest.raises(WorkspaceRepositoryError, match="already owned"):
            create_prompt_batch(
                connection,
                PromptBatchCreateCommand(
                    course_id=course_id,
                    title="Conflicting continuation",
                    source_scope="task_questions_continuation",
                    parent_discussion_thread_id=discussion.id,
                    markdown="# Q-001\n\nSecond",
                    annotation_ids=[questions[1].id],
                    question_labels={questions[1].id: "Q-001"},
                ),
            )


def test_continuation_accepts_companion_captures_with_one_stable_label(
    tmp_path: Path,
) -> None:
    course_id, resource_id = _seed_course(tmp_path)
    with transaction() as connection:
        captures = [
            create_annotation(
                connection,
                AnnotationCreateCommand(
                    resource_id=resource_id,
                    kind="question",
                    markdown=f"Capture {index}",
                    anchor=AnnotationAnchorCreate(
                        page_number=11,
                        metadata={"contextGroupId": "shared-prompt-question"},
                    ),
                ),
            )
            for index in (1, 2)
        ]
        workspace = get_workspace(connection, course_id)
        by_id = {annotation.id: annotation for annotation in workspace.annotations}
        label = by_id[captures[0].id].stable_label
        assert label == by_id[captures[1].id].stable_label
        initial = create_prompt_batch(
            connection,
            PromptBatchCreateCommand(
                course_id=course_id,
                title="First capture",
                source_scope="resource_questions",
                source_resource_id=resource_id,
                markdown=f"# {label}\n\nFirst capture",
                annotation_ids=[captures[0].id],
                question_labels={captures[0].id: label or ""},
            ),
        )
        discussion = create_discussion(
            connection,
            DiscussionCreateCommand(
                course_id=course_id,
                source_resource_id=resource_id,
                initial_prompt_batch_id=initial.id,
            ),
        )
        create_prompt_batch(
            connection,
            PromptBatchCreateCommand(
                course_id=course_id,
                title="All companion captures",
                source_scope="resource_questions_continuation",
                source_resource_id=resource_id,
                parent_discussion_thread_id=discussion.id,
                markdown=f"# {label}\n\nBoth captures",
                annotation_ids=[captures[0].id, captures[1].id],
                question_labels={capture.id: label or "" for capture in captures},
            ),
        )
        updated = get_workspace(connection, course_id)

    assert len(updated.discussions[0].question_labels) == 1
    assert updated.discussions[0].question_labels[0].label == label
    assert updated.discussions[0].question_labels[0].annotation_ids == [
        captures[0].id,
        captures[1].id,
    ]


def test_qa_review_state_is_persisted_per_discussion_question(
    tmp_path: Path,
) -> None:
    course_id, resource_id = _seed_course(tmp_path)
    with transaction() as connection:
        question = create_annotation(
            connection,
            AnnotationCreateCommand(
                resource_id=resource_id,
                kind="question",
                markdown="Why?",
            ),
        )
        batch = create_prompt_batch(
            connection,
            PromptBatchCreateCommand(
                course_id=course_id,
                title="Review batch",
                source_scope="resource_questions",
                source_resource_id=resource_id,
                markdown="# Q-001\n\nWhy?",
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
        message = create_discussion_message(
            connection,
            discussion.id,
            DiscussionMessageCreateCommand(
                role="assistant",
                markdown="# Q-001\n\nAnswer.",
                link_prompt_questions=True,
            ),
        )
        review_discussion_qa(
            connection,
            discussion.id,
            DiscussionQaReviewCommand(
                message_id=message.id,
                section_id="answer-section-q-001",
                section_fingerprint="v1-current-answer",
                question_ids=[question.id],
            ),
        )
        workspace = get_workspace(connection, course_id)

    review = workspace.discussions[0].qa_reviews[0]
    assert review.annotation_id == question.id
    assert review.message_id == message.id
    assert review.message_revision == message.revision
    assert review.section_id == "answer-section-q-001"
    assert review.section_fingerprint == "v1-current-answer"


def test_qa_review_accepts_a_companion_capture(tmp_path: Path) -> None:
    """A mapped QA group may be rooted in a screenshot or highlight capture."""
    course_id, resource_id = _seed_course(tmp_path)
    with transaction() as connection:
        capture = create_annotation(
            connection,
            AnnotationCreateCommand(
                resource_id=resource_id,
                kind="highlight",
                markdown="Context attached to a handwritten question",
            ),
        )
        discussion = create_discussion(
            connection,
            DiscussionCreateCommand(
                course_id=course_id,
                source_resource_id=resource_id,
            ),
        )
        message = create_discussion_message(
            connection,
            discussion.id,
            DiscussionMessageCreateCommand(
                role="assistant",
                markdown="# Answer\n\nTutor response.",
            ),
        )
        review_discussion_qa(
            connection,
            discussion.id,
            DiscussionQaReviewCommand(
                message_id=message.id,
                section_id="answer-section-context",
                section_fingerprint="v1-context-answer",
                question_ids=[capture.id],
            ),
        )
        workspace = get_workspace(connection, course_id)

    assert workspace.discussions[0].qa_reviews[0].annotation_id == capture.id


def test_tutor_answer_import_persists_independent_messages_without_raw_envelope(
    tmp_path: Path,
) -> None:
    course_id, resource_id = _seed_course(tmp_path)
    with transaction() as connection:
        questions = [
            create_annotation(
                connection,
                AnnotationCreateCommand(
                    resource_id=resource_id,
                    kind="question",
                    markdown=f"Question {index}",
                ),
            )
            for index in (1, 2)
        ]
        discussion = create_discussion(
            connection,
            DiscussionCreateCommand(
                course_id=course_id,
                source_resource_id=resource_id,
            ),
        )
        imported = import_discussion_answers(
            connection,
            discussion.id,
            DiscussionAnswerImportCommand(
                imported_from_clipboard=True,
                answers=[
                    DiscussionAnswerImportItem(
                        markdown=f"## Q-00{index}\n\nIndependent answer {index}.",
                        annotation_links=[
                            {
                                "annotation_id": questions[index - 1].id,
                                "relation": "references",
                            }
                        ],
                    )
                    for index in (1, 2)
                ],
            ),
        )
        workspace = get_workspace(connection, course_id)

    messages = workspace.discussions[0].messages
    assert imported.message_ids == [message.id for message in messages]
    assert len(messages) == 2
    assert messages[0].body.markdown == "## Q-001\n\nIndependent answer 1."
    assert messages[1].body.markdown == "## Q-002\n\nIndependent answer 2."
    assert messages[0].annotation_links[0].annotation_id == questions[0].id
    assert messages[1].annotation_links[0].annotation_id == questions[1].id
    assert all(message.imported_from_clipboard for message in messages)


def test_prompt_discussion_skips_annotations_deleted_after_prompt_creation(
    tmp_path: Path,
) -> None:
    course_id, resource_id = _seed_course(tmp_path)
    with transaction() as connection:
        current_question = create_annotation(
            connection,
            AnnotationCreateCommand(
                resource_id=resource_id,
                kind="question",
                markdown="Current question",
            ),
        )
        deleted_question = create_annotation(
            connection,
            AnnotationCreateCommand(
                resource_id=resource_id,
                kind="question",
                markdown="Question removed during a later PDF sync",
            ),
        )
        batch = create_prompt_batch(
            connection,
            PromptBatchCreateCommand(
                course_id=course_id,
                title="Question snapshot",
                source_scope="resource_questions",
                source_resource_id=resource_id,
                markdown="# Questions",
                annotation_ids=[current_question.id, deleted_question.id],
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
        connection.execute(
            text(
                """
                UPDATE annotations
                SET deleted_at = '2026-07-24T00:00:00Z'
                WHERE id = :annotation_id
                """
            ),
            {"annotation_id": deleted_question.id},
        )

        message = create_discussion_message(
            connection,
            discussion.id,
            DiscussionMessageCreateCommand(
                role="assistant",
                markdown="An answer imported after the PDF was resynced.",
                link_prompt_questions=True,
            ),
        )
        workspace = get_workspace(connection, course_id)

    stored_message = next(
        item
        for item in workspace.discussions[0].messages
        if item.id == message.id
    )
    assert [link.annotation_id for link in stored_message.annotation_links] == [
        current_question.id
    ]


def test_reviewing_message_saves_selection_followups_and_math_highlights(
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
        created = create_discussion_message(
            connection,
            discussion.id,
            DiscussionMessageCreateCommand(
                role="assistant",
                markdown=r"The update is $V(s) \leftarrow r + \gamma V(s')$.",
            ),
        )
        before = get_workspace(connection, course_id)
        message = before.discussions[0].messages[0]
        reviewed = review_discussion_message(
            connection,
            created.id,
            DiscussionMessageReviewCommand(
                revision=message.revision,
                document_revision=message.body.revision,
                markdown=message.body.markdown or "",
                plain_text=message.body.plain_text,
                review_items=[
                    DiscussionReviewItem(
                        kind="question",
                        quote="The update",
                        markdown="Why is this a bootstrap update?",
                        context_after="uses the next-state estimate",
                        from_position=1,
                        to_position=11,
                        section_label="Q-001 — bootstrap update",
                        question_ids=["root-question-id"],
                    ),
                    DiscussionReviewItem(
                        kind="question",
                        quote="next-state estimate",
                        markdown="What happens at a terminal state?",
                        from_position=30,
                        to_position=49,
                        section_label="Q-001 — bootstrap update",
                        question_ids=["root-question-id"],
                    ),
                    DiscussionReviewItem(
                        kind="highlight",
                        quote=r"$V(s) \leftarrow r + \gamma V(s')$",
                        color="secondary",
                        context_before="The update is",
                    ),
                ],
            ),
        )
        after = get_workspace(connection, course_id)

    assert reviewed.revision == message.revision + 1
    review_annotations = [
        annotation
        for annotation in after.annotations
        if annotation.origin.startswith("discussion_review_")
    ]
    assert {annotation.kind for annotation in review_annotations} == {
        "highlight",
        "question",
    }
    questions = sorted(
        (
            annotation
            for annotation in review_annotations
            if annotation.kind == "question"
        ),
        key=lambda annotation: annotation.created_at,
    )
    question = questions[0]
    highlight = next(
        annotation for annotation in review_annotations if annotation.kind == "highlight"
    )
    assert question.anchor and question.anchor.discussion_message_id == message.id
    assert [item.anchor.metadata["promptLabel"] for item in questions] == [
        "Q-001-F1",
        "Q-001-F2",
    ]
    assert question.anchor.metadata["sectionLabel"] == (
        "Q-001 — bootstrap update"
    )
    assert question.anchor.metadata["rootQuestionIds"] == ["root-question-id"]
    assert highlight.anchor and highlight.anchor.color == "secondary"
    assert after.discussions[0].messages[0].annotation_links[0].relation == "followup_to"
    assert question.id in after.discussions[0].question_ids
    assert highlight.id not in after.discussions[0].question_ids


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


def test_discussion_message_body_can_be_edited_with_document_history(
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
        created = create_discussion_message(
            connection,
            discussion.id,
            DiscussionMessageCreateCommand(
                role="assistant",
                markdown="First tutor answer.",
            ),
        )
        workspace = get_workspace(connection, course_id)
        message = workspace.discussions[0].messages[-1]
        updated = update_discussion_message(
            connection,
            created.id,
            DiscussionMessageUpdateCommand(
                revision=message.revision,
                document_revision=message.body.revision,
                markdown=r"Dense answer with $\pi(a\mid s)$.",
                plain_text="Dense answer with pi.",
            ),
        )
        after = get_workspace(connection, course_id)
        revisions = connection.execute(
            text(
                """
                SELECT revision_number, change_reason
                FROM document_revisions
                WHERE document_id = :document_id
                ORDER BY revision_number
                """
            ),
            {"document_id": message.body.id},
        ).mappings().all()

    edited = after.discussions[0].messages[-1]
    assert updated.revision == message.revision + 1
    assert edited.body.markdown == r"Dense answer with $\pi(a\mid s)$."
    assert edited.body.plain_text == "Dense answer with pi."
    assert revisions[-1] == {
        "revision_number": 2,
        "change_reason": "discussion_message_updated",
    }


def test_deleting_one_tutor_answer_reopens_and_unlinks_its_question(
    tmp_path: Path,
) -> None:
    course_id, resource_id = _seed_course(tmp_path)
    with transaction() as connection:
        question = create_annotation(
            connection,
            AnnotationCreateCommand(
                resource_id=resource_id,
                kind="question",
                markdown="Why does this update converge?",
            ),
        )
        discussion = create_discussion(
            connection,
            DiscussionCreateCommand(
                course_id=course_id,
                source_resource_id=resource_id,
            ),
        )
        created = create_discussion_message(
            connection,
            discussion.id,
            DiscussionMessageCreateCommand(
                role="assistant",
                markdown=(
                    "## Q-001 — convergence\n\nBad answer.\n\n"
                    "## Q-002 — another topic\n\nUseful answer."
                ),
                annotation_links=[
                    {
                        "annotation_id": question.id,
                        "relation": "answers",
                    }
                ],
            ),
        )
        before = get_workspace(connection, course_id)
        message = before.discussions[0].messages[0]
        deleted = delete_discussion_answer(
            connection,
            created.id,
            DiscussionAnswerDeleteCommand(
                revision=message.revision,
                document_revision=message.body.revision,
                markdown="## Q-002 — another topic\n\nUseful answer.",
                plain_text="Useful answer.",
                question_ids=[question.id],
            ),
        )
        after = get_workspace(connection, course_id)
        answered_at = connection.execute(
            text("SELECT answered_at FROM annotations WHERE id = :id"),
            {"id": question.id},
        ).scalar_one()

    reopened = next(item for item in after.annotations if item.id == question.id)
    updated_message = after.discussions[0].messages[0]
    assert deleted.revision == message.revision + 1
    assert reopened.status == "open"
    assert answered_at is None
    assert updated_message.annotation_links == []
    assert "Bad answer" not in (updated_message.body.markdown or "")
    assert "Useful answer" in (updated_message.body.markdown or "")


def test_deleting_answer_can_archive_its_question_atomically(
    tmp_path: Path,
) -> None:
    course_id, resource_id = _seed_course(tmp_path)
    with transaction() as connection:
        question = create_annotation(
            connection,
            AnnotationCreateCommand(
                resource_id=resource_id,
                kind="question",
                markdown="Is this question still useful?",
            ),
        )
        discussion = create_discussion(
            connection,
            DiscussionCreateCommand(
                course_id=course_id,
                source_resource_id=resource_id,
            ),
        )
        created = create_discussion_message(
            connection,
            discussion.id,
            DiscussionMessageCreateCommand(
                role="assistant",
                markdown="## Q-001 — obsolete\n\nAn answer to remove.",
                annotation_links=[
                    {
                        "annotation_id": question.id,
                        "relation": "answers",
                    }
                ],
            ),
        )
        before = get_workspace(connection, course_id)
        message = before.discussions[0].messages[0]
        delete_discussion_answer(
            connection,
            created.id,
            DiscussionAnswerDeleteCommand(
                revision=message.revision,
                document_revision=message.body.revision,
                markdown="",
                plain_text="",
                question_ids=[question.id],
                archive_questions=True,
            ),
        )
        after = get_workspace(connection, course_id)

    archived = next(item for item in after.annotations if item.id == question.id)
    updated_message = after.discussions[0].messages[0]
    assert archived.status == "archived"
    assert updated_message.annotation_links == []
    assert not (updated_message.body.markdown or "").strip()


def test_deleting_complete_tutor_response_reopens_all_answered_questions(
    tmp_path: Path,
) -> None:
    course_id, resource_id = _seed_course(tmp_path)
    with transaction() as connection:
        question = create_annotation(
            connection,
            AnnotationCreateCommand(
                resource_id=resource_id,
                kind="question",
                markdown="Why does this converge?",
            ),
        )
        discussion = create_discussion(
            connection,
            DiscussionCreateCommand(
                course_id=course_id,
                source_resource_id=resource_id,
            ),
        )
        created = create_discussion_message(
            connection,
            discussion.id,
            DiscussionMessageCreateCommand(
                role="assistant",
                markdown="## Q-001\n\nDisposable tutor response.",
                annotation_links=[
                    {"annotation_id": question.id, "relation": "answers"}
                ],
            ),
        )
        before = get_workspace(connection, course_id)
        message = before.discussions[0].messages[0]
        delete_discussion_message(
            connection,
            created.id,
            DiscussionMessageDeleteCommand(revision=message.revision),
        )
        after = get_workspace(connection, course_id)

    reopened = next(item for item in after.annotations if item.id == question.id)
    assert reopened.status == "open"
    assert after.discussions[0].messages == []


def test_saving_discussion_message_exports_configured_instruction_tag(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    course_id, resource_id = _seed_course(tmp_path)
    with transaction() as connection:
        short_code = connection.execute(
            text("SELECT short_code FROM courses WHERE id = :id"),
            {"id": course_id},
        ).scalar_one()
    export_root = tmp_path / "instructions"
    config_path = tmp_path / "course_files.json"
    config_path.write_text(
        (
            '{"discussion_export_roots": {'
            f'"{short_code}": "{export_root}"'
            "}}"
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("TRACKER_COURSE_FILES_CONFIG_PATH", str(config_path))
    get_settings.cache_clear()

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
                markdown=(
                    "Theory.\n\n<day4_code_task>\n"
                    "## Implement\n\nRun the experiment.\n"
                    "</day4_code_task>"
                ),
            ),
        )

    exported = (export_root / "day4_code_task.md").read_text(encoding="utf-8")
    assert "## Implement" in exported
    assert "Run the experiment." in exported


def test_annotation_can_have_a_separate_linked_note(tmp_path: Path) -> None:
    course_id, resource_id = _seed_course(tmp_path)
    with transaction() as connection:
        created = create_annotation(
            connection,
            AnnotationCreateCommand(
                resource_id=resource_id,
                kind="highlight",
                markdown="Imported source text stays intact.",
            ),
        )
        note = upsert_note(
            connection,
            NoteUpsertCommand(
                course_id=course_id,
                kind="annotation",
                entity_type="annotation",
                entity_id=created.id,
                markdown="<p>My interpretation of this passage.</p>",
                plain_text="My interpretation of this passage.",
                related_links=[
                    {"entity_type": "resource", "entity_id": resource_id}
                ],
            ),
        )
        workspace = get_workspace(connection, course_id)

    annotation = next(item for item in workspace.annotations if item.id == created.id)
    assert annotation.body is not None
    assert annotation.body.plain_text == "Imported source text stays intact."
    assert [item.id for item in annotation.notes] == [note.id]
    assert annotation.notes[0].document.plain_text == "My interpretation of this passage."
    saved_note = next(item for item in workspace.notes if item.id == note.id)
    assert {
        (link.entity_type, link.entity_id, link.relation)
        for link in saved_note.links
    } == {
        ("annotation", created.id, "primary"),
        ("resource", resource_id, "related"),
    }


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



def test_prompt_batch_rebuilds_attachment_folder_and_names_handwriting_by_question(
    tmp_path: Path,
) -> None:
    course_id, resource_id = _seed_course(tmp_path)
    fingerprint = "red-ink-question-1"
    image_path = annotation_image_path(resource_id, fingerprint)
    image_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(b"\x89PNG\r\n\x1a\nquestion-image")

    attachment_dir = get_settings().chatgpt_attachment_dir
    attachment_dir.mkdir(parents=True, exist_ok=True)
    attachment_dir_inode = attachment_dir.stat().st_ino
    stale_file = attachment_dir / "stale-from-previous-prompt.txt"
    stale_file.write_text("remove me", encoding="utf-8")

    with transaction() as connection:
        question = create_annotation(
            connection,
            AnnotationCreateCommand(
                resource_id=resource_id,
                kind="question",
                origin="drawboard_cloud_ink",
                source_fingerprint=fingerprint,
                markdown="Why is this assumption needed?",
                plain_text="Why is this assumption needed?",
                anchor=AnnotationAnchorCreate(
                    anchor_type="pdf_rect",
                    page_number=7,
                    color="red",
                    annotation_kind="Ink",
                    metadata={
                        "contextImageUrl": (
                            f"/api/resources/{resource_id}/annotation-images/"
                            f"{fingerprint}?v=test"
                        )
                    },
                ),
            ),
        )
        result = create_prompt_batch_with_attachments(
            connection,
            PromptBatchCreateCommand(
                course_id=course_id,
                title="Question with handwriting",
                source_scope="resource_questions",
                source_resource_id=resource_id,
                markdown=(
                    "# Questions\n\n"
                    "### Q-001\n\nWhy is this assumption needed?"
                ),
                annotation_ids=[question.id],
            ),
        )

        saved_markdown = connection.execute(
            text(
                """
                SELECT d.markdown
                FROM prompt_batches pb
                JOIN documents d ON d.id = pb.prompt_document_id
                WHERE pb.id = :prompt_batch_id
                """
            ),
            {"prompt_batch_id": result.id},
        ).scalar_one()

    non_manifest = [
        attachment for attachment in result.attachments
        if attachment.kind != "manifest"
    ]
    resource_attachment = next(
        attachment for attachment in non_manifest
        if attachment.kind == "resource"
    )
    image_attachment = next(
        attachment for attachment in non_manifest
        if attachment.kind == "question_image"
    )

    assert stale_file.exists() is False
    assert attachment_dir.stat().st_ino == attachment_dir_inode
    assert (attachment_dir / resource_attachment.name).read_text(
        encoding="utf-8"
    ).startswith("Coverage assumption")
    assert image_attachment.name.startswith("Q-001__Paper__p-7__handwriting")
    assert (attachment_dir / image_attachment.name).read_bytes().startswith(b"\x89PNG")
    assert resource_attachment.name in result.markdown
    assert image_attachment.name in result.markdown
    assert saved_markdown == result.markdown
    assert (attachment_dir / "README.md").is_file()

    sentinel = attachment_dir / "remove-on-next-copy.txt"
    sentinel.write_text("old", encoding="utf-8")
    with transaction() as connection:
        second = create_prompt_batch_with_attachments(
            connection,
            PromptBatchCreateCommand(
                course_id=course_id,
                title="Resource only",
                source_scope="resource",
                source_resource_id=resource_id,
                markdown="# Resource",
            ),
        )

    assert sentinel.exists() is False
    assert not any(
        attachment.kind == "question_image"
        for attachment in second.attachments
    )


def test_lecture_note_picture_becomes_scoped_question_and_prompt_attachment(
    tmp_path: Path,
) -> None:
    course_id, resource_id = _seed_course(tmp_path)
    pixmap = pymupdf.Pixmap(
        pymupdf.csRGB,
        pymupdf.IRect(0, 0, 16, 12),
        False,
    )
    pixmap.clear_with(0xAACCFF)
    picture = bytes(pixmap.tobytes("png"))

    with transaction() as connection:
        day_id = str(
            connection.execute(
                text("SELECT id FROM study_days WHERE course_id = :course_id"),
                {"course_id": course_id},
            ).scalar_one()
        )
        task_id = str(
            connection.execute(
                text(
                    """
                    SELECT id
                    FROM tasks
                    WHERE day_id = :day_id
                      AND deleted_at IS NULL
                    ORDER BY order_index
                    LIMIT 1
                    """
                ),
                {"day_id": day_id},
            ).scalar_one()
        )
        first = import_image_questions(
            connection,
            resource_id=resource_id,
            image_payloads=[picture],
            source="files",
            source_day_id=day_id,
            source_task_id=task_id,
        )
        duplicate = import_image_questions(
            connection,
            resource_id=resource_id,
            image_payloads=[picture],
            source="files",
            source_day_id=day_id,
            source_task_id=task_id,
        )
        command = PromptBatchCreateCommand(
            course_id=course_id,
            title="Lecture notes",
            source_scope="resource_questions",
            source_resource_id=resource_id,
            source_day_id=day_id,
            source_task_id=task_id,
            markdown="# Q-001\n\nLecture notes screenshot",
            annotation_ids=first.annotation_ids,
        )
        preview = preview_prompt_attachments(connection, command)
        batch = create_prompt_batch_with_attachments(connection, command)
        workspace = get_workspace(connection, course_id)

    assert first.imported == 1
    assert first.duplicates == 0
    assert duplicate.imported == 0
    assert duplicate.duplicates == 1
    assert duplicate.annotation_ids == first.annotation_ids
    question = next(
        item for item in workspace.annotations if item.id == first.annotation_ids[0]
    )
    assert question.kind == "question"
    assert question.origin == "lecture_note_image"
    assert question.anchor is not None
    assert question.anchor.anchor_type == "image"
    assert question.anchor.metadata["createdDayId"] == day_id
    assert question.anchor.metadata["createdTaskId"] == task_id
    assert preview == (2, 1)
    image = next(item for item in batch.attachments if item.kind == "question_image")
    assert image.annotation_id == question.id
    assert image.question_label == "Q-001"
    assert Path(image.path).read_bytes().startswith(b"\x89PNG")


def test_day_prompt_attaches_only_the_book_chapter_and_reuses_it(
    tmp_path: Path,
) -> None:
    book_path = tmp_path / "book.pdf"
    document = pymupdf.open()
    for page_number in range(1, 9):
        page = document.new_page()
        page.insert_text((72, 72), f"Book page {page_number}")
    document.set_toc(
        [
            [1, "Introduction", 1],
            [1, "I Tabular Methods", 3],
            [2, "Multi-armed Bandits", 3],
            [3, "2.1 Action values", 3],
            [2, "Finite Markov Decision Processes", 6],
        ]
    )
    document.save(book_path)
    document.close()
    plan_path = tmp_path / "book-plan.md"
    plan_path.write_text(
        """
+++
format = "study-plan/v1"
id = "chapter_prompt"
title = "Chapter Prompt"
mode = "full"

[resources.book]
title = "RL Book"
path = "book.pdf"
kind = "book"
+++

# Chapter Prompt

### Day 1: 2026-07-01 - Bandits {#day-01}

#### Reading

- [ ] Read Sections 2.1-2.3. {#read-book resources=book}

Stop when: chapter 2 is understood. {#day01-stop}
""".lstrip(),
        encoding="utf-8",
    )
    result = sync_study_plan(plan_path)

    with transaction() as connection:
        day_id = connection.execute(
            text("SELECT id FROM study_days WHERE course_id = :course_id"),
            {"course_id": result.course_id},
        ).scalar_one()
        first = create_prompt_batch_with_attachments(
            connection,
            PromptBatchCreateCommand(
                course_id=result.course_id,
                title="Bandits day",
                source_scope="day",
                source_day_id=str(day_id),
                markdown="# Day 1",
            ),
        )

    resource = next(item for item in first.attachments if item.kind == "resource")
    assert "chapters-2" in resource.name
    with pymupdf.open(resource.path) as prepared:
        assert prepared.page_count == 3
        assert "Book page 3" in prepared[0].get_text()
        assert "Book page 5" in prepared[-1].get_text()
    first_mtime = Path(resource.path).stat().st_mtime_ns

    with transaction() as connection:
        second = create_prompt_batch_with_attachments(
            connection,
            PromptBatchCreateCommand(
                course_id=result.course_id,
                title="Bandits day again",
                source_scope="day",
                source_day_id=str(day_id),
                markdown="# Day 1",
            ),
        )

    reused = next(item for item in second.attachments if item.kind == "resource")
    assert reused.path == resource.path
    assert Path(reused.path).stat().st_mtime_ns == first_mtime


def test_reader_screen_marker_adds_slide_png_to_prompt_bundle(
    tmp_path: Path,
) -> None:
    course_id, resource_id = _seed_course(tmp_path)
    pdf_path = tmp_path / "lecture.pdf"
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "Bellman backup diagram")
    document.save(pdf_path)
    document.close()

    with transaction() as connection:
        connection.execute(
            text(
                """
                UPDATE resource_versions
                SET local_path = :local_path,
                    file_name = :file_name
                WHERE id = (
                  SELECT current_version_id FROM resources WHERE id = :resource_id
                )
                """
            ),
            {
                "file_name": pdf_path.name,
                "local_path": str(pdf_path),
                "resource_id": resource_id,
            },
        )
        question = create_annotation(
            connection,
            AnnotationCreateCommand(
                resource_id=resource_id,
                kind="question",
                origin="lecture_reader",
                markdown="Why does this backup contract?",
                anchor=AnnotationAnchorCreate(
                    anchor_type="pdf_page",
                    page_number=1,
                    annotation_kind="question",
                    metadata={
                        "captureSource": "lecture_reader",
                        "includeSlideScreenshot": True,
                    },
                ),
            ),
        )
        result = create_prompt_batch_with_attachments(
            connection,
            PromptBatchCreateCommand(
                course_id=course_id,
                title="Lecture question",
                source_scope="resource_questions",
                source_resource_id=resource_id,
                markdown="# Q-001\n\nWhy does this backup contract?",
                annotation_ids=[question.id],
            ),
        )

    screenshot = next(
        item for item in result.attachments if item.kind == "question_image"
    )
    assert screenshot.name.startswith("Q-001__Paper__p-1")
    assert Path(screenshot.path).read_bytes().startswith(b"\x89PNG")


def test_book_chapter_progress_combines_plan_scope_and_persistent_state(
    tmp_path: Path,
) -> None:
    course_id, resource_id = _seed_course(tmp_path)
    with transaction() as connection:
        connection.execute(
            text(
                """
                UPDATE resources
                SET kind = 'book',
                    title = 'Reinforcement Learning: An Introduction, second edition',
                    metadata_json = '{"plan_resource_id":"rl-book"}'
                WHERE id = :resource_id
                """
            ),
            {"resource_id": resource_id},
        )
        connection.execute(
            text(
                """
                UPDATE tasks
                SET title = 'Read Sections 3.1-3.6'
                WHERE day_id IN (
                  SELECT id FROM study_days WHERE course_id = :course_id
                )
                """
            ),
            {"course_id": course_id},
        )
        before = get_workspace(connection, course_id)
        created = update_resource_chapter_progress(
            connection,
            resource_id,
            3,
            ResourceChapterProgressCommand(status="read_partially"),
        )
        partial = get_workspace(connection, course_id)
        update_resource_chapter_progress(
            connection,
            resource_id,
            3,
            ResourceChapterProgressCommand(
                status="read_fully",
                revision=created.revision,
            ),
        )
        completed = get_workspace(connection, course_id)

    before_book = next(resource for resource in before.resources if resource.id == resource_id)
    assert len(before_book.chapters) == 17
    assert next(chapter for chapter in before_book.chapters if chapter.number == 3).planned
    partial_book = next(
        resource for resource in partial.resources if resource.id == resource_id
    )
    assert next(
        chapter for chapter in partial_book.chapters if chapter.number == 3
    ).status == "read_partially"
    completed_book = next(
        resource for resource in completed.resources if resource.id == resource_id
    )
    assert next(
        chapter for chapter in completed_book.chapters if chapter.number == 3
    ).status == "read_fully"


def test_note_markers_become_stable_counted_resource_captures(
    tmp_path: Path,
) -> None:
    course_id, _resource_id = _seed_course(tmp_path)
    with transaction() as connection:
        workspace = get_workspace(connection, course_id)
        task = workspace.days[0].sections[0].tasks[0]
        created = upsert_note(
            connection,
            NoteUpsertCommand(
                course_id=course_id,
                kind="task",
                entity_type="task",
                entity_id=task.id,
                markdown=(
                    "!!Why is this estimator unbiased??!!\n\n"
                    "%%todo! rerun all seeds%%"
                ),
            ),
        )
        first = get_workspace(connection, course_id)
        first_task = first.days[0].sections[0].tasks[0]
        first_ids = {
            annotation.id
            for annotation in first.annotations
            if annotation.origin == "note_marker"
        }
        note = first_task.notes[0]
        upsert_note(
            connection,
            NoteUpsertCommand(
                course_id=course_id,
                note_id=created.id,
                note_revision=note.revision,
                document_revision=note.document.revision,
                kind="task",
                entity_type="task",
                entity_id=task.id,
                markdown=(
                    "Intro paragraph.\n\n"
                    "!!Why is this estimator unbiased??!!\n\n"
                    "%%todo! rerun all seeds%%"
                ),
            ),
        )
        stable = get_workspace(connection, course_id)
        stable_note = stable.days[0].sections[0].tasks[0].notes[0]
        stable_ids = {
            annotation.id
            for annotation in stable.annotations
            if annotation.origin == "note_marker"
        }
        upsert_note(
            connection,
            NoteUpsertCommand(
                course_id=course_id,
                note_id=created.id,
                note_revision=stable_note.revision,
                document_revision=stable_note.document.revision,
                kind="task",
                entity_type="task",
                entity_id=task.id,
                markdown="%%todo! rerun all seeds%%",
            ),
        )
        reduced = get_workspace(connection, course_id)

    assert first_task.open_question_count == 2
    assert first_ids == stable_ids
    marker_colors = {
        annotation.kind: annotation.anchor.color
        for annotation in first.annotations
        if annotation.origin == "note_marker" and annotation.anchor
    }
    assert marker_colors == {
        "question": "rgb(226, 82, 117)",
        "todo": "rgb(147, 178, 80)",
    }
    assert reduced.days[0].sections[0].tasks[0].open_question_count == 1


def test_book_question_counts_follow_task_chapter_scope_without_hiding_annotations(
    tmp_path: Path,
) -> None:
    (tmp_path / "book.pdf").write_bytes(b"%PDF-1.4")
    plan_path = tmp_path / "book-plan.md"
    plan_path.write_text(
        """
+++
format = "study-plan/v1"
id = "book_scope_course"
title = "Book Scope Course"
mode = "full"

[resources.book]
title = "RL Book"
path = "book.pdf"
kind = "book"
+++

# Book Scope Course

### Day 1: Read chapters {#day-01}

#### Reading

- [ ] Read Sections 4.1-4.3. {#read-chapter-4 resources=book}
- [ ] Read Sections 5.1-5.4. {#read-chapter-5 resources=book}

Stop when: both chapter scopes are reviewed. {#day01-stop}
""".lstrip(),
        encoding="utf-8",
    )
    result = sync_study_plan(plan_path)
    with transaction() as connection:
        resource_id = str(
            connection.execute(
                text(
                    """
                    SELECT entity_id
                    FROM source_bindings
                    WHERE entity_type = 'resource'
                      AND source_key = 'book_scope_course:book'
                    """
                )
            ).scalar_one()
        )
        for chapter in (4, 5):
            create_annotation(
                connection,
                AnnotationCreateCommand(
                    resource_id=resource_id,
                    kind="question",
                    markdown=f"Question from chapter {chapter}",
                    plain_text=f"Question from chapter {chapter}",
                    anchor=AnnotationAnchorCreate(
                        anchor_type="pdf_rect",
                        page_number=chapter * 10,
                        metadata={
                            "chapterNumber": chapter,
                            "chapterTitle": f"Chapter {chapter}",
                        },
                    ),
                ),
            )
        workspace = get_workspace(connection, result.course_id)

    tasks = {
        task.title: task
        for day in workspace.days
        for section in day.sections
        for task in section.tasks
    }
    chapter_four = next(task for title, task in tasks.items() if "4.1-4.3" in title)
    chapter_five = next(task for title, task in tasks.items() if "5.1-5.4" in title)
    assert chapter_four.chapter_numbers == [4]
    assert chapter_four.open_question_count == 1
    assert chapter_five.chapter_numbers == [5]
    assert chapter_five.open_question_count == 1
    assert workspace.days[0].open_question_count == 2
    book = next(resource for resource in workspace.resources if resource.id == resource_id)
    assert len(book.annotations) == 2


def test_postponed_question_groups_leave_active_counts_without_losing_state(
    tmp_path: Path,
) -> None:
    course_id, resource_id = _seed_course(tmp_path)
    with transaction() as connection:
        questions = [
            create_annotation(
                connection,
                AnnotationCreateCommand(
                    resource_id=resource_id,
                    kind="question",
                    markdown=f"Question {index}",
                    anchor=AnnotationAnchorCreate(
                        anchor_type="text_quote",
                        metadata={"contextGroupId": "shared-paragraph"},
                    ),
                ),
            )
            for index in (1, 2)
        ]
        initial = get_workspace(connection, course_id)
        assert initial.days[0].open_question_count == 1

        # One API mutation updates the one logical question even though the PDF
        # importer stored two visual captures for its shared context group.
        update_annotation(
            connection,
            questions[0].id,
            AnnotationCommand(revision=questions[0].revision, postponed=True),
        )
        postponed = get_workspace(connection, course_id)

        postponed_questions = [
            annotation
            for annotation in postponed.annotations
            if annotation.id in {question.id for question in questions}
        ]
        assert all(annotation.postponed for annotation in postponed_questions)
        assert postponed.days[0].open_question_count == 0
        assert postponed.days[0].postponed_question_count == 1
        postponed_resource = next(
            resource for resource in postponed.resources if resource.id == resource_id
        )
        assert postponed_resource.open_question_count == 0

        first = next(
            annotation
            for annotation in postponed_questions
            if annotation.id == questions[0].id
        )
        update_annotation(
            connection,
            first.id,
            AnnotationCommand(revision=first.revision, status="answered"),
        )
        answered = get_workspace(connection, course_id)

    answered_first = next(
        annotation for annotation in answered.annotations if annotation.id == first.id
    )
    assert answered_first.status == "answered"
    assert answered_first.postponed is False
    answered_group = [
        annotation
        for annotation in answered.annotations
        if annotation.id in {question.id for question in questions}
    ]
    assert {annotation.status for annotation in answered_group} == {"answered"}
    assert all(annotation.postponed is False for annotation in answered_group)


def test_question_identity_prevents_source_refresh_from_hiding_history(
    tmp_path: Path,
) -> None:
    course_id, resource_id = _seed_course(tmp_path)
    with transaction() as connection:
        question = create_annotation(
            connection,
            AnnotationCreateCommand(
                resource_id=resource_id,
                kind="question",
                markdown="Keep me after the PDF mark disappears.",
                origin="drawboard_cloud_ink",
            ),
        )
        with pytest.raises(
            IntegrityError,
            match="question visibility is immutable after identity assignment",
        ):
            connection.execute(
                text(
                    """
                    UPDATE annotations
                    SET deleted_at = '2026-08-29T12:00:00Z'
                    WHERE id = :annotation_id
                    """
                ),
                {"annotation_id": question.id},
            )
        workspace = get_workspace(connection, course_id)

    restored = next(
        annotation
        for annotation in workspace.annotations
        if annotation.id == question.id
    )
    assert restored.kind == "question"


def test_skipped_question_leaves_active_counts_without_archiving_history(
    tmp_path: Path,
) -> None:
    course_id, resource_id = _seed_course(tmp_path)
    with transaction() as connection:
        question = create_annotation(
            connection,
            AnnotationCreateCommand(
                resource_id=resource_id,
                kind="question",
                markdown="This is deeper than I need right now.",
            ),
        )
        skipped_response = update_annotation(
            connection,
            question.id,
            AnnotationCommand(revision=question.revision, skipped=True),
        )
        skipped = get_workspace(connection, course_id)

        skipped_question = next(
            annotation
            for annotation in skipped.annotations
            if annotation.id == question.id
        )
        assert skipped_question.status == "open"
        assert skipped_question.skipped is True
        assert skipped_question.body is not None
        assert skipped_question.body.markdown == "This is deeper than I need right now."
        assert skipped.days[0].open_question_count == 0

        reopened_response = update_annotation(
            connection,
            question.id,
            AnnotationCommand(
                revision=skipped_response.revision,
                skipped=False,
            ),
        )
        reopened = get_workspace(connection, course_id)

    reopened_question = next(
        annotation for annotation in reopened.annotations if annotation.id == question.id
    )
    assert reopened_response.revision == skipped_response.revision + 1
    assert reopened_question.status == "open"
    assert reopened_question.skipped is False
    assert reopened.days[0].open_question_count == 1


def test_generic_book_tasks_only_inherit_questions_from_their_study_day(
    tmp_path: Path,
) -> None:
    (tmp_path / "book.pdf").write_bytes(b"%PDF-1.4")
    plan_path = tmp_path / "book-study-day-plan.md"
    plan_path.write_text(
        """
+++
format = "study-plan/v1"
id = "book_study_day_scope_course"
title = "Book Study Day Scope Course"
mode = "full"

[resources.book]
title = "RL Book"
path = "book.pdf"
kind = "book"
+++

# Book Study Day Scope Course

### Day 1: Initial reading {#day-01}

#### Reading

- [ ] Read the RL book. {#read-book-day-1 resources=book}

Stop when: the reading is reviewed. {#day01-stop}

### Day 2: Chapter four {#day-02}

#### Reading

- [ ] Read Sections 4.1-4.3. {#read-book-day-2 resources=book}

Stop when: chapter four is reviewed. {#day02-stop}

### Day 3: Later general reading {#day-03}

#### Reading

- [ ] Read the RL book. {#read-book-day-3 resources=book}

Stop when: the later reading is reviewed. {#day03-stop}
""".lstrip(),
        encoding="utf-8",
    )
    result = sync_study_plan(plan_path)
    with transaction() as connection:
        initial = get_workspace(connection, result.course_id)
        resource_id = initial.resources[0].id
        day_one_id = initial.days[0].id
        for chapter in (4, 5):
            create_annotation(
                connection,
                AnnotationCreateCommand(
                    resource_id=resource_id,
                    kind="question",
                    markdown=f"Question from chapter {chapter}",
                    plain_text=f"Question from chapter {chapter}",
                    anchor=AnnotationAnchorCreate(
                        anchor_type="pdf_rect",
                        page_number=chapter * 10,
                        metadata={
                            "chapterNumber": chapter,
                            "chapterTitle": f"Chapter {chapter}",
                            "createdDayId": day_one_id,
                        },
                    ),
                ),
            )
        workspace = get_workspace(connection, result.course_id)

    day_one_task = workspace.days[0].sections[0].tasks[0]
    day_two_task = workspace.days[1].sections[0].tasks[0]
    day_three_task = workspace.days[2].sections[0].tasks[0]
    assert day_one_task.chapter_numbers == []
    assert day_one_task.open_question_count == 2
    assert day_two_task.chapter_numbers == [4]
    assert day_two_task.open_question_count == 1
    assert day_three_task.chapter_numbers == []
    assert day_three_task.open_question_count == 0
    assert [day.open_question_count for day in workspace.days] == [2, 1, 0]
    assert len(workspace.resources[0].annotations) == 2



def test_local_pdf_annotations_share_paragraph_context_outside_book_resources(
    tmp_path: Path,
) -> None:
    pdf_path = tmp_path / "paper.pdf"
    document = pymupdf.open()
    page = document.new_page()
    paragraph = (
        "Reliable evaluation requires overlap between the logging policy and "
        "the target policy. Small logging probabilities can create unstable "
        "importance weights. Clipping those weights trades variance for bias."
    )
    page.insert_textbox(pymupdf.Rect(72, 100, 520, 220), paragraph, fontsize=11)
    first_rect = page.search_for("overlap between the logging policy")[0]
    second_rect = page.search_for("Clipping those weights trades variance for bias")[0]
    page.add_highlight_annot(first_rect)
    page.add_highlight_annot(second_rect)
    document.save(pdf_path)
    document.close()

    plan_path = tmp_path / "paper-plan.md"
    plan_path.write_text(
        """
+++
format = "study-plan/v1"
id = "paper_context_course"
title = "Paper Context Course"
mode = "full"

[resources.paper]
title = "Evaluation Paper"
path = "paper.pdf"
kind = "paper"
+++

# Paper Context Course

### Day 1: Read {#day-01}

#### Reading

- [ ] Read the paper. {#read-paper resources=paper}

Stop when: the paper is annotated. {#day01-stop}
""".lstrip(),
        encoding="utf-8",
    )
    result = sync_study_plan(plan_path)
    with transaction() as connection:
        resource_id = str(
            connection.execute(
                text(
                    """
                    SELECT entity_id
                    FROM source_bindings
                    WHERE entity_type = 'resource'
                      AND source_key = 'paper_context_course:paper'
                    """
                )
            ).scalar_one()
        )
        first_import = collect_resource_pdf_annotations(connection, resource_id)
        second_import = collect_resource_pdf_annotations(connection, resource_id)
        workspace = get_workspace(connection, result.course_id)

    assert first_import.created_count == 2
    assert second_import.existing_count == 2
    paper = next(resource for resource in workspace.resources if resource.id == resource_id)
    assert len(paper.annotations) == 2
    group_ids = {
        annotation.anchor.metadata.get("contextGroupId")
        for annotation in paper.annotations
        if annotation.anchor is not None
    }
    assert len(group_ids) == 1
    assert None not in group_ids
    assert all(
        annotation.anchor is not None
        and annotation.anchor.metadata.get("contextParagraph") == paragraph
        for annotation in paper.annotations
    )
