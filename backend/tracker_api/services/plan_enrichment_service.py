from __future__ import annotations

import hashlib
import json
import re
import uuid
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from sqlalchemy import Connection, text

from ..database import transaction
from ..migrations.runner import run_migrations

NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://openai.local/study-tracker-v2")
TRACKER_DATA_PATTERN = re.compile(
    r'<script[^>]+id="trackerData"[^>]*>(?P<payload>.*?)</script>',
    re.DOTALL,
)


class PlanEnrichmentError(ValueError):
    """Raised when generated tracker structure cannot be imported."""


def stable_id(*parts: object) -> str:
    return str(uuid.uuid5(NAMESPACE, "::".join(str(part) for part in parts)))


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def load_tracker_data(path: Path) -> dict[str, Any]:
    try:
        source = path.read_text(encoding="utf-8")
    except OSError as error:
        raise PlanEnrichmentError(f"Cannot read generated tracker: {path}") from error
    match = TRACKER_DATA_PATTERN.search(source)
    if match is None:
        raise PlanEnrichmentError(f"No trackerData JSON script found in {path}")
    try:
        payload = json.loads(match.group("payload"))
    except json.JSONDecodeError as error:
        raise PlanEnrichmentError(f"Invalid trackerData JSON in {path}: {error}") from error
    if not isinstance(payload, dict) or not isinstance(payload.get("plans"), list):
        raise PlanEnrichmentError("trackerData must contain a plans array")
    return payload


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _rows_by_key(
    connection: Connection,
    query: str,
    key: str,
) -> dict[str, dict[str, Any]]:
    return {
        str(row[key]): dict(row)
        for row in connection.execute(text(query)).mappings()
        if row[key] is not None
    }


def _course_by_legacy_id(connection: Connection) -> dict[str, dict[str, Any]]:
    courses: dict[str, dict[str, Any]] = {}
    for row in connection.execute(
        text("SELECT id, settings_json FROM courses WHERE deleted_at IS NULL")
    ).mappings():
        settings = json.loads(row["settings_json"] or "{}")
        legacy_id = settings.get("legacy_plan_id")
        if legacy_id:
            courses[str(legacy_id)] = dict(row)
    return courses


def _binding_map(connection: Connection, entity_type: str) -> dict[str, str]:
    return {
        str(row["source_key"]): str(row["entity_id"])
        for row in connection.execute(
            text(
                """
                SELECT source_key, entity_id
                FROM source_bindings
                WHERE entity_type = :entity_type
                """
            ),
            {"entity_type": entity_type},
        ).mappings()
    }


def _source_binding_context(connection: Connection) -> tuple[str, dict[str, str]]:
    plan_source_id = connection.execute(
        text("SELECT id FROM plan_sources ORDER BY created_at LIMIT 1")
    ).scalar_one()
    import_runs = {
        str(row["course_id"]): str(row["id"])
        for row in connection.execute(
            text(
                """
                SELECT ir.id, ir.course_id
                FROM import_runs ir
                JOIN (
                  SELECT course_id, MAX(started_at) AS started_at
                  FROM import_runs
                  WHERE status = 'completed'
                  GROUP BY course_id
                ) latest
                  ON latest.course_id = ir.course_id
                 AND latest.started_at = ir.started_at
                """
            )
        ).mappings()
    }
    return str(plan_source_id), import_runs


def _insert_source_binding(
    connection: Connection,
    *,
    plan_source_id: str,
    import_run_id: str,
    source_key: str,
    entity_type: str,
    entity_id: str,
    timestamp: str,
) -> None:
    connection.execute(
        text(
            """
            INSERT INTO source_bindings (
              id, plan_source_id, source_key, entity_type, entity_id,
              source_hash, source_payload_json, first_seen_import_run_id,
              last_seen_import_run_id, missing_since_import_run_id,
              created_at, updated_at
            )
            VALUES (
              :id, :plan_source_id, :source_key, :entity_type, :entity_id,
              NULL, NULL, :import_run_id,
              :import_run_id, NULL,
              :timestamp, :timestamp
            )
            ON CONFLICT(plan_source_id, source_key, entity_type) DO UPDATE SET
              entity_id = excluded.entity_id,
              last_seen_import_run_id = excluded.last_seen_import_run_id,
              missing_since_import_run_id = NULL,
              updated_at = excluded.updated_at
            """
        ),
        {
            "id": stable_id("source-binding", plan_source_id, entity_type, source_key),
            "plan_source_id": plan_source_id,
            "source_key": source_key,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "import_run_id": import_run_id,
            "timestamp": timestamp,
        },
    )


def _legacy_resource_map(connection: Connection) -> dict[tuple[str, str], str]:
    result: dict[tuple[str, str], str] = {}
    course_legacy_ids = {
        str(row["id"]): str(json.loads(row["settings_json"] or "{}").get("legacy_plan_id", ""))
        for row in connection.execute(text("SELECT id, settings_json FROM courses")).mappings()
    }
    for row in connection.execute(
        text("SELECT id, course_id, metadata_json FROM resources")
    ).mappings():
        metadata = json.loads(row["metadata_json"] or "{}")
        legacy_id = metadata.get("legacy_resource_id")
        plan_id = course_legacy_ids.get(str(row["course_id"]), "")
        if legacy_id and plan_id:
            result[(plan_id, str(legacy_id))] = str(row["id"])
    return result


def _legacy_exam_question_map(connection: Connection) -> dict[str, str]:
    result: dict[str, str] = {}
    for row in connection.execute(
        text(
            """
            SELECT id, metadata_json
            FROM resources
            WHERE kind = 'exam_question'
            """
        )
    ).mappings():
        metadata = json.loads(row["metadata_json"] or "{}")
        legacy_id = metadata.get("legacy_exam_id")
        if legacy_id:
            result[str(legacy_id)] = str(row["id"])
    return result


def _upsert_document(
    connection: Connection,
    *,
    identity: str,
    markdown: str,
    timestamp: str,
) -> str:
    document_id = stable_id("document", identity)
    content_hash = hashlib.sha256(markdown.encode("utf-8")).hexdigest()
    connection.execute(
        text(
            """
            INSERT INTO documents (
              id, canonical_format, markdown, editor_json, plain_text,
              editor_name, editor_schema_version, markdown_converter_version,
              content_hash, created_at, updated_at, deleted_at, revision
            )
            VALUES (
              :id, 'markdown', :markdown, NULL, :plain_text,
              'tiptap', '1', 'plan-enrichment-v1',
              :content_hash, :timestamp, :timestamp, NULL, 1
            )
            ON CONFLICT(id) DO UPDATE SET
              markdown = excluded.markdown,
              plain_text = excluded.plain_text,
              content_hash = excluded.content_hash,
              markdown_converter_version = excluded.markdown_converter_version,
              updated_at = excluded.updated_at,
              revision = documents.revision + 1
            """
        ),
        {
            "id": document_id,
            "markdown": markdown,
            "plain_text": markdown,
            "content_hash": content_hash,
            "timestamp": timestamp,
        },
    )
    return document_id


def _task_type(section_name: str, text_value: str) -> str:
    searchable = f"{section_name} {text_value}".lower()
    for token, task_type in (
        ("read", "reading"),
        ("study", "reading"),
        ("review", "review"),
        ("recall", "recall"),
        ("solve", "solve"),
        ("exercise", "solve"),
        ("implement", "code"),
        ("code", "code"),
        ("write", "write"),
        ("create", "project"),
    ):
        if token in searchable:
            return task_type
    return "other"


def _resource_kind(value: str) -> str:
    normalized = value.lower()
    if "paper" in normalized or "article" in normalized:
        return "paper"
    if "book" in normalized:
        return "book"
    if "slide" in normalized or "lecture" in normalized:
        return "slides"
    if "exam" in normalized:
        return "exam"
    if "exercise" in normalized or "assignment" in normalized:
        return "exercise"
    if "dataset" in normalized:
        return "dataset"
    if "code" in normalized:
        return "code"
    if "guide" in normalized or "reference" in normalized:
        return "guide"
    return "other"


def _resource_location(resource: dict[str, Any]) -> tuple[str | None, str | None, str]:
    links = resource.get("links")
    if not isinstance(links, list) or not links:
        return None, None, "other"
    link = links[0]
    if not isinstance(link, dict):
        return None, None, "other"
    path_value = str(link.get("path") or "").strip() or None
    href = str(link.get("original_href") or link.get("href") or "").strip() or None
    format_value = str(link.get("kind") or "other").lower()
    if path_value is None and href and href.startswith("file:"):
        path_value = unquote(urlparse(href).path)
    return path_value, href, format_value


def _upsert_resource_version(
    connection: Connection,
    resource_id: str,
    local_path: str,
    format_value: str,
    timestamp: str,
) -> str:
    existing = connection.execute(
        text(
            """
            SELECT id
            FROM resource_versions
            WHERE resource_id = :resource_id AND local_path = :local_path
            ORDER BY version_number DESC
            LIMIT 1
            """
        ),
        {"resource_id": resource_id, "local_path": local_path},
    ).scalar_one_or_none()
    if existing is not None:
        return str(existing)

    version_number = int(
        connection.execute(
            text(
                """
                SELECT COALESCE(MAX(version_number), 0) + 1
                FROM resource_versions
                WHERE resource_id = :resource_id
                """
            ),
            {"resource_id": resource_id},
        ).scalar_one()
    )
    version_id = stable_id("resource-version", resource_id, local_path)
    mime_type = {
        "pdf": "application/pdf",
        "html": "text/html",
        "md": "text/markdown",
        "markdown": "text/markdown",
        "txt": "text/plain",
        "image": "image/*",
    }.get(format_value)
    connection.execute(
        text(
            """
            INSERT INTO resource_versions (
              id, resource_id, version_number, storage_type, local_path,
              object_key, source_url, document_id, file_name, mime_type,
              file_hash, file_size_bytes, page_count, created_at
            )
            VALUES (
              :id, :resource_id, :version_number, 'local_path', :local_path,
              NULL, NULL, NULL, :file_name, :mime_type,
              NULL, NULL, NULL, :timestamp
            )
            ON CONFLICT(id) DO UPDATE SET
              local_path = excluded.local_path,
              file_name = excluded.file_name,
              mime_type = excluded.mime_type
            """
        ),
        {
            "id": version_id,
            "resource_id": resource_id,
            "version_number": version_number,
            "local_path": local_path,
            "file_name": Path(local_path).name,
            "mime_type": mime_type,
            "timestamp": timestamp,
        },
    )
    return version_id


def _iter_tasks(day: dict[str, Any]) -> Iterable[tuple[str, dict[str, Any]]]:
    sections = day.get("sections")
    if not isinstance(sections, dict):
        return
    section_order = day.get("section_order")
    names = section_order if isinstance(section_order, list) else list(sections)
    for section_name in names:
        tasks = sections.get(section_name)
        if not isinstance(tasks, list):
            continue
        for task in tasks:
            if isinstance(task, dict):
                yield str(section_name), task


def enrich_from_tracker_html(path: Path) -> dict[str, int]:
    run_migrations()
    payload = load_tracker_data(path)
    timestamp = utc_now()
    counts = {
        "courses": 0,
        "days": 0,
        "sections": 0,
        "tasks": 0,
        "resources": 0,
        "resource_versions": 0,
        "skills": 0,
        "task_resources": 0,
        "exam_questions": 0,
    }

    with transaction() as active_connection:
        courses = _course_by_legacy_id(active_connection)
        day_bindings = _binding_map(active_connection, "day")
        task_bindings = _binding_map(active_connection, "task")
        legacy_resources = _legacy_resource_map(active_connection)
        legacy_exam_questions = _legacy_exam_question_map(active_connection)
        plan_source_id, import_runs_by_course = _source_binding_context(active_connection)

        for raw_plan in payload["plans"]:
            if not isinstance(raw_plan, dict):
                continue
            plan_id = str(raw_plan.get("id") or "")
            course = courses.get(plan_id)
            if course is None:
                raise PlanEnrichmentError(f"No imported course matches plan {plan_id!r}")
            course_id = str(course["id"])
            import_run_id = import_runs_by_course.get(course_id)
            if import_run_id is None:
                raise PlanEnrichmentError(
                    f"No completed import run is available for course {course_id}"
                )
            active_connection.execute(
                text(
                    """
                    UPDATE courses
                    SET title = :title,
                        short_code = :short_code,
                        subtitle = :subtitle,
                        accent_color = :accent,
                        icon_uri = :icon,
                        deadline = :deadline,
                        updated_at = :timestamp,
                        revision = revision + 1
                    WHERE id = :course_id
                    """
                ),
                {
                    "title": raw_plan.get("title") or plan_id,
                    "short_code": raw_plan.get("short_code") or plan_id,
                    "subtitle": raw_plan.get("subtitle"),
                    "accent": raw_plan.get("accent"),
                    "icon": raw_plan.get("icon"),
                    "deadline": raw_plan.get("deadline"),
                    "timestamp": timestamp,
                    "course_id": course_id,
                },
            )
            counts["courses"] += 1

            plan_days = raw_plan.get("days")
            if not isinstance(plan_days, list):
                plan_days = []
            day_ids_by_legacy: dict[str, str] = {}
            task_ids_by_legacy: dict[str, str] = {}
            for day in plan_days:
                if not isinstance(day, dict):
                    continue
                legacy_day_id = str(day.get("id") or "")
                day_id = day_bindings.get(f"{plan_id}:{legacy_day_id}")
                if day_id is None:
                    continue
                day_ids_by_legacy[legacy_day_id] = day_id
                active_connection.execute(
                    text(
                        """
                        UPDATE study_days
                        SET number = :number,
                            date = :date,
                            order_index = :order_index,
                            title = :title,
                            topic = :topic,
                            purpose = :purpose,
                            toggl_description_token = :toggl_token,
                            updated_at = :timestamp,
                            revision = revision + 1
                        WHERE id = :day_id
                        """
                    ),
                    {
                        "number": day.get("number"),
                        "date": day.get("date"),
                        "order_index": day.get("number"),
                        "title": day.get("title") or f"Day {day.get('number')}",
                        "topic": day.get("topic"),
                        "purpose": day.get("purpose"),
                        "toggl_token": legacy_day_id,
                        "timestamp": timestamp,
                        "day_id": day_id,
                    },
                )
                counts["days"] += 1

                active_connection.execute(
                    text(
                        """
                        UPDATE tasks
                        SET order_index = order_index + 1000000
                        WHERE day_id = :day_id
                        """
                    ),
                    {"day_id": day_id},
                )
                active_connection.execute(
                    text(
                        """
                        UPDATE day_sections
                        SET order_index = order_index + 1000000
                        WHERE day_id = :day_id
                        """
                    ),
                    {"day_id": day_id},
                )

                section_ids: dict[str, str] = {}
                section_order = day.get("section_order")
                if not isinstance(section_order, list):
                    section_order = []
                for section_index, section_name_value in enumerate(section_order, start=1):
                    section_name = str(section_name_value)
                    section_id = stable_id("section", course_id, day_id, section_name)
                    section_ids[section_name] = section_id
                    active_connection.execute(
                        text(
                            """
                            INSERT INTO day_sections (
                              id, day_id, title, order_index, default_collapsed,
                              created_at, updated_at, deleted_at
                            )
                            VALUES (
                              :id, :day_id, :title, :order_index, :default_collapsed,
                              :timestamp, :timestamp, NULL
                            )
                            ON CONFLICT(id) DO UPDATE SET
                              title = excluded.title,
                              order_index = excluded.order_index,
                              default_collapsed = excluded.default_collapsed,
                              updated_at = excluded.updated_at,
                              deleted_at = NULL
                            """
                        ),
                        {
                            "id": section_id,
                            "day_id": day_id,
                            "title": section_name,
                            "order_index": section_index,
                            "default_collapsed": int(section_name.lower() == "optional"),
                            "timestamp": timestamp,
                        },
                    )
                    counts["sections"] += 1

                for task_order, (section_name, task) in enumerate(_iter_tasks(day), start=1):
                    legacy_task_id = str(task.get("id") or "")
                    source_key = f"{plan_id}:{legacy_task_id}"
                    task_id = task_bindings.get(source_key)
                    if task_id is None:
                        task_id = stable_id("task", course_id, legacy_task_id)
                        active_connection.execute(
                            text(
                                """
                                INSERT INTO tasks (
                                  id, day_id, section_id, title,
                                  description_document_id, rationale_document_id,
                                  status_note_document_id, task_type, is_optional,
                                  order_index, estimated_minutes, status, defer_until,
                                  started_at, completed_at, deferred_at, skipped_at,
                                  created_at, updated_at, deleted_at, revision
                                )
                                VALUES (
                                  :id, :day_id, NULL, :title,
                                  NULL, NULL,
                                  NULL, 'other', 0,
                                  :order_index, NULL, 'todo', NULL,
                                  NULL, NULL, NULL, NULL,
                                  :timestamp, :timestamp, NULL, 1
                                )
                                ON CONFLICT(id) DO NOTHING
                                """
                            ),
                            {
                                "id": task_id,
                                "day_id": day_id,
                                "title": str(task.get("text") or legacy_task_id),
                                "order_index": task_order,
                                "timestamp": timestamp,
                            },
                        )
                        _insert_source_binding(
                            active_connection,
                            plan_source_id=plan_source_id,
                            import_run_id=import_run_id,
                            source_key=source_key,
                            entity_type="task",
                            entity_id=task_id,
                            timestamp=timestamp,
                        )
                        task_bindings[source_key] = task_id
                    task_ids_by_legacy[legacy_task_id] = task_id
                    task_text = str(task.get("text") or legacy_task_id)
                    rationale = str(task.get("why_this") or "").strip()
                    rationale_document_id = (
                        _upsert_document(
                            active_connection,
                            identity=f"task-rationale:{task_id}",
                            markdown=rationale,
                            timestamp=timestamp,
                        )
                        if rationale
                        else None
                    )
                    active_connection.execute(
                        text(
                            """
                            UPDATE tasks
                            SET section_id = :section_id,
                                title = :title,
                                rationale_document_id = :rationale_document_id,
                                task_type = :task_type,
                                is_optional = :is_optional,
                                order_index = :order_index,
                                updated_at = :timestamp,
                                deleted_at = NULL,
                                revision = revision + 1
                            WHERE id = :task_id
                            """
                        ),
                        {
                            "section_id": section_ids.get(section_name),
                            "title": task_text,
                            "rationale_document_id": rationale_document_id,
                            "task_type": _task_type(section_name, task_text),
                            "is_optional": int(bool(task.get("optional"))),
                            "order_index": task_order,
                            "timestamp": timestamp,
                            "task_id": task_id,
                        },
                    )
                    counts["tasks"] += 1

                active_connection.execute(
                    text(
                        """
                        UPDATE tasks
                        SET deleted_at = :timestamp,
                            updated_at = :timestamp,
                            revision = revision + 1
                        WHERE day_id = :day_id AND order_index >= 800000
                        """
                    ),
                    {"day_id": day_id, "timestamp": timestamp},
                )
                active_connection.execute(
                    text(
                        """
                        UPDATE day_sections
                        SET deleted_at = :timestamp,
                            updated_at = :timestamp
                        WHERE day_id = :day_id AND order_index >= 800000
                        """
                    ),
                    {"day_id": day_id, "timestamp": timestamp},
                )

            plan_resources = raw_plan.get("resources")
            if not isinstance(plan_resources, list):
                plan_resources = []
            for resource in plan_resources:
                if not isinstance(resource, dict):
                    continue
                legacy_resource_id = str(resource.get("id") or "")
                resource_id = legacy_resources.get((plan_id, legacy_resource_id))
                if resource_id is None:
                    resource_id = stable_id("resource", course_id, legacy_resource_id)
                    active_connection.execute(
                        text(
                            """
                            INSERT INTO resources (
                              id, course_id, parent_resource_id, current_version_id,
                              content_document_id, title, kind, format, source_type,
                              category, authors_json, publication_year, canonical_url,
                              status, first_opened_at, last_opened_at, completed_at,
                              metadata_json, created_at, updated_at, deleted_at, revision
                            )
                            VALUES (
                              :id, :course_id, NULL, NULL,
                              NULL, :title, 'other', 'other', 'virtual',
                              :category, '[]', NULL, NULL,
                              'unread', NULL, NULL, NULL,
                              :metadata_json, :timestamp, :timestamp, NULL, 1
                            )
                            ON CONFLICT(id) DO NOTHING
                            """
                        ),
                        {
                            "id": resource_id,
                            "course_id": course_id,
                            "title": resource.get("title") or legacy_resource_id,
                            "category": resource.get("category"),
                            "metadata_json": _json(
                                {"legacy_resource_id": legacy_resource_id}
                            ),
                            "timestamp": timestamp,
                        },
                    )
                    source_key = f"{plan_id}:{legacy_resource_id}"
                    _insert_source_binding(
                        active_connection,
                        plan_source_id=plan_source_id,
                        import_run_id=import_run_id,
                        source_key=source_key,
                        entity_type="resource",
                        entity_id=resource_id,
                        timestamp=timestamp,
                    )
                    legacy_resources[(plan_id, legacy_resource_id)] = resource_id
                local_path, href, format_value = _resource_location(resource)
                source_type = "local_file" if local_path else "external_url" if href else "virtual"
                canonical_url = href if href and not href.startswith("file:") else None
                current_version_id = None
                if local_path:
                    current_version_id = _upsert_resource_version(
                        active_connection,
                        resource_id,
                        local_path,
                        format_value,
                        timestamp,
                    )
                    counts["resource_versions"] += 1
                active_connection.execute(
                    text(
                        """
                        UPDATE resources
                        SET title = :title,
                            kind = :kind,
                            format = :format,
                            source_type = :source_type,
                            category = :category,
                            canonical_url = :canonical_url,
                            current_version_id = COALESCE(:current_version_id, current_version_id),
                            updated_at = :timestamp,
                            revision = revision + 1
                        WHERE id = :resource_id
                        """
                    ),
                    {
                        "title": resource.get("title") or legacy_resource_id,
                        "kind": _resource_kind(str(resource.get("kind") or "")),
                        "format": "markdown" if format_value == "md" else format_value,
                        "source_type": source_type,
                        "category": resource.get("category"),
                        "canonical_url": canonical_url,
                        "current_version_id": current_version_id,
                        "timestamp": timestamp,
                        "resource_id": resource_id,
                    },
                )
                counts["resources"] += 1

                instructions = resource.get("instructions")
                if isinstance(instructions, list):
                    for instruction in instructions:
                        if not isinstance(instruction, dict):
                            continue
                        task_id = task_ids_by_legacy.get(str(instruction.get("task_id") or ""))
                        if task_id is None:
                            continue
                        active_connection.execute(
                            text(
                                """
                                INSERT INTO task_resources (
                      task_id, resource_id, relation, is_required,
                      order_index, created_at
                                )
                                VALUES (
                                  :task_id, :resource_id, 'reading', 1, :order_index, :timestamp
                                )
                                ON CONFLICT(task_id, resource_id, relation) DO UPDATE SET
                                  is_required = excluded.is_required,
                                  order_index = excluded.order_index
                                """
                            ),
                            {
                                "task_id": task_id,
                                "resource_id": resource_id,
                                "order_index": 1,
                                "timestamp": timestamp,
                            },
                        )
                        counts["task_resources"] += 1

            plan_skills = raw_plan.get("skills")
            if not isinstance(plan_skills, list):
                plan_skills = []
            for skill_order, skill in enumerate(plan_skills, start=1):
                if not isinstance(skill, dict):
                    continue
                legacy_skill_id = str(skill.get("id") or f"skill-{skill_order}")
                skill_id = stable_id("skill", course_id, legacy_skill_id)
                description = str(skill.get("description") or "").strip()
                description_document_id = (
                    _upsert_document(
                        active_connection,
                        identity=f"skill-description:{skill_id}",
                        markdown=description,
                        timestamp=timestamp,
                    )
                    if description
                    else None
                )
                active_connection.execute(
                    text(
                        """
                        INSERT INTO skills (
                          id, course_id, name, category, description_document_id,
                          confidence, last_reviewed_at, order_index,
                          created_at, updated_at, deleted_at, revision
                        )
                        VALUES (
                          :id, :course_id, :name, :category, :description_document_id,
                          NULL, NULL, :order_index,
                          :timestamp, :timestamp, NULL, 1
                        )
                        ON CONFLICT(id) DO UPDATE SET
                          name = excluded.name,
                          category = excluded.category,
                          description_document_id = excluded.description_document_id,
                          order_index = excluded.order_index,
                          updated_at = excluded.updated_at,
                          deleted_at = NULL,
                          revision = skills.revision + 1
                        """
                    ),
                    {
                        "id": skill_id,
                        "course_id": course_id,
                        "name": skill.get("name") or legacy_skill_id,
                        "category": skill.get("source"),
                        "description_document_id": description_document_id,
                        "order_index": skill_order,
                        "timestamp": timestamp,
                    },
                )
                counts["skills"] += 1
                skill_day_ids = skill.get("day_ids")
                if isinstance(skill_day_ids, list):
                    for legacy_day_id_value in skill_day_ids:
                        day_id = day_ids_by_legacy.get(str(legacy_day_id_value))
                        if day_id is None:
                            continue
                        active_connection.execute(
                            text(
                                """
                                INSERT INTO day_skills (
                                  day_id, skill_id, coverage, is_primary, weight, created_at
                                )
                                VALUES (
                                  :day_id, :skill_id, 'introduced', 0, 1, :timestamp
                                )
                                ON CONFLICT(day_id, skill_id) DO UPDATE SET
                                  coverage = excluded.coverage,
                                  weight = excluded.weight
                                """
                            ),
                            {
                                "day_id": day_id,
                                "skill_id": skill_id,
                                "timestamp": timestamp,
                            },
                        )

            questions = raw_plan.get("exam_questions")
            if not isinstance(questions, list):
                questions = []
            for question in questions:
                if not isinstance(question, dict):
                    continue
                question_id = legacy_exam_questions.get(str(question.get("id") or ""))
                if question_id is None:
                    continue
                prompt = str(question.get("prompt") or "").strip()
                prompt_document_id = (
                    _upsert_document(
                        active_connection,
                        identity=f"exam-prompt:{question_id}",
                        markdown=prompt,
                        timestamp=timestamp,
                    )
                    if prompt
                    else None
                )
                active_connection.execute(
                    text(
                        """
                        UPDATE exam_question_details
                        SET part = :part,
                            question_number = :question_number,
                            topic = :topic,
                            prompt_document_id = :prompt_document_id,
                            updated_at = :timestamp
                        WHERE resource_id = :question_id
                        """
                    ),
                    {
                        "part": question.get("part"),
                        "question_number": question.get("label"),
                        "topic": question.get("topic") or question.get("registry_topic"),
                        "prompt_document_id": prompt_document_id,
                        "timestamp": timestamp,
                        "question_id": question_id,
                    },
                )
                active_connection.execute(
                    text(
                        """
                        UPDATE resources
                        SET title = :title,
                            category = :category,
                            updated_at = :timestamp,
                            revision = revision + 1
                        WHERE id = :question_id
                        """
                    ),
                    {
                        "title": question.get("label") or question.get("id"),
                        "category": question.get("group"),
                        "timestamp": timestamp,
                        "question_id": question_id,
                    },
                )
                parent_id = active_connection.execute(
                    text("SELECT parent_resource_id FROM resources WHERE id = :question_id"),
                    {"question_id": question_id},
                ).scalar_one_or_none()
                if parent_id:
                    active_connection.execute(
                        text(
                            """
                            UPDATE resources
                            SET title = :title,
                                category = :category,
                                updated_at = :timestamp,
                                revision = revision + 1
                            WHERE id = :parent_id
                            """
                        ),
                        {
                            "title": question.get("display_title")
                            or question.get("exam_title")
                            or parent_id,
                            "category": question.get("group"),
                            "timestamp": timestamp,
                            "parent_id": parent_id,
                        },
                    )
                task_refs = question.get("task_refs")
                if isinstance(task_refs, list):
                    for reference_index, reference in enumerate(task_refs, start=1):
                        if not isinstance(reference, dict):
                            continue
                        task_id = task_ids_by_legacy.get(str(reference.get("task_id") or ""))
                        if task_id is None:
                            continue
                        active_connection.execute(
                            text(
                                """
                                INSERT INTO task_resources (
                      task_id, resource_id, relation, is_required,
                      order_index, created_at
                                )
                                VALUES (
                                  :task_id, :resource_id, 'exercise', 1, :order_index, :timestamp
                                )
                                ON CONFLICT(task_id, resource_id, relation) DO UPDATE SET
                                  order_index = excluded.order_index
                                """
                            ),
                            {
                                "task_id": task_id,
                                "resource_id": question_id,
                                "order_index": reference_index,
                                "timestamp": timestamp,
                            },
                        )
                        counts["task_resources"] += 1
                counts["exam_questions"] += 1

    return counts
