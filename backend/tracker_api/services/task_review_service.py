"""Task-note reviews and their Q&A projection share one transaction and lifecycle."""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.engine import Connection, RowMapping

from ..repositories import workspace_repository as repo
from ..schemas.workspace import (
    AnnotationAnchorCreate,
    AnnotationCreateCommand,
    DiscussionCreateCommand,
    DiscussionMessageCreateCommand,
    DiscussionMessageDeleteCommand,
    DiscussionMessageUpdateCommand,
    NoteUpsertCommand,
    TaskTutorReviewCommand,
    TaskTutorReviewResponse,
)

TAG = re.compile(r"^<!-- (?P<end>/)?tutor-review:(?P<id>[a-zA-Z0-9-]+) -->\s*$")


def task_note_resource(connection: Connection, command: NoteUpsertCommand) -> str | None:
    """Questions in a resource-free recall task still need a real capture owner."""
    resource_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"tracker:task-notes:{command.course_id}"))
    existing = connection.execute(
        text("SELECT id FROM resources WHERE id=:id AND deleted_at IS NULL"), {"id": resource_id}
    ).scalar_one_or_none()
    if existing:
        return str(existing)
    visible = re.sub(r"\\([!?])", r"\1", original_note(command.markdown))
    if not re.search(r"\?\?|\btodo!", visible, re.I):
        return None
    owner_query = """
        SELECT t.id FROM tasks t JOIN study_days d ON d.id=t.day_id
        WHERE t.id=:id AND d.course_id=:course_id AND t.deleted_at IS NULL
    """ if command.entity_type == "task" else """
        SELECT id FROM study_days WHERE id=:id AND course_id=:course_id AND deleted_at IS NULL
    """
    owner = connection.execute(
        text(owner_query),
        {"id": command.entity_id, "course_id": command.course_id},
    ).scalar_one_or_none()
    if not owner:
        raise repo.EntityNotFoundError("The note's task does not belong to this course.")
    connection.execute(
        text("""
        INSERT INTO resources (id, course_id, title, kind, format, source_type, category,
          status, metadata_json, created_at, updated_at)
        VALUES (:id,:course_id,'Task notes','note','markdown','generated','Task notes',
          'reading',:metadata,:now,:now)
        ON CONFLICT(id) DO UPDATE SET deleted_at=NULL, updated_at=excluded.updated_at
    """),
        {
            "id": resource_id,
            "course_id": command.course_id,
            "metadata": json.dumps({"taskNotes": True}),
            "now": repo._now(),
        },
    )
    return resource_id


@dataclass(frozen=True)
class ReviewBlock:
    message_id: str
    start: int
    end: int
    markdown: str


def review_blocks(markdown: str) -> list[ReviewBlock]:
    """Only standalone markers outside fenced code are structural."""
    result: list[ReviewBlock] = []
    opening: tuple[str, int, int] | None = None
    fence: str | None = None
    offset = 0
    for line in markdown.splitlines(keepends=True):
        fence_match = re.match(r"^ {0,3}(`{3,}|~{3,})", line)
        if fence:
            if re.fullmatch(rf" {{0,3}}{re.escape(fence[0])}{{{len(fence)},}}\s*", line):
                fence = None
        elif fence_match:
            fence = fence_match[1]
        else:
            match = TAG.fullmatch(line)
            if match:
                if not match["end"]:
                    if opening or any(b.message_id == match["id"] for b in result):
                        raise repo.WorkspaceRepositoryError(
                            "Duplicate or nested tutor-review marker."
                        )
                    opening = (match["id"], offset, offset + len(line))
                else:
                    if not opening or opening[0] != match["id"]:
                        raise repo.WorkspaceRepositoryError("Tutor-review boundary does not match.")
                    result.append(
                        ReviewBlock(
                            opening[0],
                            opening[1],
                            offset + len(line),
                            markdown[opening[2] : offset].strip("\n"),
                        )
                    )
                    opening = None
            elif re.match(r"^\s*<!--\s*/?tutor-review:", line):
                raise repo.WorkspaceRepositoryError(
                    "Malformed tutor-review marker. Restore its boundary."
                )
        offset += len(line)
    if opening:
        raise repo.WorkspaceRepositoryError(
            "Unclosed tutor-review marker. Restore its end boundary."
        )
    return result


def original_note(markdown: str) -> str:
    for block in reversed(review_blocks(markdown)):
        markdown = markdown[: block.start] + markdown[block.end :]
    return markdown.strip()


def tagged_review(message_id: str, markdown: str) -> str:
    return (
        f"<!-- tutor-review:{message_id} -->\n\n{markdown}\n\n<!-- /tutor-review:{message_id} -->"
    )


def _reviews(
    connection: Connection, note_id: str | None = None, message_id: str | None = None
) -> list[RowMapping]:
    return repo._rows(
        connection,
        """
        SELECT dm.id, dm.revision, d.revision AS document_revision, d.markdown,
               json_extract(aa.selector_json, '$.taskNoteId') AS note_id,
               json_extract(aa.selector_json, '$.taskId') AS task_id
        FROM annotations a JOIN annotation_anchors aa ON aa.annotation_id=a.id
        JOIN discussion_messages dm ON dm.id=aa.discussion_message_id
        JOIN documents d ON d.id=dm.body_document_id
        WHERE a.origin='discussion_review_source' AND a.deleted_at IS NULL
          AND dm.deleted_at IS NULL
          AND json_extract(aa.selector_json, '$.taskNoteId') IS NOT NULL
          AND (:note_id IS NULL OR json_extract(aa.selector_json, '$.taskNoteId')=:note_id)
          AND (:message_id IS NULL OR dm.id=:message_id)
        """,
        {"note_id": note_id, "message_id": message_id},
    )


def sync_note_reviews(connection: Connection, note_id: str, markdown: str) -> None:
    blocks = {b.message_id: b for b in review_blocks(markdown)}
    reviews = _reviews(connection, note_id=note_id)
    unknown = set(blocks) - {str(row["id"]) for row in reviews}
    if unknown:
        raise repo.WorkspaceRepositoryError(
            "This note contains a review from another note or a deleted review. "
            "Use Insert review to attach it as a new review."
        )
    for row in reviews:
        block = blocks.get(str(row["id"]))
        if block is None:
            repo.delete_discussion_message(
                connection,
                str(row["id"]),
                DiscussionMessageDeleteCommand(revision=int(row["revision"])),
                sync_task_note=False,
            )
        elif block.markdown != row["markdown"]:
            if not block.markdown.strip():
                raise repo.WorkspaceRepositoryError(
                    "Remove the whole review block to delete an empty review."
                )
            repo.update_discussion_message(
                connection,
                str(row["id"]),
                DiscussionMessageUpdateCommand(
                    revision=int(row["revision"]),
                    document_revision=int(row["document_revision"]),
                    markdown=block.markdown,
                ),
                sync_task_note=False,
                export_artifacts=False,
            )


def sync_message_review(connection: Connection, message_id: str, markdown: str | None) -> bool:
    reviews = _reviews(connection, message_id=message_id)
    if not reviews:
        return False
    review = reviews[0]
    note = repo._one_or_none(
        connection,
        """
        SELECT n.*, d.markdown, d.revision AS document_revision
        FROM notes n JOIN documents d ON d.id=n.document_id
        WHERE n.id=:id AND n.deleted_at IS NULL
        """,
        {"id": review["note_id"]},
    )
    if note is None:
        raise repo.WorkspaceRepositoryError("The task note for this review no longer exists.")
    source = str(note["markdown"] or "")
    block = next((b for b in review_blocks(source) if b.message_id == message_id), None)
    if block is None:
        raise repo.WorkspaceRepositoryError("The review boundary is missing from its task note.")
    replacement = tagged_review(message_id, markdown) if markdown is not None else ""
    if replacement and block.end < len(source):
        replacement += "\n"
    updated = source[: block.start] + replacement + source[block.end :]
    repo.upsert_note(
        connection,
        NoteUpsertCommand(
            course_id=str(note["course_id"]),
            entity_type="task",
            entity_id=str(review["task_id"]),
            note_id=str(note["id"]),
            note_revision=int(note["revision"]),
            document_revision=int(note["document_revision"]),
            kind=str(note["kind"]),
            attention=note["attention"],
            markdown=updated,
        ),
        sync_task_reviews=False,
    )
    return True


def import_task_review(
    connection: Connection, task_id: str, command: TaskTutorReviewCommand
) -> TaskTutorReviewResponse:
    # Serialize the entire read/check/write envelope, including first-note creation.
    connection.execute(text("BEGIN IMMEDIATE"))
    task = repo._one_or_none(
        connection,
        """
        SELECT t.*, sd.course_id, sd.number, d.markdown AS info
        FROM tasks t JOIN study_days sd ON sd.id=t.day_id
        LEFT JOIN documents d ON d.id=t.rationale_document_id
        WHERE t.id=:id AND t.deleted_at IS NULL AND sd.deleted_at IS NULL
        """,
        {"id": task_id},
    )
    if task is None:
        raise repo.EntityNotFoundError(f"Task does not exist: {task_id}")
    digest = hashlib.sha256(command.model_dump_json().encode()).hexdigest()
    receipt = repo._one_or_none(
        connection,
        """
        SELECT aa.selector_json, aa.annotation_id, aa.discussion_message_id, dm.thread_id,
               a.deleted_at, dm.deleted_at AS message_deleted_at
        FROM annotation_anchors aa JOIN annotations a ON a.id=aa.annotation_id
        JOIN discussion_messages dm ON dm.id=aa.discussion_message_id
        WHERE json_extract(aa.selector_json, '$.taskReviewImportId')=:id
        """,
        {"id": command.import_id},
    )
    if receipt:
        metadata = json.loads(str(receipt["selector_json"]))
        if metadata.get("taskId") != task_id or metadata.get("importHash") != digest:
            raise repo.WorkspaceRepositoryError(
                "This import ID was already used for different content."
            )
        if receipt["deleted_at"] or receipt["message_deleted_at"]:
            raise repo.WorkspaceRepositoryError(
                "This review was already imported and later deleted."
            )
        return TaskTutorReviewResponse(
            discussion_id=str(receipt["thread_id"]),
            note_id=metadata["taskNoteId"],
            message_id=str(receipt["discussion_message_id"]),
            question_id=str(receipt["annotation_id"]),
        )
    review = command.review_markdown.strip()
    if not review or review_blocks(review):
        raise repo.WorkspaceRepositoryError(
            "Paste the review text without existing review boundaries."
        )
    notes = repo._rows(
        connection,
        """
        SELECT n.*, d.markdown, d.revision AS document_revision
        FROM notes n JOIN note_links nl ON nl.note_id=n.id
        JOIN documents d ON d.id=n.document_id
        WHERE nl.entity_type='task' AND nl.entity_id=:id AND nl.relation='primary'
          AND n.kind='task' AND n.deleted_at IS NULL
        """,
        {"id": task_id},
    )
    if len(notes) > 1:
        raise repo.WorkspaceRepositoryError(
            "This task has multiple task notes; merge them before importing."
        )
    note = notes[0] if notes else None
    if (note is None and command.note_id is not None) or (
        note is not None
        and (
            note["id"] != command.note_id
            or note["revision"] != command.note_revision
            or note["document_revision"] != command.document_revision
        )
    ):
        raise repo.RevisionConflictError(
            "The task note changed. Reload and review it before importing."
        )
    course_id = str(task["course_id"])
    source = str(note["markdown"] or "") if note else ""
    context = "\n\n".join(
        part
        for part in [f"# {task['title']}", str(task["info"] or ""), original_note(source)]
        if part
    )
    discussion_id = command.discussion_id
    if discussion_id:
        thread = repo._one_or_none(
            connection,
            """
            SELECT dt.id FROM discussion_threads dt
            JOIN prompt_batches pb ON pb.id=dt.initial_prompt_batch_id
            WHERE dt.id=:id AND dt.course_id=:course_id AND pb.source_day_id=:day_id
              AND dt.deleted_at IS NULL AND dt.status!='archived'
            """,
            {"id": discussion_id, "course_id": course_id, "day_id": task["day_id"]},
        )
        if thread is None:
            raise repo.WorkspaceRepositoryError(
                "Choose an active discussion belonging to this task's day."
            )
    else:
        now, batch_id = repo._now(), repo._new_id()
        document_id = repo._create_document(
            connection,
            markdown=context,
            editor_json=None,
            plain_text=context,
            reason="task_review_context",
            timestamp=now,
        )
        connection.execute(
            text("""
            INSERT INTO prompt_batches (id, course_id, title, prompt_document_id, source_scope,
              source_day_id, source_task_id, status, created_at, updated_at)
            VALUES (:id,:course_id,:title,:document_id,'task_review',
                    :day_id,:task_id,'draft',:now,:now)
            """),
            {
                "id": batch_id,
                "course_id": course_id,
                "title": f"Day {task['number']} · Task reviews",
                "document_id": document_id,
                "day_id": task["day_id"],
                "task_id": task_id,
                "now": now,
            },
        )
        discussion_id = repo.create_discussion(
            connection,
            DiscussionCreateCommand(course_id=course_id, initial_prompt_batch_id=batch_id),
        ).id
    message = repo.create_discussion_message(
        connection,
        discussion_id,
        DiscussionMessageCreateCommand(
            role="assistant", markdown=review, imported_from_clipboard=True
        ),
        export_artifacts=False,
    )
    appended = source + ("\n\n" if source else "") + tagged_review(message.id, review)
    saved_note = repo.upsert_note(
        connection,
        NoteUpsertCommand(
            course_id=course_id,
            entity_type="task",
            entity_id=task_id,
            kind="task",
            markdown=appended,
            note_id=command.note_id,
            note_revision=command.note_revision,
            document_revision=command.document_revision,
            attention=note["attention"] if note else "none",
        ),
        sync_task_reviews=False,
    )
    thread_resource = connection.execute(
        text("SELECT resource_id FROM discussion_threads WHERE id=:id"), {"id": discussion_id}
    ).scalar_one()
    root = repo.create_annotation(
        connection,
        AnnotationCreateCommand(
            resource_id=str(thread_resource),
            kind="question",
            origin="discussion_review_source",
            markdown=context,
            plain_text=context,
            anchor=AnnotationAnchorCreate(
                anchor_type="discussion_message",
                discussion_message_id=message.id,
                quote=str(task["title"]),
                metadata={
                    "reviewSource": True,
                    "taskId": task_id,
                    "createdDayId": task["day_id"],
                    "taskNoteId": saved_note.id,
                    "taskReviewImportId": command.import_id,
                    "importHash": digest,
                },
            ),
        ),
    )
    repo._set_discussion_message_annotation(
        connection,
        message_id=message.id,
        annotation_id=root.id,
        relation="references",
        course_id=course_id,
        timestamp=repo._now(),
        update_question_status=False,
    )
    for answer in command.answers:
        if not answer.markdown.strip() or not answer.annotation_links:
            raise repo.WorkspaceRepositoryError("Question answers need text and a mapped question.")
        repo.create_discussion_message(
            connection,
            discussion_id,
            DiscussionMessageCreateCommand(
                role="assistant",
                markdown=answer.markdown,
                plain_text=answer.plain_text,
                annotation_links=answer.annotation_links,
                imported_from_clipboard=True,
            ),
            export_artifacts=False,
        )
    return TaskTutorReviewResponse(
        discussion_id=discussion_id,
        note_id=saved_note.id,
        message_id=message.id,
        question_id=root.id,
    )
