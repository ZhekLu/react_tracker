from __future__ import annotations

import hashlib
import json
import uuid
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from datetime import UTC, datetime
from typing import Any, cast

from sqlalchemy import Connection, RowMapping, text

from ..schemas.workspace import (
    Annotation,
    AnnotationAnchor,
    AnnotationCommand,
    CourseListResponse,
    CourseStats,
    CourseSummary,
    CourseWorkspace,
    DayProgress,
    DaySection,
    DayStatusCommand,
    Discussion,
    DiscussionCreateCommand,
    DiscussionMessage,
    DiscussionMessageCreateCommand,
    DocumentContent,
    Exam,
    ExamQuestion,
    ExamStatusCommand,
    MutationResponse,
    Note,
    NoteLink,
    NoteUpsertCommand,
    Resource,
    ResourceStatusCommand,
    ResourceVersion,
    Skill,
    StudyDay,
    Task,
    TaskStatusCommand,
)


class WorkspaceRepositoryError(RuntimeError):
    """Base class for workspace repository errors."""


class EntityNotFoundError(WorkspaceRepositoryError):
    """Raised when an entity id does not exist."""


class RevisionConflictError(WorkspaceRepositoryError):
    """Raised when the caller edits a stale revision."""


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _new_id() -> str:
    return str(uuid.uuid4())


def _rows(
    connection: Connection,
    statement: str,
    params: Mapping[str, object] | None = None,
) -> list[RowMapping]:
    return list(connection.execute(text(statement), params or {}).mappings())


def _one_or_none(
    connection: Connection,
    statement: str,
    params: Mapping[str, object] | None = None,
) -> RowMapping | None:
    return connection.execute(text(statement), params or {}).mappings().one_or_none()


def _json_loads[T](value: object, fallback: T) -> T:
    if value is None:
        return fallback
    if isinstance(value, (dict, list)):
        return cast(T, value)
    if not isinstance(value, str) or not value.strip():
        return fallback
    try:
        return cast(T, json.loads(value))
    except json.JSONDecodeError:
        return fallback


def _json_dumps(value: object | None) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _as_bool(value: object) -> bool:
    return bool(int(cast(Any, value or 0)))


def _as_float(value: object, default: float = 0.0) -> float:
    if value is None:
        return default
    return float(cast(Any, value))


def _document(row: Mapping[str, Any]) -> DocumentContent:
    return DocumentContent(
        id=str(row["id"]),
        canonical_format=cast(Any, row["canonical_format"]),
        markdown=cast(str | None, row["markdown"]),
        editor_json=_json_loads(row["editor_json"], None),
        plain_text=str(row["plain_text"] or ""),
        revision=int(cast(Any, row["revision"])),
        updated_at=str(row["updated_at"]),
    )


def _document_map(connection: Connection) -> dict[str, DocumentContent]:
    return {
        str(row["id"]): _document(cast(Mapping[str, Any], row))
        for row in _rows(
            connection,
            """
            SELECT id, canonical_format, markdown, editor_json, plain_text, revision, updated_at
            FROM documents
            WHERE deleted_at IS NULL
            """,
        )
    }


def _links_by_note(connection: Connection, course_id: str) -> dict[str, list[NoteLink]]:
    links: dict[str, list[NoteLink]] = defaultdict(list)
    for row in _rows(
        connection,
        """
        SELECT nl.note_id, nl.entity_type, nl.entity_id, nl.relation
        FROM note_links nl
        JOIN notes n ON n.id = nl.note_id
        WHERE n.course_id = :course_id AND n.deleted_at IS NULL
        ORDER BY nl.relation, nl.entity_type, nl.entity_id
        """,
        {"course_id": course_id},
    ):
        links[str(row["note_id"])].append(
            NoteLink(
                entity_type=str(row["entity_type"]),
                entity_id=str(row["entity_id"]),
                relation=cast(Any, row["relation"]),
            )
        )
    return links


def _notes_by_entity(
    connection: Connection,
    course_id: str,
    documents: Mapping[str, DocumentContent],
) -> tuple[list[Note], dict[tuple[str, str], list[Note]]]:
    note_links = _links_by_note(connection, course_id)
    notes: list[Note] = []
    by_entity: dict[tuple[str, str], list[Note]] = defaultdict(list)
    for row in _rows(
        connection,
        """
        SELECT id, course_id, document_id, kind, status, created_at, updated_at, revision
        FROM notes
        WHERE course_id = :course_id AND deleted_at IS NULL
        ORDER BY created_at
        """,
        {"course_id": course_id},
    ):
        document = documents.get(str(row["document_id"]))
        if document is None:
            continue
        links = note_links.get(str(row["id"]), [])
        note = Note(
            id=str(row["id"]),
            course_id=str(row["course_id"]),
            kind=str(row["kind"]),
            status=cast(Any, row["status"]),
            revision=int(row["revision"]),
            document=document,
            links=links,
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )
        notes.append(note)
        for link in links:
            by_entity[(link.entity_type, link.entity_id)].append(note)
    return notes, by_entity


def _resource_versions(connection: Connection, course_id: str) -> dict[str, ResourceVersion]:
    versions: dict[str, ResourceVersion] = {}
    for row in _rows(
        connection,
        """
        SELECT
          rv.id, rv.resource_id, rv.version_number, rv.storage_type, rv.local_path,
          rv.source_url, rv.file_name, rv.mime_type, rv.page_count,
          r.current_version_id
        FROM resource_versions rv
        JOIN resources r ON r.id = rv.resource_id
        WHERE r.course_id = :course_id AND r.deleted_at IS NULL
        ORDER BY rv.resource_id, rv.version_number
        """,
        {"course_id": course_id},
    ):
        version = ResourceVersion(
            id=str(row["id"]),
            version_number=int(row["version_number"]),
            storage_type=str(row["storage_type"]),
            local_path=cast(str | None, row["local_path"]),
            source_url=cast(str | None, row["source_url"]),
            file_name=cast(str | None, row["file_name"]),
            mime_type=cast(str | None, row["mime_type"]),
            page_count=cast(int | None, row["page_count"]),
        )
        current_version_id = row["current_version_id"]
        if current_version_id == row["id"] or str(row["resource_id"]) not in versions:
            versions[str(row["resource_id"])] = version
    return versions


def _resource_progress(connection: Connection, course_id: str) -> dict[str, float]:
    return {
        str(row["resource_id"]): _as_float(row["progress_percent"]) / 100.0
        for row in _rows(
            connection,
            """
            SELECT rrp.resource_id, MAX(rrp.progress_percent) AS progress_percent
            FROM resource_reading_progress rrp
            JOIN resources r ON r.id = rrp.resource_id
            WHERE r.course_id = :course_id AND r.deleted_at IS NULL
            GROUP BY rrp.resource_id
            """,
            {"course_id": course_id},
        )
    }


def _task_resources(connection: Connection, course_id: str) -> tuple[
    dict[str, list[str]],
    dict[str, list[str]],
    dict[str, list[str]],
]:
    task_to_resources: dict[str, list[str]] = defaultdict(list)
    task_to_exam_questions: dict[str, list[str]] = defaultdict(list)
    resource_to_tasks: dict[str, list[str]] = defaultdict(list)
    for row in _rows(
        connection,
        """
        SELECT tr.task_id, tr.resource_id, r.kind
        FROM task_resources tr
        JOIN tasks t ON t.id = tr.task_id
        JOIN resources r ON r.id = tr.resource_id
        WHERE t.deleted_at IS NULL AND r.course_id = :course_id AND r.deleted_at IS NULL
        ORDER BY tr.task_id, tr.order_index
        """,
        {"course_id": course_id},
    ):
        task_id = str(row["task_id"])
        resource_id = str(row["resource_id"])
        if row["kind"] == "exam_question":
            task_to_exam_questions[task_id].append(resource_id)
        else:
            task_to_resources[task_id].append(resource_id)
        resource_to_tasks[resource_id].append(task_id)
    return task_to_resources, task_to_exam_questions, resource_to_tasks


def _resource_days(connection: Connection, course_id: str) -> dict[str, list[str]]:
    resource_to_days: dict[str, list[str]] = defaultdict(list)
    for row in _rows(
        connection,
        """
        SELECT DISTINCT tr.resource_id, t.day_id
        FROM task_resources tr
        JOIN tasks t ON t.id = tr.task_id
        JOIN resources r ON r.id = tr.resource_id
        WHERE r.course_id = :course_id AND r.deleted_at IS NULL AND t.deleted_at IS NULL
        ORDER BY t.day_id
        """,
        {"course_id": course_id},
    ):
        resource_to_days[str(row["resource_id"])].append(str(row["day_id"]))
    return resource_to_days


def _day_skills(
    connection: Connection,
    course_id: str,
) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    day_to_skills: dict[str, list[str]] = defaultdict(list)
    skill_to_days: dict[str, list[str]] = defaultdict(list)
    for row in _rows(
        connection,
        """
        SELECT ds.day_id, ds.skill_id
        FROM day_skills ds
        JOIN study_days d ON d.id = ds.day_id
        WHERE d.course_id = :course_id AND d.deleted_at IS NULL
        ORDER BY d.order_index, ds.skill_id
        """,
        {"course_id": course_id},
    ):
        day_id = str(row["day_id"])
        skill_id = str(row["skill_id"])
        day_to_skills[day_id].append(skill_id)
        skill_to_days[skill_id].append(day_id)
    return day_to_skills, skill_to_days


def _annotations(
    connection: Connection,
    course_id: str,
    documents: Mapping[str, DocumentContent],
) -> tuple[list[Annotation], dict[str, list[Annotation]]]:
    annotations: list[Annotation] = []
    by_resource: dict[str, list[Annotation]] = defaultdict(list)
    for row in _rows(
        connection,
        """
        SELECT
          a.id, a.resource_id, a.body_document_id, a.kind, a.status, a.priority,
          a.origin, a.created_at, a.updated_at, a.revision,
          aa.anchor_type, aa.quote, aa.section_title, aa.source_line_start,
          aa.source_line_end, aa.page_number, aa.rect_json, aa.color,
          aa.discussion_message_id, aa.selector_json, aa.rgb_json
        FROM annotations a
        JOIN resources r ON r.id = a.resource_id
        LEFT JOIN annotation_anchors aa ON aa.annotation_id = a.id
        WHERE r.course_id = :course_id AND a.deleted_at IS NULL AND r.deleted_at IS NULL
        ORDER BY a.created_at
        """,
        {"course_id": course_id},
    ):
        metadata = {
            "selector": _json_loads(row["selector_json"], None),
            "rgb": _json_loads(row["rgb_json"], None),
        }
        metadata = {key: value for key, value in metadata.items() if value is not None}
        anchor = None
        if row["anchor_type"] is not None:
            anchor = AnnotationAnchor(
                anchor_type=str(row["anchor_type"]),
                quote=cast(str | None, row["quote"]),
                section_title=cast(str | None, row["section_title"]),
                source_line_start=cast(int | None, row["source_line_start"]),
                source_line_end=cast(int | None, row["source_line_end"]),
                page_number=cast(int | None, row["page_number"]),
                rect=_json_loads(row["rect_json"], None),
                color=cast(str | None, row["color"]),
                discussion_message_id=cast(str | None, row["discussion_message_id"]),
                metadata=metadata,
            )
        annotation = Annotation(
            id=str(row["id"]),
            resource_id=str(row["resource_id"]),
            kind=cast(Any, row["kind"]),
            status=cast(Any, row["status"]),
            priority=cast(Any, row["priority"]),
            origin=str(row["origin"]),
            revision=int(row["revision"]),
            body=documents.get(str(row["body_document_id"])) if row["body_document_id"] else None,
            anchor=anchor,
            created_at=str(row["created_at"]),
            updated_at=str(row["updated_at"]),
        )
        annotations.append(annotation)
        by_resource[annotation.resource_id].append(annotation)
    return annotations, by_resource


def _open_question_count(annotations: Iterable[Annotation]) -> int:
    return sum(
        1
        for annotation in annotations
        if annotation.kind in {"question", "todo"} and annotation.status == "open"
    )


def _day_progress(row: Mapping[str, Any]) -> DayProgress:
    return DayProgress(
        required=int(cast(Any, row["required_task_count"] or 0)),
        done=int(cast(Any, row["completed_required_count"] or 0)),
        later=int(cast(Any, row["deferred_required_count"] or 0)),
        skipped=int(cast(Any, row["skipped_required_count"] or 0)),
        optional=int(cast(Any, row["optional_task_count"] or 0)),
        ratio=_as_float(row["completion_ratio"]),
    )


def _empty_day_progress() -> DayProgress:
    return DayProgress(required=0, done=0, later=0, skipped=0, optional=0, ratio=0)


def _summaries_from_rows(
    course_rows: Sequence[RowMapping],
    stats_by_course: Mapping[str, CourseStats],
) -> list[CourseSummary]:
    summaries: list[CourseSummary] = []
    for row in course_rows:
        course_id = str(row["id"])
        summaries.append(
            CourseSummary(
                id=course_id,
                title=str(row["title"]),
                short_code=str(row["short_code"] or row["title"]),
                subtitle=cast(str | None, row["subtitle"]),
                accent_color=str(row["accent_color"] or "#2f70ba"),
                icon_uri=cast(str | None, row["icon_uri"]),
                deadline=cast(str | None, row["deadline"]),
                status=str(row["status"]),
                revision=int(row["revision"]),
                stats=stats_by_course.get(course_id, _empty_stats()),
            )
        )
    return summaries


def _empty_stats() -> CourseStats:
    return CourseStats(
        day_count=0,
        task_count=0,
        completed_task_count=0,
        resource_count=0,
        read_resource_count=0,
        exam_question_count=0,
        solved_exam_question_count=0,
        open_question_count=0,
        do_later_count=0,
        skill_count=0,
        tracked_seconds=0,
        progress_ratio=0,
    )


def _course_rows(connection: Connection) -> list[RowMapping]:
    return _rows(
        connection,
        """
        SELECT id, title, short_code, subtitle, accent_color, icon_uri, deadline, status, revision
        FROM courses
        WHERE deleted_at IS NULL
        ORDER BY title
        """,
    )


def list_courses(connection: Connection) -> CourseListResponse:
    course_rows = _course_rows(connection)
    stats_by_course = {
        str(row["course_id"]): CourseStats(
            day_count=int(row["day_count"] or 0),
            task_count=int(row["task_count"] or 0),
            completed_task_count=int(row["completed_task_count"] or 0),
            resource_count=int(row["resource_count"] or 0),
            read_resource_count=int(row["read_resource_count"] or 0),
            exam_question_count=int(row["exam_question_count"] or 0),
            solved_exam_question_count=int(row["solved_exam_question_count"] or 0),
            open_question_count=int(row["open_question_count"] or 0),
            do_later_count=int(row["do_later_count"] or 0),
            skill_count=int(row["skill_count"] or 0),
            tracked_seconds=int(row["tracked_seconds"] or 0),
            progress_ratio=_as_float(row["progress_ratio"]),
        )
        for row in _rows(
            connection,
            """
            WITH
            task_stats AS (
              SELECT
                d.course_id,
                COUNT(t.id) AS task_count,
                COUNT(t.id) FILTER (WHERE t.status = 'done') AS completed_task_count,
                COUNT(t.id) FILTER (WHERE t.status = 'later') AS do_later_count,
                AVG(dp.completion_ratio) AS progress_ratio
              FROM study_days d
              LEFT JOIN tasks t ON t.day_id = d.id AND t.deleted_at IS NULL
              LEFT JOIN day_progress dp ON dp.day_id = d.id
              WHERE d.deleted_at IS NULL
              GROUP BY d.course_id
            ),
            resource_stats AS (
              SELECT
                course_id,
                COUNT(id) FILTER (WHERE kind <> 'exam_question') AS resource_count,
                COUNT(id) FILTER (
                  WHERE kind <> 'exam_question' AND status IN ('read', 'review')
                ) AS read_resource_count,
                COUNT(id) FILTER (WHERE kind = 'exam_question') AS exam_question_count
              FROM resources
              WHERE deleted_at IS NULL
              GROUP BY course_id
            ),
            exam_stats AS (
              SELECT
                r.course_id,
                COUNT(e.resource_id) FILTER (WHERE e.solve_status IN ('solved', 'review'))
                  AS solved_exam_question_count
              FROM exam_question_details e
              JOIN resources r ON r.id = e.resource_id
              WHERE r.deleted_at IS NULL
              GROUP BY r.course_id
            ),
            annotation_stats AS (
              SELECT
                r.course_id,
                COUNT(a.id) FILTER (
                  WHERE a.kind IN ('question', 'todo') AND a.status = 'open'
                ) AS open_question_count
              FROM annotations a
              JOIN resources r ON r.id = a.resource_id
              WHERE a.deleted_at IS NULL AND r.deleted_at IS NULL
              GROUP BY r.course_id
            )
            SELECT
              c.id AS course_id,
              COUNT(DISTINCT d.id) AS day_count,
              COALESCE(ts.task_count, 0) AS task_count,
              COALESCE(ts.completed_task_count, 0) AS completed_task_count,
              COALESCE(rs.resource_count, 0) AS resource_count,
              COALESCE(rs.read_resource_count, 0) AS read_resource_count,
              COALESCE(rs.exam_question_count, 0) AS exam_question_count,
              COALESCE(es.solved_exam_question_count, 0) AS solved_exam_question_count,
              COALESCE(ans.open_question_count, 0) AS open_question_count,
              COALESCE(ts.do_later_count, 0) AS do_later_count,
              COUNT(DISTINCT s.id) AS skill_count,
              COALESCE(cts.tracked_seconds, 0) AS tracked_seconds,
              COALESCE(ts.progress_ratio, 0) AS progress_ratio
            FROM courses c
            LEFT JOIN study_days d ON d.course_id = c.id AND d.deleted_at IS NULL
            LEFT JOIN skills s ON s.course_id = c.id AND s.deleted_at IS NULL
            LEFT JOIN task_stats ts ON ts.course_id = c.id
            LEFT JOIN resource_stats rs ON rs.course_id = c.id
            LEFT JOIN exam_stats es ON es.course_id = c.id
            LEFT JOIN annotation_stats ans ON ans.course_id = c.id
            LEFT JOIN course_time_summary cts ON cts.course_id = c.id
            WHERE c.deleted_at IS NULL
            GROUP BY c.id
            """,
        )
    }
    return CourseListResponse(courses=_summaries_from_rows(course_rows, stats_by_course))


def get_workspace(connection: Connection, course_id: str) -> CourseWorkspace:
    course_row = _one_or_none(
        connection,
        """
        SELECT id, title, short_code, subtitle, accent_color, icon_uri, deadline, status, revision
        FROM courses
        WHERE id = :course_id AND deleted_at IS NULL
        """,
        {"course_id": course_id},
    )
    if course_row is None:
        raise EntityNotFoundError(f"Course does not exist: {course_id}")

    documents = _document_map(connection)
    notes, notes_by_entity = _notes_by_entity(connection, course_id, documents)
    annotations, annotations_by_resource = _annotations(connection, course_id, documents)
    task_to_resources, task_to_exam_questions, resource_to_tasks = _task_resources(
        connection,
        course_id,
    )
    resource_to_days = _resource_days(connection, course_id)
    day_to_skills, skill_to_days = _day_skills(connection, course_id)
    versions = _resource_versions(connection, course_id)
    progress_by_resource = _resource_progress(connection, course_id)

    day_progress = {
        str(row["day_id"]): _day_progress(cast(Mapping[str, Any], row))
        for row in _rows(
            connection,
            """
            SELECT day_id, required_task_count, completed_required_count, deferred_required_count,
                   skipped_required_count, optional_task_count, completion_ratio
            FROM day_progress
            """,
        )
    }
    day_time = {
        str(row["day_id"]): int(row["tracked_seconds"] or 0)
        for row in _rows(connection, "SELECT day_id, tracked_seconds FROM day_time_summary")
    }

    sections_by_day: dict[str, list[DaySection]] = defaultdict(list)
    task_rows = _rows(
        connection,
        """
        SELECT
          t.id, t.day_id, t.section_id, t.title, t.rationale_document_id, t.task_type,
          t.is_optional, t.order_index, t.estimated_minutes, t.status, t.defer_until,
          t.revision
        FROM tasks t
        JOIN study_days d ON d.id = t.day_id
        WHERE d.course_id = :course_id AND t.deleted_at IS NULL AND d.deleted_at IS NULL
        ORDER BY t.day_id, t.order_index
        """,
        {"course_id": course_id},
    )
    tasks_by_section: dict[str | None, list[Task]] = defaultdict(list)
    for row in task_rows:
        task_id = str(row["id"])
        linked_resources = task_to_resources.get(task_id, [])
        linked_questions = task_to_exam_questions.get(task_id, [])
        linked_annotations = [
            annotation
            for resource_id in [*linked_resources, *linked_questions]
            for annotation in annotations_by_resource.get(resource_id, [])
        ]
        task = Task(
            id=task_id,
            day_id=str(row["day_id"]),
            section_id=cast(str | None, row["section_id"]),
            title=str(row["title"]),
            task_type=cast(str | None, row["task_type"]),
            is_optional=_as_bool(row["is_optional"]),
            order_index=int(row["order_index"]),
            estimated_minutes=cast(int | None, row["estimated_minutes"]),
            status=cast(Any, row["status"]),
            defer_until=cast(str | None, row["defer_until"]),
            revision=int(row["revision"]),
            resource_ids=linked_resources,
            exam_question_ids=linked_questions,
            skill_ids=[],
            rationale=documents.get(str(row["rationale_document_id"]))
            if row["rationale_document_id"]
            else None,
            notes=notes_by_entity.get(("task", task_id), []),
            open_question_count=_open_question_count(linked_annotations),
        )
        tasks_by_section[task.section_id].append(task)

    section_rows = _rows(
        connection,
        """
        SELECT id, day_id, title, order_index, default_collapsed
        FROM day_sections
        WHERE day_id IN (
          SELECT id FROM study_days WHERE course_id = :course_id AND deleted_at IS NULL
        )
          AND deleted_at IS NULL
        ORDER BY day_id, order_index
        """,
        {"course_id": course_id},
    )
    for row in section_rows:
        section_id = str(row["id"])
        sections_by_day[str(row["day_id"])].append(
            DaySection(
                id=section_id,
                title=str(row["title"]),
                order_index=int(row["order_index"]),
                default_collapsed=_as_bool(row["default_collapsed"]),
                tasks=tasks_by_section.get(section_id, []),
            )
        )

    days: list[StudyDay] = []
    for row in _rows(
        connection,
        """
        SELECT id, number, date, title, topic, purpose, status, order_index, revision
        FROM study_days
        WHERE course_id = :course_id AND deleted_at IS NULL
        ORDER BY order_index
        """,
        {"course_id": course_id},
    ):
        day_id = str(row["id"])
        orphan_tasks = tasks_by_section.get(None, [])
        day_orphan_tasks = [task for task in orphan_tasks if task.day_id == day_id]
        day_sections = sections_by_day.get(day_id, [])
        if day_orphan_tasks:
            day_sections = [
                *day_sections,
                DaySection(
                    id=f"{day_id}:unsectioned",
                    title="Unsectioned",
                    order_index=999999,
                    default_collapsed=False,
                    tasks=day_orphan_tasks,
                ),
            ]
        linked_resource_ids = [
            resource_id
            for section in day_sections
            for task in section.tasks
            for resource_id in [*task.resource_ids, *task.exam_question_ids]
        ]
        linked_annotations = [
            annotation
            for resource_id in linked_resource_ids
            for annotation in annotations_by_resource.get(resource_id, [])
        ]
        days.append(
            StudyDay(
                id=day_id,
                number=int(row["number"]),
                date=cast(str | None, row["date"]),
                title=str(row["title"]),
                topic=cast(str | None, row["topic"]),
                purpose=cast(str | None, row["purpose"]),
                status=cast(Any, row["status"]),
                revision=int(row["revision"]),
                sections=day_sections,
                notes=notes_by_entity.get(("day", day_id), []),
                skill_ids=day_to_skills.get(day_id, []),
                open_question_count=_open_question_count(linked_annotations),
                tracked_seconds=day_time.get(day_id, 0),
                progress=day_progress.get(day_id, _empty_day_progress()),
            )
        )

    resources = _resources(
        connection,
        course_id,
        versions,
        progress_by_resource,
        resource_to_days,
        resource_to_tasks,
        notes_by_entity,
        annotations_by_resource,
    )
    exams = _exams(
        connection,
        course_id,
        versions,
        documents,
        notes_by_entity,
        annotations_by_resource,
    )
    skills = _skills(connection, course_id, documents, skill_to_days, days)
    discussions = _discussions(connection, course_id, documents)

    stats = _workspace_stats(days, resources, exams, skills, annotations)
    course = CourseSummary(
        id=str(course_row["id"]),
        title=str(course_row["title"]),
        short_code=str(course_row["short_code"] or course_row["title"]),
        subtitle=cast(str | None, course_row["subtitle"]),
        accent_color=str(course_row["accent_color"] or "#2f70ba"),
        icon_uri=cast(str | None, course_row["icon_uri"]),
        deadline=cast(str | None, course_row["deadline"]),
        status=str(course_row["status"]),
        revision=int(course_row["revision"]),
        stats=stats,
    )
    return CourseWorkspace(
        course=course,
        days=days,
        resources=resources,
        exams=exams,
        skills=skills,
        discussions=discussions,
        notes=notes,
        annotations=annotations,
    )


def _resources(
    connection: Connection,
    course_id: str,
    versions: Mapping[str, ResourceVersion],
    progress_by_resource: Mapping[str, float],
    resource_to_days: Mapping[str, list[str]],
    resource_to_tasks: Mapping[str, list[str]],
    notes_by_entity: Mapping[tuple[str, str], list[Note]],
    annotations_by_resource: Mapping[str, list[Annotation]],
) -> list[Resource]:
    resources: list[Resource] = []
    for row in _rows(
        connection,
        """
        SELECT id, parent_resource_id, title, kind, format, source_type, category,
               authors_json, publication_year, canonical_url, status, revision
        FROM resources
        WHERE course_id = :course_id AND deleted_at IS NULL
        ORDER BY kind, category, title
        """,
        {"course_id": course_id},
    ):
        resource_id = str(row["id"])
        resource_annotations = annotations_by_resource.get(resource_id, [])
        resources.append(
            Resource(
                id=resource_id,
                parent_resource_id=cast(str | None, row["parent_resource_id"]),
                title=str(row["title"]),
                kind=str(row["kind"]),
                format=str(row["format"]),
                source_type=str(row["source_type"]),
                category=cast(str | None, row["category"]),
                authors=_json_loads(row["authors_json"], []),
                publication_year=cast(int | None, row["publication_year"]),
                canonical_url=cast(str | None, row["canonical_url"]),
                status=cast(Any, row["status"]),
                revision=int(row["revision"]),
                version=versions.get(resource_id),
                progress_percent=progress_by_resource.get(resource_id, 0),
                day_ids=resource_to_days.get(resource_id, []),
                task_ids=resource_to_tasks.get(resource_id, []),
                notes=notes_by_entity.get(("resource", resource_id), []),
                annotations=resource_annotations,
                open_question_count=_open_question_count(resource_annotations),
            )
        )
    return resources


def _exams(
    connection: Connection,
    course_id: str,
    versions: Mapping[str, ResourceVersion],
    documents: Mapping[str, DocumentContent],
    notes_by_entity: Mapping[tuple[str, str], list[Note]],
    annotations_by_resource: Mapping[str, list[Annotation]],
) -> list[Exam]:
    question_rows = _rows(
        connection,
        """
        SELECT
          r.id, r.parent_resource_id, r.title, e.part, e.question_number, e.topic,
          e.points, e.order_index, e.prompt_document_id, e.solve_status, r.revision
        FROM exam_question_details e
        JOIN resources r ON r.id = e.resource_id
        WHERE r.course_id = :course_id AND r.deleted_at IS NULL
        ORDER BY r.parent_resource_id, e.order_index, r.title
        """,
        {"course_id": course_id},
    )
    questions_by_exam: dict[str, list[ExamQuestion]] = defaultdict(list)
    for row in question_rows:
        question_id = str(row["id"])
        resource_annotations = annotations_by_resource.get(question_id, [])
        label = str(row["question_number"] or row["title"])
        questions_by_exam[str(row["parent_resource_id"] or "unassigned")].append(
            ExamQuestion(
                id=question_id,
                label=label,
                part=cast(str | None, row["part"]),
                topic=cast(str | None, row["topic"]),
                points=cast(float | None, row["points"]),
                order_index=int(row["order_index"]),
                solve_status=cast(Any, row["solve_status"]),
                prompt=documents.get(str(row["prompt_document_id"]))
                if row["prompt_document_id"]
                else None,
                notes=notes_by_entity.get(("exam_question", question_id), []),
                annotations=resource_annotations,
                open_question_count=_open_question_count(resource_annotations),
                revision=int(row["revision"]),
            )
        )

    exams: list[Exam] = []
    for row in _rows(
        connection,
        """
        SELECT id, title, category
        FROM resources
        WHERE course_id = :course_id
          AND kind IN ('exam', 'exercise')
          AND deleted_at IS NULL
        ORDER BY CASE kind WHEN 'exam' THEN 0 ELSE 1 END, title
        """,
        {"course_id": course_id},
    ):
        exam_id = str(row["id"])
        version = versions.get(exam_id)
        exams.append(
            Exam(
                id=exam_id,
                title=str(row["title"]),
                category=cast(str | None, row["category"]),
                source_path=version.local_path if version else None,
                questions=questions_by_exam.get(exam_id, []),
            )
        )
    if questions_by_exam.get("unassigned"):
        exams.append(
            Exam(
                id="unassigned-exam-questions",
                title="Unassigned exam questions",
                category="exam",
                source_path=None,
                questions=questions_by_exam["unassigned"],
            )
        )
    return exams


def _skills(
    connection: Connection,
    course_id: str,
    documents: Mapping[str, DocumentContent],
    skill_to_days: Mapping[str, list[str]],
    days: Sequence[StudyDay],
) -> list[Skill]:
    day_status = {day.id: day.status for day in days}
    skills: list[Skill] = []
    for row in _rows(
        connection,
        """
        SELECT id, name, category, description_document_id, confidence
        FROM skills
        WHERE course_id = :course_id AND deleted_at IS NULL
        ORDER BY COALESCE(order_index, 999999), name
        """,
        {"course_id": course_id},
    ):
        skill_id = str(row["id"])
        day_ids = skill_to_days.get(skill_id, [])
        completed_day_count = sum(
            1 for day_id in day_ids if day_status.get(day_id) in {"closed", "completed"}
        )
        skills.append(
            Skill(
                id=skill_id,
                name=str(row["name"]),
                category=cast(str | None, row["category"]),
                description=documents.get(str(row["description_document_id"]))
                if row["description_document_id"]
                else None,
                confidence=cast(float | None, row["confidence"]),
                day_ids=day_ids,
                completed_day_count=completed_day_count,
            )
        )
    return skills


def _discussions(
    connection: Connection,
    course_id: str,
    documents: Mapping[str, DocumentContent],
) -> list[Discussion]:
    messages_by_thread: dict[str, list[DiscussionMessage]] = defaultdict(list)
    for row in _rows(
        connection,
        """
        SELECT
          dm.id, dm.thread_id, dm.role, dm.sequence_number, dm.body_document_id,
          dm.reply_to_message_id, dm.revision, dm.created_at
        FROM discussion_messages dm
        JOIN discussion_threads dt ON dt.id = dm.thread_id
        WHERE dt.course_id = :course_id AND dt.deleted_at IS NULL AND dm.deleted_at IS NULL
        ORDER BY dm.thread_id, dm.sequence_number
        """,
        {"course_id": course_id},
    ):
        body = documents.get(str(row["body_document_id"]))
        if body is None:
            continue
        messages_by_thread[str(row["thread_id"])].append(
            DiscussionMessage(
                id=str(row["id"]),
                role=cast(Any, row["role"]),
                sequence_number=int(row["sequence_number"]),
                body=body,
                reply_to_message_id=cast(str | None, row["reply_to_message_id"]),
                revision=int(row["revision"]),
                created_at=str(row["created_at"]),
            )
        )

    return [
        Discussion(
            id=str(row["id"]),
            resource_id=str(row["resource_id"]),
            title=f"Discussion: {row['title']}",
            provider=str(row["provider"]),
            status=cast(Any, row["status"]),
            revision=int(row["revision"]),
            messages=messages_by_thread.get(str(row["id"]), []),
        )
        for row in _rows(
            connection,
            """
            SELECT dt.id, dt.resource_id, r.title, dt.provider, dt.status, dt.revision
            FROM discussion_threads dt
            JOIN resources r ON r.id = dt.resource_id
            WHERE dt.course_id = :course_id AND dt.deleted_at IS NULL
            ORDER BY dt.updated_at DESC
            """,
            {"course_id": course_id},
        )
    ]


def _workspace_stats(
    days: Sequence[StudyDay],
    resources: Sequence[Resource],
    exams: Sequence[Exam],
    skills: Sequence[Skill],
    annotations: Sequence[Annotation],
) -> CourseStats:
    tasks = [task for day in days for section in day.sections for task in section.tasks]
    questions = [question for exam in exams for question in exam.questions]
    library_resources = [
        resource for resource in resources if resource.kind != "exam_question"
    ]
    read_resource_count = sum(
        1 for resource in library_resources if resource.status in {"read", "review"}
    )
    return CourseStats(
        day_count=len(days),
        task_count=len(tasks),
        completed_task_count=sum(1 for task in tasks if task.status == "done"),
        resource_count=len(library_resources),
        read_resource_count=read_resource_count,
        exam_question_count=len(questions),
        solved_exam_question_count=sum(
            1 for question in questions if question.solve_status in {"solved", "review"}
        ),
        open_question_count=_open_question_count(annotations),
        do_later_count=sum(1 for task in tasks if task.status == "later"),
        skill_count=len(skills),
        tracked_seconds=sum(day.tracked_seconds for day in days),
        progress_ratio=sum(day.progress.ratio for day in days) / len(days) if days else 0,
    )


def _mutation_result(row: RowMapping) -> MutationResponse:
    return MutationResponse(
        id=str(row["id"]),
        revision=int(row["revision"]),
        updated_at=str(row["updated_at"]),
    )


def _update_with_revision(
    connection: Connection,
    *,
    table_name: str,
    entity_id: str,
    revision: int,
    assignments: str,
    params: Mapping[str, object],
) -> MutationResponse:
    row = _one_or_none(
        connection,
        f"""
        UPDATE {table_name}
        SET {assignments},
            updated_at = :updated_at,
            revision = revision + 1
        WHERE id = :id AND revision = :revision AND deleted_at IS NULL
        RETURNING id, revision, updated_at
        """,
        {"id": entity_id, "revision": revision, "updated_at": _now(), **params},
    )
    if row is not None:
        return _mutation_result(row)
    exists = _one_or_none(
        connection,
        f"SELECT id FROM {table_name} WHERE id = :id",
        {"id": entity_id},
    )
    if exists is None:
        raise EntityNotFoundError(f"{table_name} does not contain id: {entity_id}")
    raise RevisionConflictError(f"Stale revision for {table_name}: {entity_id}")


def update_task_status(
    connection: Connection,
    task_id: str,
    command: TaskStatusCommand,
) -> MutationResponse:
    now = _now()
    return _update_with_revision(
        connection,
        table_name="tasks",
        entity_id=task_id,
        revision=command.revision,
        assignments="""
            status = :status,
            defer_until = :defer_until,
            completed_at = CASE WHEN :status = 'done' THEN :now ELSE completed_at END,
            deferred_at = CASE WHEN :status = 'later' THEN :now ELSE deferred_at END,
            skipped_at = CASE WHEN :status = 'skipped' THEN :now ELSE skipped_at END
        """,
        params={"status": command.status, "defer_until": command.defer_until, "now": now},
    )


def update_day_status(
    connection: Connection,
    day_id: str,
    command: DayStatusCommand,
) -> MutationResponse:
    now = _now()
    return _update_with_revision(
        connection,
        table_name="study_days",
        entity_id=day_id,
        revision=command.revision,
        assignments="""
            status = :status,
            closed_at = CASE WHEN :status IN ('closed', 'completed') THEN :now ELSE closed_at END,
            completed_at = CASE WHEN :status = 'completed' THEN :now ELSE completed_at END
        """,
        params={"status": command.status, "now": now},
    )


def update_resource_status(
    connection: Connection,
    resource_id: str,
    command: ResourceStatusCommand,
) -> MutationResponse:
    now = _now()
    response = _update_with_revision(
        connection,
        table_name="resources",
        entity_id=resource_id,
        revision=command.revision,
        assignments="""
            status = :status,
            completed_at = CASE WHEN :status IN ('read', 'review') THEN :now ELSE completed_at END
        """,
        params={"status": command.status, "now": now},
    )
    percent = 100 if command.status in {"read", "review"} else 0
    connection.execute(
        text(
            """
            INSERT INTO resource_reading_progress (
              id, resource_id, resource_version_id, progress_percent, position_type,
              started_at, last_read_at, completed_at, created_at, updated_at, revision
            )
            VALUES (
              :id, :resource_id, NULL, :progress_percent, 'manual',
              :now, :now, :completed_at, :now, :now, 1
            )
            ON CONFLICT(resource_id) WHERE resource_version_id IS NULL DO UPDATE SET
              progress_percent = excluded.progress_percent,
              last_read_at = excluded.last_read_at,
              completed_at = excluded.completed_at,
              updated_at = excluded.updated_at,
              revision = resource_reading_progress.revision + 1
            """
        ),
        {
            "id": _new_id(),
            "resource_id": resource_id,
            "progress_percent": percent,
            "now": now,
            "completed_at": now if percent == 100 else None,
        },
    )
    return response


def update_exam_question_status(
    connection: Connection,
    question_id: str,
    command: ExamStatusCommand,
) -> MutationResponse:
    now = _now()
    row = _one_or_none(
        connection,
        """
        UPDATE resources
        SET revision = revision + 1, updated_at = :updated_at
        WHERE id = :id AND revision = :revision AND kind = 'exam_question' AND deleted_at IS NULL
        RETURNING id, revision, updated_at
        """,
        {"id": question_id, "revision": command.revision, "updated_at": now},
    )
    if row is None:
        exists = _one_or_none(
            connection,
            "SELECT id FROM resources WHERE id = :id",
            {"id": question_id},
        )
        if exists is None:
            raise EntityNotFoundError(f"Exam question does not exist: {question_id}")
        raise RevisionConflictError(f"Stale revision for exam question: {question_id}")
    connection.execute(
        text(
            """
            UPDATE exam_question_details
            SET solve_status = :status,
                attempted_at = CASE
                  WHEN :status IN ('attempted', 'solved', 'review') THEN :now
                  ELSE attempted_at
                END,
                solved_at = CASE WHEN :status IN ('solved', 'review') THEN :now ELSE solved_at END,
                updated_at = :now
            WHERE resource_id = :id
            """
        ),
        {"id": question_id, "status": command.status, "now": now},
    )
    return _mutation_result(row)


def update_annotation(
    connection: Connection,
    annotation_id: str,
    command: AnnotationCommand,
) -> MutationResponse:
    assignments = [
        "kind = COALESCE(:kind, kind)",
        "status = COALESCE(:status, status)",
        "priority = COALESCE(:priority, priority)",
        "answered_at = CASE WHEN :status = 'answered' THEN :now ELSE answered_at END",
        "archived_at = CASE WHEN :status = 'archived' THEN :now ELSE archived_at END",
    ]
    return _update_with_revision(
        connection,
        table_name="annotations",
        entity_id=annotation_id,
        revision=command.revision,
        assignments=", ".join(assignments),
        params={
            "kind": command.kind,
            "status": command.status,
            "priority": command.priority,
            "now": _now(),
        },
    )


def _insert_document_revision(
    connection: Connection,
    *,
    document_id: str,
    revision: int,
    markdown: str,
    editor_json: dict[str, Any] | None,
    plain_text: str,
    content_hash: str,
    reason: str,
    timestamp: str,
) -> None:
    connection.execute(
        text(
            """
            INSERT INTO document_revisions (
              id, document_id, revision_number, markdown, editor_json, plain_text,
              content_hash, change_reason, created_at
            )
            VALUES (
              :id, :document_id, :revision_number, :markdown, :editor_json,
              :plain_text, :content_hash, :change_reason, :created_at
            )
            """
        ),
        {
            "id": _new_id(),
            "document_id": document_id,
            "revision_number": revision,
            "markdown": markdown,
            "editor_json": _json_dumps(editor_json),
            "plain_text": plain_text,
            "content_hash": content_hash,
            "change_reason": reason,
            "created_at": timestamp,
        },
    )


def _create_document(
    connection: Connection,
    *,
    markdown: str,
    editor_json: dict[str, Any] | None,
    plain_text: str,
    reason: str,
    timestamp: str,
) -> str:
    document_id = _new_id()
    content_hash = hashlib.sha256(
        json.dumps(
            {"markdown": markdown, "editor_json": editor_json, "plain_text": plain_text},
            ensure_ascii=False,
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()
    canonical_format = "tiptap_json" if editor_json is not None else "markdown"
    connection.execute(
        text(
            """
            INSERT INTO documents (
              id, canonical_format, markdown, editor_json, plain_text, editor_name,
              editor_schema_version, markdown_converter_version, content_hash,
              created_at, updated_at, deleted_at, revision
            )
            VALUES (
              :id, :canonical_format, :markdown, :editor_json, :plain_text,
              'tiptap', '1', 'react-editor-v1', :content_hash,
              :now, :now, NULL, 1
            )
            """
        ),
        {
            "id": document_id,
            "canonical_format": canonical_format,
            "markdown": markdown,
            "editor_json": _json_dumps(editor_json),
            "plain_text": plain_text,
            "content_hash": content_hash,
            "now": timestamp,
        },
    )
    _insert_document_revision(
        connection,
        document_id=document_id,
        revision=1,
        markdown=markdown,
        editor_json=editor_json,
        plain_text=plain_text,
        content_hash=content_hash,
        reason=reason,
        timestamp=timestamp,
    )
    return document_id


def upsert_note(connection: Connection, command: NoteUpsertCommand) -> MutationResponse:
    now = _now()
    markdown = command.markdown
    plain_text = command.plain_text or markdown
    content_hash = hashlib.sha256(
        json.dumps(
            {"markdown": markdown, "editor_json": command.editor_json, "plain_text": plain_text},
            ensure_ascii=False,
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()
    canonical_format = "tiptap_json" if command.editor_json is not None else "markdown"

    if command.note_id is None:
        note_id = _new_id()
        document_id = _create_document(
            connection,
            markdown=markdown,
            editor_json=command.editor_json,
            plain_text=plain_text,
            reason="note_created",
            timestamp=now,
        )
        connection.execute(
            text(
                """
                INSERT INTO notes (
                  id, course_id, document_id, kind, status, created_at, updated_at,
                  deleted_at, revision
                )
                VALUES (:id, :course_id, :document_id, :kind, 'active', :now, :now, NULL, 1)
                """
            ),
            {
                "id": note_id,
                "course_id": command.course_id,
                "document_id": document_id,
                "kind": command.kind,
                "now": now,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO note_links (note_id, entity_type, entity_id, relation, created_at)
                VALUES (:note_id, :entity_type, :entity_id, 'primary', :created_at)
                """
            ),
            {
                "note_id": note_id,
                "entity_type": command.entity_type,
                "entity_id": command.entity_id,
                "created_at": now,
            },
        )
        return MutationResponse(id=note_id, revision=1, updated_at=now)

    if command.note_revision is None or command.document_revision is None:
        raise RevisionConflictError(
            "Existing note edits require note_revision and document_revision."
        )

    note_row = _one_or_none(
        connection,
        """
        SELECT id, document_id
        FROM notes
        WHERE id = :id AND course_id = :course_id AND revision = :revision AND deleted_at IS NULL
        """,
        {"id": command.note_id, "course_id": command.course_id, "revision": command.note_revision},
    )
    if note_row is None:
        exists = _one_or_none(
            connection,
            "SELECT id FROM notes WHERE id = :id",
            {"id": command.note_id},
        )
        if exists is None:
            raise EntityNotFoundError(f"Note does not exist: {command.note_id}")
        raise RevisionConflictError(f"Stale revision for note: {command.note_id}")

    document_id = str(note_row["document_id"])
    document_row = _one_or_none(
        connection,
        """
        UPDATE documents
        SET canonical_format = :canonical_format,
            markdown = :markdown,
            editor_json = :editor_json,
            plain_text = :plain_text,
            content_hash = :content_hash,
            updated_at = :updated_at,
            revision = revision + 1
        WHERE id = :id AND revision = :revision AND deleted_at IS NULL
        RETURNING id, revision
        """,
        {
            "id": document_id,
            "revision": command.document_revision,
            "canonical_format": canonical_format,
            "markdown": markdown,
            "editor_json": _json_dumps(command.editor_json),
            "plain_text": plain_text,
            "content_hash": content_hash,
            "updated_at": now,
        },
    )
    if document_row is None:
        raise RevisionConflictError(f"Stale revision for note document: {document_id}")
    document_revision = int(document_row["revision"])
    _insert_document_revision(
        connection,
        document_id=document_id,
        revision=document_revision,
        markdown=markdown,
        editor_json=command.editor_json,
        plain_text=plain_text,
        content_hash=content_hash,
        reason="note_updated",
        timestamp=now,
    )
    row = _one_or_none(
        connection,
        """
        UPDATE notes
        SET kind = :kind,
            updated_at = :updated_at,
            revision = revision + 1
        WHERE id = :id AND revision = :revision AND deleted_at IS NULL
        RETURNING id, revision, updated_at
        """,
        {
            "id": command.note_id,
            "revision": command.note_revision,
            "kind": command.kind,
            "updated_at": now,
        },
    )
    if row is None:
        raise RevisionConflictError(f"Stale revision for note: {command.note_id}")
    return _mutation_result(row)


def resource_open_target(
    connection: Connection,
    resource_id: str,
) -> tuple[str | None, str | None]:
    row = _one_or_none(
        connection,
        """
        SELECT rv.local_path, COALESCE(rv.source_url, r.canonical_url) AS source_url
        FROM resources r
        LEFT JOIN resource_versions rv ON rv.id = r.current_version_id
        WHERE r.id = :resource_id AND r.deleted_at IS NULL
        """,
        {"resource_id": resource_id},
    )
    if row is None:
        raise EntityNotFoundError(f"Resource does not exist: {resource_id}")
    return cast(str | None, row["local_path"]), cast(str | None, row["source_url"])


def create_discussion(
    connection: Connection,
    command: DiscussionCreateCommand,
) -> MutationResponse:
    resource = _one_or_none(
        connection,
        """
        SELECT id
        FROM resources
        WHERE id = :resource_id AND course_id = :course_id AND deleted_at IS NULL
        """,
        {"resource_id": command.resource_id, "course_id": command.course_id},
    )
    if resource is None:
        raise EntityNotFoundError(
            f"Resource does not exist in course: {command.resource_id}"
        )
    existing = _one_or_none(
        connection,
        """
        SELECT id, revision, updated_at
        FROM discussion_threads
        WHERE resource_id = :resource_id AND deleted_at IS NULL
        """,
        {"resource_id": command.resource_id},
    )
    if existing is not None:
        return _mutation_result(existing)

    now = _now()
    discussion_id = _new_id()
    row = _one_or_none(
        connection,
        """
        INSERT INTO discussion_threads (
          id, resource_id, course_id, initial_prompt_batch_id, provider,
          status, created_at, updated_at, deleted_at, revision
        )
        VALUES (
          :id, :resource_id, :course_id, NULL, :provider,
          'active', :now, :now, NULL, 1
        )
        RETURNING id, revision, updated_at
        """,
        {
            "id": discussion_id,
            "resource_id": command.resource_id,
            "course_id": command.course_id,
            "provider": command.provider,
            "now": now,
        },
    )
    if row is None:
        raise WorkspaceRepositoryError("Could not create discussion.")
    return _mutation_result(row)


def create_discussion_message(
    connection: Connection,
    discussion_id: str,
    command: DiscussionMessageCreateCommand,
) -> MutationResponse:
    thread = _one_or_none(
        connection,
        """
        SELECT id
        FROM discussion_threads
        WHERE id = :id AND deleted_at IS NULL
        """,
        {"id": discussion_id},
    )
    if thread is None:
        raise EntityNotFoundError(f"Discussion does not exist: {discussion_id}")

    now = _now()
    markdown = command.markdown
    plain_text = command.plain_text or markdown
    document_id = _create_document(
        connection,
        markdown=markdown,
        editor_json=command.editor_json,
        plain_text=plain_text,
        reason="discussion_message_created",
        timestamp=now,
    )
    sequence_number = int(
        connection.execute(
            text(
                """
                SELECT COALESCE(MAX(sequence_number), 0) + 1
                FROM discussion_messages
                WHERE thread_id = :thread_id AND deleted_at IS NULL
                """
            ),
            {"thread_id": discussion_id},
        ).scalar_one()
    )
    message_id = _new_id()
    row = _one_or_none(
        connection,
        """
        INSERT INTO discussion_messages (
          id, thread_id, parent_message_id, reply_to_message_id, role,
          body_document_id, sequence_number, imported_from_clipboard,
          externally_created_at, created_at, updated_at, deleted_at, revision
        )
        VALUES (
          :id, :thread_id, NULL, NULL, :role,
          :body_document_id, :sequence_number, 0,
          NULL, :now, :now, NULL, 1
        )
        RETURNING id, revision, updated_at
        """,
        {
            "id": message_id,
            "thread_id": discussion_id,
            "role": command.role,
            "body_document_id": document_id,
            "sequence_number": sequence_number,
            "now": now,
        },
    )
    connection.execute(
        text(
            """
            UPDATE discussion_threads
            SET updated_at = :now, revision = revision + 1
            WHERE id = :id
            """
        ),
        {"id": discussion_id, "now": now},
    )
    if row is None:
        raise WorkspaceRepositoryError("Could not create discussion message.")
    return _mutation_result(row)
