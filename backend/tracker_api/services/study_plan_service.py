from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy import Connection, text

from ..database import transaction
from ..migrations.runner import run_migrations
from .plan_enrichment_service import (
    _insert_source_binding,
    _upsert_document,
    _upsert_resource_version,
    stable_id,
    utc_now,
)
from .study_plan_parser import (
    DaySpec,
    PlanDiagnostic,
    ResourceSpec,
    SkillSpec,
    StudyPlanSpec,
    TaskSpec,
    parse_study_plan,
)


class StudyPlanSyncError(ValueError):
    """Raised when a Study Plan v1 document cannot be applied safely."""


@dataclass(frozen=True)
class StudyPlanSyncResult:
    course_id: str
    plan_id: str
    mode: str
    source_path: str
    import_run_id: str
    counts: dict[str, int]
    diagnostics: tuple[PlanDiagnostic, ...] = field(default_factory=tuple)


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _row(
    connection: Connection,
    statement: str,
    params: dict[str, object] | None = None,
) -> dict[str, Any] | None:
    result = connection.execute(text(statement), params or {}).mappings().one_or_none()
    return dict(result) if result is not None else None


def _course_for_plan(connection: Connection, plan_id: str) -> dict[str, Any] | None:
    return _row(
        connection,
        """
        SELECT *
        FROM courses
        WHERE deleted_at IS NULL
          AND (
            id = :stable_id
            OR json_extract(settings_json, '$.plan_id') = :plan_id
            OR json_extract(settings_json, '$.legacy_plan_id') = :plan_id
            OR lower(short_code) = lower(:plan_id)
          )
        ORDER BY
          CASE
            WHEN json_extract(settings_json, '$.plan_id') = :plan_id THEN 0
            WHEN json_extract(settings_json, '$.legacy_plan_id') = :plan_id THEN 1
            ELSE 2
          END
        LIMIT 1
        """,
        {"plan_id": plan_id, "stable_id": stable_id("course", plan_id)},
    )


def _upsert_course(
    connection: Connection,
    plan: StudyPlanSpec,
    *,
    timestamp: str,
) -> str:
    existing = _course_for_plan(connection, plan.plan_id)
    if existing is None and plan.mode == "patch":
        raise StudyPlanSyncError(
            f"Patch targets unknown plan {plan.plan_id!r}; sync a full plan first."
        )
    if existing is None:
        course_id = stable_id("course", plan.plan_id)
        settings = {
            "authoring_format": plan.format,
            "plan_id": plan.plan_id,
            "source_path": str(plan.source_path),
        }
        connection.execute(
            text(
                """
                INSERT INTO courses (
                  id, title, short_code, subtitle, description_document_id,
                  accent_color, icon_uri, deadline, status,
                  toggl_workspace_id, toggl_project_id, toggl_description_prefix,
                  settings_json, created_at, updated_at, deleted_at, revision
                )
                VALUES (
                  :id, :title, :short_code, :subtitle, NULL,
                  :accent, :icon, :deadline, 'active',
                  NULL, NULL, :toggl_prefix,
                  :settings_json, :timestamp, :timestamp, NULL, 1
                )
                """
            ),
            {
                "id": course_id,
                "title": plan.title,
                "short_code": plan.short_code or plan.plan_id.replace("_", ""),
                "subtitle": plan.subtitle,
                "accent": plan.accent or "#4779df",
                "icon": plan.icon,
                "deadline": plan.deadline,
                "toggl_prefix": f"[{plan.short_code or plan.plan_id}]",
                "settings_json": _json(settings),
                "timestamp": timestamp,
            },
        )
        return course_id

    course_id = str(existing["id"])
    settings = json.loads(str(existing.get("settings_json") or "{}"))
    settings.update(
        {
            "authoring_format": plan.format,
            "plan_id": plan.plan_id,
            "source_path": str(plan.source_path),
        }
    )
    full = plan.mode == "full"
    connection.execute(
        text(
            """
            UPDATE courses
            SET title = CASE WHEN :set_title THEN :title ELSE title END,
                short_code = CASE WHEN :set_short_code THEN :short_code ELSE short_code END,
                subtitle = CASE WHEN :set_subtitle THEN :subtitle ELSE subtitle END,
                accent_color = CASE WHEN :set_accent THEN :accent ELSE accent_color END,
                icon_uri = CASE WHEN :set_icon THEN :icon ELSE icon_uri END,
                deadline = CASE WHEN :set_deadline THEN :deadline ELSE deadline END,
                settings_json = :settings_json,
                updated_at = :timestamp,
                revision = revision + 1
            WHERE id = :id
            """
        ),
        {
            "id": course_id,
            "set_title": full or "title" in plan.fields_present,
            "title": plan.title,
            "set_short_code": full or "short_code" in plan.fields_present,
            "short_code": plan.short_code,
            "set_subtitle": full or "subtitle" in plan.fields_present,
            "subtitle": plan.subtitle,
            "set_accent": full or "accent" in plan.fields_present,
            "accent": plan.accent,
            "set_icon": full or "icon" in plan.fields_present,
            "icon": plan.icon,
            "set_deadline": full or "deadline" in plan.fields_present,
            "deadline": plan.deadline,
            "settings_json": _json(settings),
            "timestamp": timestamp,
        },
    )
    return course_id


def _start_import_run(
    connection: Connection,
    *,
    course_id: str,
    plan: StudyPlanSpec,
    timestamp: str,
) -> str:
    run_id = str(uuid.uuid4())
    connection.execute(
        text(
            """
            INSERT INTO import_runs (
              id, course_id, resource_id, resource_version_id, importer, status,
              imported_count, skipped_count, updated_count, details_json,
              error_message, started_at, finished_at
            )
            VALUES (
              :id, :course_id, NULL, NULL, 'study_plan_v1', 'running',
              0, 0, 0, :details_json,
              NULL, :timestamp, NULL
            )
            """
        ),
        {
            "id": run_id,
            "course_id": course_id,
            "details_json": _json(
                {
                    "format": plan.format,
                    "mode": plan.mode,
                    "source_path": str(plan.source_path),
                }
            ),
            "timestamp": timestamp,
        },
    )
    return run_id


def _plan_source(
    connection: Connection,
    *,
    course_id: str,
    plan: StudyPlanSpec,
    import_run_id: str,
    timestamp: str,
) -> str:
    source_id = stable_id("plan-source", str(plan.source_path))
    connection.execute(
        text(
            """
            INSERT INTO plan_sources (
              id, course_id, source_type, local_path, parser_name, parser_version,
              last_file_hash, last_import_run_id, last_successful_import_at,
              created_at, updated_at
            )
            VALUES (
              :id, :course_id, 'markdown', :local_path, 'study_plan_v1', '1',
              NULL, :import_run_id, NULL,
              :timestamp, :timestamp
            )
            ON CONFLICT(source_type, local_path) DO UPDATE SET
              course_id = excluded.course_id,
              parser_name = excluded.parser_name,
              parser_version = excluded.parser_version,
              last_import_run_id = excluded.last_import_run_id,
              updated_at = excluded.updated_at
            """
        ),
        {
            "id": source_id,
            "course_id": course_id,
            "local_path": str(plan.source_path),
            "import_run_id": import_run_id,
            "timestamp": timestamp,
        },
    )
    resolved = connection.execute(
        text(
            """
            SELECT id
            FROM plan_sources
            WHERE source_type = 'markdown' AND local_path = :local_path
            """
        ),
        {"local_path": str(plan.source_path)},
    ).scalar_one()
    return str(resolved)


def _bound_entity_id(
    connection: Connection,
    *,
    plan_source_id: str,
    plan_id: str,
    entity_type: str,
    key: str,
) -> str | None:
    source_key = f"{plan_id}:{key}"
    value = connection.execute(
        text(
            """
            SELECT entity_id
            FROM source_bindings
            WHERE entity_type = :entity_type
              AND source_key = :source_key
            ORDER BY CASE WHEN plan_source_id = :plan_source_id THEN 0 ELSE 1 END
            LIMIT 1
            """
        ),
        {
            "entity_type": entity_type,
            "source_key": source_key,
            "plan_source_id": plan_source_id,
        },
    ).scalar_one_or_none()
    return str(value) if value is not None else None


def _bind(
    connection: Connection,
    *,
    plan_source_id: str,
    import_run_id: str,
    plan_id: str,
    entity_type: str,
    key: str,
    entity_id: str,
    timestamp: str,
) -> None:
    _insert_source_binding(
        connection,
        plan_source_id=plan_source_id,
        import_run_id=import_run_id,
        source_key=f"{plan_id}:{key}",
        entity_type=entity_type,
        entity_id=entity_id,
        timestamp=timestamp,
    )


def _resource_id(
    connection: Connection,
    *,
    course_id: str,
    plan_source_id: str,
    plan_id: str,
    resource: ResourceSpec,
) -> str:
    bound = _bound_entity_id(
        connection,
        plan_source_id=plan_source_id,
        plan_id=plan_id,
        entity_type="resource",
        key=resource.key,
    )
    if bound:
        return bound
    if resource.path:
        existing_path = connection.execute(
            text(
                """
                SELECT r.id
                FROM resources r
                JOIN resource_versions rv ON rv.resource_id = r.id
                WHERE r.course_id = :course_id
                  AND rv.local_path = :local_path
                  AND r.deleted_at IS NULL
                LIMIT 1
                """
            ),
            {"course_id": course_id, "local_path": resource.path},
        ).scalar_one_or_none()
        if existing_path is not None:
            return str(existing_path)
    legacy = connection.execute(
        text(
            """
            SELECT id
            FROM resources
            WHERE course_id = :course_id
              AND json_extract(metadata_json, '$.legacy_resource_id') = :key
              AND deleted_at IS NULL
            LIMIT 1
            """
        ),
        {"course_id": course_id, "key": resource.key},
    ).scalar_one_or_none()
    return str(legacy) if legacy is not None else stable_id("resource", course_id, resource.key)


def _resource_format(resource: ResourceSpec) -> str:
    if resource.url and not resource.path:
        return "web"
    suffix = Path(resource.path or "").suffix.lower().lstrip(".")
    return {"md": "markdown", "htm": "html"}.get(suffix, suffix or "other")


def _sync_resources(
    connection: Connection,
    *,
    plan: StudyPlanSpec,
    course_id: str,
    plan_source_id: str,
    import_run_id: str,
    timestamp: str,
    counts: dict[str, int],
) -> dict[str, str]:
    resource_ids: dict[str, str] = {}
    for resource in plan.resources:
        resource_id = _resource_id(
            connection,
            course_id=course_id,
            plan_source_id=plan_source_id,
            plan_id=plan.plan_id,
            resource=resource,
        )
        resource_ids[resource.key] = resource_id
        existing = _row(
            connection,
            "SELECT id FROM resources WHERE id = :id",
            {"id": resource_id},
        )
        current_version_id: str | None = None
        format_value = _resource_format(resource)
        content_document_id = (
            _upsert_document(
                connection,
                identity=f"resource-description:{resource_id}",
                markdown=resource.description_markdown,
                timestamp=timestamp,
            )
            if resource.description_markdown
            else None
        )
        metadata = {
            **resource.metadata,
            "local_paths": list(resource.paths),
            "plan_resource_id": resource.key,
        }
        if existing is None:
            connection.execute(
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
                      :id, :course_id, NULL, :current_version_id,
                      :content_document_id, :title, :kind, :format, :source_type,
                      :category, :authors_json, :publication_year, :canonical_url,
                      'unread', NULL, NULL, NULL,
                      :metadata_json, :timestamp, :timestamp, NULL, 1
                    )
                    """
                ),
                {
                    "id": resource_id,
                    "course_id": course_id,
                    "current_version_id": current_version_id,
                    "content_document_id": content_document_id,
                    "title": resource.title,
                    "kind": resource.kind,
                    "format": format_value,
                    "source_type": (
                        "local_file"
                        if resource.path
                        else "external_url"
                        if resource.url
                        else "virtual"
                    ),
                    "category": resource.category,
                    "authors_json": _json(resource.authors),
                    "publication_year": resource.publication_year,
                    "canonical_url": resource.url,
                    "metadata_json": _json(metadata),
                    "timestamp": timestamp,
                },
            )
            counts["resources_created"] += 1
        else:
            connection.execute(
                text(
                    """
                    UPDATE resources
                    SET current_version_id = COALESCE(:current_version_id, current_version_id),
                        content_document_id = COALESCE(
                          :content_document_id,
                          content_document_id
                        ),
                        title = :title,
                        kind = :kind,
                        format = :format,
                        source_type = :source_type,
                        category = :category,
                        authors_json = :authors_json,
                        publication_year = :publication_year,
                        canonical_url = :canonical_url,
                        metadata_json = :metadata_json,
                        updated_at = :timestamp,
                        deleted_at = NULL,
                        revision = revision + 1
                    WHERE id = :id
                    """
                ),
                {
                    "id": resource_id,
                    "current_version_id": current_version_id,
                    "content_document_id": content_document_id,
                    "title": resource.title,
                    "kind": resource.kind,
                    "format": format_value,
                    "source_type": (
                        "local_file"
                        if resource.path
                        else "external_url"
                        if resource.url
                        else "virtual"
                    ),
                    "category": resource.category,
                    "authors_json": _json(resource.authors),
                    "publication_year": resource.publication_year,
                    "canonical_url": resource.url,
                    "metadata_json": _json(metadata),
                    "timestamp": timestamp,
                },
            )
            counts["resources_updated"] += 1
        if resource.path:
            current_version_id = _upsert_resource_version(
                connection,
                resource_id,
                resource.path,
                format_value,
                timestamp,
            )
            connection.execute(
                text(
                    """
                    UPDATE resources
                    SET current_version_id = :current_version_id
                    WHERE id = :id
                    """
                ),
                {"id": resource_id, "current_version_id": current_version_id},
            )
        _bind(
            connection,
            plan_source_id=plan_source_id,
            import_run_id=import_run_id,
            plan_id=plan.plan_id,
            entity_type="resource",
            key=resource.key,
            entity_id=resource_id,
            timestamp=timestamp,
        )
    return resource_ids


def _skill_id(
    connection: Connection,
    *,
    course_id: str,
    plan_source_id: str,
    plan_id: str,
    skill: SkillSpec,
) -> str:
    bound = _bound_entity_id(
        connection,
        plan_source_id=plan_source_id,
        plan_id=plan_id,
        entity_type="skill",
        key=skill.key,
    )
    if bound:
        return bound
    stable = stable_id("skill", course_id, skill.key)
    existing = connection.execute(
        text(
            """
            SELECT id
            FROM skills
            WHERE course_id = :course_id
              AND (id = :stable OR lower(name) = lower(:name))
            ORDER BY CASE WHEN id = :stable THEN 0 ELSE 1 END
            LIMIT 1
            """
        ),
        {"course_id": course_id, "stable": stable, "name": skill.name},
    ).scalar_one_or_none()
    return str(existing) if existing is not None else stable


def _sync_skills(
    connection: Connection,
    *,
    plan: StudyPlanSpec,
    course_id: str,
    plan_source_id: str,
    import_run_id: str,
    timestamp: str,
    counts: dict[str, int],
) -> dict[str, str]:
    skill_ids: dict[str, str] = {}
    for order_index, skill in enumerate(plan.skills, start=1):
        skill_id = _skill_id(
            connection,
            course_id=course_id,
            plan_source_id=plan_source_id,
            plan_id=plan.plan_id,
            skill=skill,
        )
        skill_ids[skill.key] = skill_id
        description_document_id = (
            _upsert_document(
                connection,
                identity=f"skill-description:{skill_id}",
                markdown=skill.description,
                timestamp=timestamp,
            )
            if skill.description
            else None
        )
        exists = connection.execute(
            text("SELECT 1 FROM skills WHERE id = :id"),
            {"id": skill_id},
        ).scalar_one_or_none()
        connection.execute(
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
                  description_document_id = COALESCE(
                    excluded.description_document_id,
                    skills.description_document_id
                  ),
                  order_index = excluded.order_index,
                  updated_at = excluded.updated_at,
                  deleted_at = NULL,
                  revision = skills.revision + 1
                """
            ),
            {
                "id": skill_id,
                "course_id": course_id,
                "name": skill.name,
                "category": skill.category,
                "description_document_id": description_document_id,
                "order_index": order_index,
                "timestamp": timestamp,
            },
        )
        counts["skills_updated" if exists else "skills_created"] += 1
        _bind(
            connection,
            plan_source_id=plan_source_id,
            import_run_id=import_run_id,
            plan_id=plan.plan_id,
            entity_type="skill",
            key=skill.key,
            entity_id=skill_id,
            timestamp=timestamp,
        )
    return skill_ids


def _day_id(
    connection: Connection,
    *,
    course_id: str,
    plan_source_id: str,
    plan_id: str,
    day: DaySpec,
) -> str:
    bound = _bound_entity_id(
        connection,
        plan_source_id=plan_source_id,
        plan_id=plan_id,
        entity_type="day",
        key=day.key,
    )
    if bound:
        return bound
    existing_number = connection.execute(
        text(
            """
            SELECT id
            FROM study_days
            WHERE course_id = :course_id AND number = :number
            LIMIT 1
            """
        ),
        {"course_id": course_id, "number": day.number},
    ).scalar_one_or_none()
    return (
        str(existing_number)
        if existing_number is not None
        else stable_id("day", course_id, day.key)
    )


def _upsert_day(
    connection: Connection,
    *,
    course_id: str,
    day_id: str,
    day: DaySpec,
    plan_mode: str,
    timestamp: str,
) -> bool:
    exists = connection.execute(
        text("SELECT 1 FROM study_days WHERE id = :id"),
        {"id": day_id},
    ).scalar_one_or_none()
    if exists is None:
        connection.execute(
            text(
                """
                INSERT INTO study_days (
                  id, course_id, number, date, order_index, title, topic, purpose,
                  goals_document_id, stop_when_document_id, closure_note_document_id,
                  status, opened_at, closed_at, completed_at, toggl_description_token,
                  created_at, updated_at, deleted_at, revision
                )
                VALUES (
                  :id, :course_id, :number, :date, :order_index, :title, :topic, :purpose,
                  NULL, NULL, NULL,
                  'not_started', NULL, NULL, NULL, :toggl_token,
                  :timestamp, :timestamp, NULL, 1
                )
                """
            ),
            {
                "id": day_id,
                "course_id": course_id,
                "number": day.number,
                "date": day.date,
                "order_index": day.order_index,
                "title": day.title,
                "topic": day.topic,
                "purpose": day.purpose,
                "toggl_token": day.key,
                "timestamp": timestamp,
            },
        )
        return True
    connection.execute(
        text(
            """
            UPDATE study_days
            SET number = :number,
                date = :date,
                order_index = CASE WHEN :full THEN :order_index ELSE order_index END,
                title = :title,
                topic = :topic,
                purpose = COALESCE(:purpose, purpose),
                toggl_description_token = :toggl_token,
                updated_at = :timestamp,
                deleted_at = NULL,
                revision = revision + 1
            WHERE id = :id
            """
        ),
        {
            "id": day_id,
            "number": day.number,
            "date": day.date,
            "order_index": day.order_index,
            "title": day.title,
            "topic": day.topic,
            "purpose": day.purpose,
            "toggl_token": day.key,
            "timestamp": timestamp,
            "full": plan_mode == "full",
        },
    )
    return False


def _task_id(
    connection: Connection,
    *,
    course_id: str,
    plan_source_id: str,
    plan_id: str,
    task: TaskSpec,
) -> str:
    bound = _bound_entity_id(
        connection,
        plan_source_id=plan_source_id,
        plan_id=plan_id,
        entity_type="task",
        key=task.key,
    )
    return bound or stable_id("task", course_id, task.key)


def _sync_task(
    connection: Connection,
    *,
    course_id: str,
    day_id: str,
    section_id: str,
    task_id: str,
    task: TaskSpec,
    order_index: int,
    plan_mode: str,
    timestamp: str,
) -> bool:
    rationale_document_id = (
        _upsert_document(
            connection,
            identity=f"task-rationale:{task_id}",
            markdown=task.rationale,
            timestamp=timestamp,
        )
        if task.rationale
        else None
    )
    exists = connection.execute(
        text("SELECT 1 FROM tasks WHERE id = :id"),
        {"id": task_id},
    ).scalar_one_or_none()
    initial_status = task.status or "todo"
    if exists is None:
        connection.execute(
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
                  :id, :day_id, :section_id, :title,
                  NULL, :rationale_document_id,
                  NULL, :task_type, :is_optional,
                  :order_index, :estimated_minutes, :status, NULL,
                  NULL,
                  CASE WHEN :status = 'done' THEN :timestamp ELSE NULL END,
                  CASE WHEN :status = 'later' THEN :timestamp ELSE NULL END,
                  CASE WHEN :status = 'skipped' THEN :timestamp ELSE NULL END,
                  :timestamp, :timestamp, NULL, 1
                )
                """
            ),
            {
                "id": task_id,
                "day_id": day_id,
                "section_id": section_id,
                "title": task.title,
                "rationale_document_id": rationale_document_id,
                "task_type": task.task_type,
                "is_optional": task.is_optional,
                "order_index": order_index,
                "estimated_minutes": task.estimated_minutes,
                "status": initial_status,
                "timestamp": timestamp,
            },
        )
        return True
    connection.execute(
        text(
            """
            UPDATE tasks
            SET day_id = :day_id,
                section_id = :section_id,
                title = :title,
                rationale_document_id = CASE
                  WHEN :full THEN :rationale_document_id
                  ELSE COALESCE(:rationale_document_id, rationale_document_id)
                END,
                task_type = COALESCE(:task_type, task_type),
                is_optional = :is_optional,
                order_index = CASE WHEN :full THEN :order_index ELSE order_index END,
                estimated_minutes = COALESCE(:estimated_minutes, estimated_minutes),
                status = CASE
                  WHEN :apply_status THEN :status
                  ELSE status
                END,
                completed_at = CASE
                  WHEN :apply_status AND :status = 'done' THEN :timestamp
                  ELSE completed_at
                END,
                deferred_at = CASE
                  WHEN :apply_status AND :status = 'later' THEN :timestamp
                  ELSE deferred_at
                END,
                skipped_at = CASE
                  WHEN :apply_status AND :status = 'skipped' THEN :timestamp
                  ELSE skipped_at
                END,
                updated_at = :timestamp,
                deleted_at = NULL,
                revision = revision + 1
            WHERE id = :id
            """
        ),
        {
            "id": task_id,
            "day_id": day_id,
            "section_id": section_id,
            "title": task.title,
            "rationale_document_id": rationale_document_id,
            "task_type": task.task_type,
            "is_optional": task.is_optional,
            "order_index": order_index,
            "estimated_minutes": task.estimated_minutes,
            "status": initial_status,
            "apply_status": plan_mode == "patch" and task.status is not None,
            "timestamp": timestamp,
            "full": plan_mode == "full",
        },
    )
    return False


def _sync_days_and_tasks(
    connection: Connection,
    *,
    plan: StudyPlanSpec,
    course_id: str,
    plan_source_id: str,
    import_run_id: str,
    resource_ids: dict[str, str],
    skill_ids: dict[str, str],
    timestamp: str,
    counts: dict[str, int],
) -> tuple[set[str], set[str], set[str]]:
    seen_day_ids: set[str] = set()
    seen_task_ids: set[str] = set()
    seen_section_ids: set[str] = set()
    for day in plan.days:
        day_id = _day_id(
            connection,
            course_id=course_id,
            plan_source_id=plan_source_id,
            plan_id=plan.plan_id,
            day=day,
        )
        seen_day_ids.add(day_id)
        created = _upsert_day(
            connection,
            course_id=course_id,
            day_id=day_id,
            day=day,
            plan_mode=plan.mode,
            timestamp=timestamp,
        )
        counts["days_created" if created else "days_updated"] += 1
        _bind(
            connection,
            plan_source_id=plan_source_id,
            import_run_id=import_run_id,
            plan_id=plan.plan_id,
            entity_type="day",
            key=day.key,
            entity_id=day_id,
            timestamp=timestamp,
        )
        day_skill_keys = set(day.skill_keys)
        for section in day.sections:
            section_id = stable_id("section", course_id, day_id, section.key)
            seen_section_ids.add(section_id)
            connection.execute(
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
                      order_index = CASE
                        WHEN :full THEN excluded.order_index
                        ELSE day_sections.order_index
                      END,
                      default_collapsed = excluded.default_collapsed,
                      updated_at = excluded.updated_at,
                      deleted_at = NULL
                    """
                ),
                {
                    "id": section_id,
                    "day_id": day_id,
                    "title": section.title,
                    "order_index": section.order_index,
                    "default_collapsed": section.default_collapsed,
                    "timestamp": timestamp,
                    "full": plan.mode == "full",
                },
            )
            counts["sections"] += 1
            for task in section.tasks:
                task_id = _task_id(
                    connection,
                    course_id=course_id,
                    plan_source_id=plan_source_id,
                    plan_id=plan.plan_id,
                    task=task,
                )
                seen_task_ids.add(task_id)
                created_task = _sync_task(
                    connection,
                    course_id=course_id,
                    day_id=day_id,
                    section_id=section_id,
                    task_id=task_id,
                    task=task,
                    order_index=section.order_index * 1000 + task.order_index,
                    plan_mode=plan.mode,
                    timestamp=timestamp,
                )
                counts["tasks_created" if created_task else "tasks_updated"] += 1
                _bind(
                    connection,
                    plan_source_id=plan_source_id,
                    import_run_id=import_run_id,
                    plan_id=plan.plan_id,
                    entity_type="task",
                    key=task.key,
                    entity_id=task_id,
                    timestamp=timestamp,
                )
                day_skill_keys.update(task.skill_keys)
                if plan.mode == "full" or task.resource_keys:
                    connection.execute(
                        text("DELETE FROM task_resources WHERE task_id = :task_id"),
                        {"task_id": task_id},
                    )
                    for resource_order, resource_key in enumerate(
                        task.resource_keys,
                        start=1,
                    ):
                        connection.execute(
                            text(
                                """
                                INSERT INTO task_resources (
                                  task_id, resource_id, relation, is_required,
                                  order_index, created_at
                                )
                                VALUES (
                                  :task_id, :resource_id, :relation, :is_required,
                                  :order_index, :timestamp
                                )
                                """
                            ),
                            {
                                "task_id": task_id,
                                "resource_id": resource_ids[resource_key],
                                "relation": (
                                    "exercise" if task.task_type == "solve" else "reading"
                                ),
                                "is_required": not task.is_optional,
                                "order_index": resource_order,
                                "timestamp": timestamp,
                            },
                        )
                        counts["task_resource_links"] += 1
        if plan.mode == "full" or day_skill_keys:
            connection.execute(
                text("DELETE FROM day_skills WHERE day_id = :day_id"),
                {"day_id": day_id},
            )
            for skill_key in sorted(day_skill_keys):
                connection.execute(
                    text(
                        """
                        INSERT INTO day_skills (
                          day_id, skill_id, coverage, is_primary, weight, created_at
                        )
                        VALUES (
                          :day_id, :skill_id, 'introduced', 0, 1, :timestamp
                        )
                        """
                    ),
                    {
                        "day_id": day_id,
                        "skill_id": skill_ids[skill_key],
                        "timestamp": timestamp,
                    },
                )
                counts["day_skill_links"] += 1
    return seen_day_ids, seen_task_ids, seen_section_ids


def _soft_delete_missing_structure(
    connection: Connection,
    *,
    course_id: str,
    seen_day_ids: set[str],
    seen_task_ids: set[str],
    seen_section_ids: set[str],
    seen_skill_ids: set[str],
    timestamp: str,
) -> None:
    def placeholders(values: set[str], prefix: str) -> tuple[str, dict[str, object]]:
        if not values:
            return "NULL", {}
        params: dict[str, object] = {
            f"{prefix}_{index}": value for index, value in enumerate(values)
        }
        return ", ".join(f":{key}" for key in params), params

    day_sql, day_params = placeholders(seen_day_ids, "day")
    task_sql, task_params = placeholders(seen_task_ids, "task")
    section_sql, section_params = placeholders(seen_section_ids, "section")
    skill_sql, skill_params = placeholders(seen_skill_ids, "skill")
    connection.execute(
        text(
            f"""
            UPDATE tasks
            SET deleted_at = :timestamp, updated_at = :timestamp, revision = revision + 1
            WHERE day_id IN (
              SELECT id FROM study_days WHERE course_id = :course_id
            )
              AND id NOT IN ({task_sql})
              AND deleted_at IS NULL
            """
        ),
        {"course_id": course_id, "timestamp": timestamp, **task_params},
    )
    connection.execute(
        text(
            f"""
            UPDATE day_sections
            SET deleted_at = :timestamp, updated_at = :timestamp
            WHERE day_id IN (
              SELECT id FROM study_days WHERE course_id = :course_id
            )
              AND id NOT IN ({section_sql})
              AND deleted_at IS NULL
            """
        ),
        {"course_id": course_id, "timestamp": timestamp, **section_params},
    )
    connection.execute(
        text(
            f"""
            UPDATE study_days
            SET deleted_at = :timestamp, updated_at = :timestamp, revision = revision + 1
            WHERE course_id = :course_id
              AND id NOT IN ({day_sql})
              AND deleted_at IS NULL
            """
        ),
        {"course_id": course_id, "timestamp": timestamp, **day_params},
    )
    connection.execute(
        text(
            f"""
            UPDATE skills
            SET deleted_at = :timestamp, updated_at = :timestamp, revision = revision + 1
            WHERE course_id = :course_id
              AND id NOT IN ({skill_sql})
              AND deleted_at IS NULL
            """
        ),
        {"course_id": course_id, "timestamp": timestamp, **skill_params},
    )


def sync_study_plan(path: Path, *, force_patch: bool = False) -> StudyPlanSyncResult:
    parsed = parse_study_plan(path)
    if parsed.plan is None or parsed.errors:
        raise StudyPlanSyncError(
            "\n".join(item.render() for item in parsed.diagnostics)
            or "Study plan could not be parsed."
        )
    plan = parsed.plan
    if force_patch and plan.mode != "patch":
        raise StudyPlanSyncError(
            'The patch command requires mode = "patch" in the plan frontmatter.'
        )
    run_migrations()
    timestamp = utc_now()
    counts = {
        "days_created": 0,
        "days_updated": 0,
        "sections": 0,
        "tasks_created": 0,
        "tasks_updated": 0,
        "resources_created": 0,
        "resources_updated": 0,
        "skills_created": 0,
        "skills_updated": 0,
        "task_resource_links": 0,
        "day_skill_links": 0,
    }
    with transaction() as active_connection:
        course_id = _upsert_course(active_connection, plan, timestamp=timestamp)
        import_run_id = _start_import_run(
            active_connection,
            course_id=course_id,
            plan=plan,
            timestamp=timestamp,
        )
        plan_source_id = _plan_source(
            active_connection,
            course_id=course_id,
            plan=plan,
            import_run_id=import_run_id,
            timestamp=timestamp,
        )
        resource_ids = _sync_resources(
            active_connection,
            plan=plan,
            course_id=course_id,
            plan_source_id=plan_source_id,
            import_run_id=import_run_id,
            timestamp=timestamp,
            counts=counts,
        )
        skill_ids = _sync_skills(
            active_connection,
            plan=plan,
            course_id=course_id,
            plan_source_id=plan_source_id,
            import_run_id=import_run_id,
            timestamp=timestamp,
            counts=counts,
        )
        seen_day_ids, seen_task_ids, seen_section_ids = _sync_days_and_tasks(
            active_connection,
            plan=plan,
            course_id=course_id,
            plan_source_id=plan_source_id,
            import_run_id=import_run_id,
            resource_ids=resource_ids,
            skill_ids=skill_ids,
            timestamp=timestamp,
            counts=counts,
        )
        if plan.mode == "full":
            _soft_delete_missing_structure(
                active_connection,
                course_id=course_id,
                seen_day_ids=seen_day_ids,
                seen_task_ids=seen_task_ids,
                seen_section_ids=seen_section_ids,
                seen_skill_ids=set(skill_ids.values()),
                timestamp=timestamp,
            )
        total_changes = sum(counts.values())
        active_connection.execute(
            text(
                """
                UPDATE import_runs
                SET status = 'completed',
                    imported_count = :imported_count,
                    updated_count = :updated_count,
                    details_json = :details_json,
                    finished_at = :timestamp
                WHERE id = :id
                """
            ),
            {
                "id": import_run_id,
                "imported_count": (
                    counts["days_created"]
                    + counts["tasks_created"]
                    + counts["resources_created"]
                    + counts["skills_created"]
                ),
                "updated_count": total_changes,
                "details_json": _json(
                    {
                        "format": plan.format,
                        "mode": plan.mode,
                        "source_path": str(plan.source_path),
                        "counts": counts,
                        "warnings": [item.render() for item in parsed.warnings],
                    }
                ),
                "timestamp": timestamp,
            },
        )
        active_connection.execute(
            text(
                """
                UPDATE plan_sources
                SET last_successful_import_at = :timestamp,
                    last_import_run_id = :import_run_id,
                    updated_at = :timestamp
                WHERE id = :id
                """
            ),
            {
                "id": plan_source_id,
                "import_run_id": import_run_id,
                "timestamp": timestamp,
            },
        )
    return StudyPlanSyncResult(
        course_id=course_id,
        plan_id=plan.plan_id,
        mode=plan.mode,
        source_path=str(plan.source_path),
        import_run_id=import_run_id,
        counts=counts,
        diagnostics=tuple(parsed.diagnostics),
    )


def inspect_plan_structure(course_selector: str) -> str:
    run_migrations()
    with transaction() as active_connection:
        course = _row(
            active_connection,
            """
            SELECT id, title, short_code, settings_json
            FROM courses
            WHERE deleted_at IS NULL
              AND (
                id = :selector
                OR lower(short_code) = lower(:selector)
                OR lower(title) = lower(:selector)
                OR json_extract(settings_json, '$.plan_id') = :selector
                OR json_extract(settings_json, '$.legacy_plan_id') = :selector
              )
            LIMIT 1
            """,
            {"selector": course_selector},
        )
        if course is None:
            raise StudyPlanSyncError(f"Unknown course: {course_selector}")
        settings = json.loads(str(course.get("settings_json") or "{}"))
        plan_id = str(
            settings.get("plan_id")
            or settings.get("legacy_plan_id")
            or course["short_code"]
            or course["id"]
        )
        binding_rows = active_connection.execute(
            text(
                """
                SELECT entity_type, entity_id, source_key
                FROM source_bindings
                WHERE source_key LIKE :prefix
                  AND entity_type IN ('day', 'task')
                ORDER BY updated_at DESC
                """
            ),
            {"prefix": f"{plan_id}:%"},
        ).mappings()
        keys_by_entity: dict[tuple[str, str], str] = {}
        for binding in binding_rows:
            keys_by_entity.setdefault(
                (str(binding["entity_type"]), str(binding["entity_id"])),
                str(binding["source_key"]).split(":", 1)[-1],
            )
        lines = [
            f"# {course['title']}",
            "",
            f"Plan id: `{plan_id}`",
            f"Course id: `{course['id']}`",
            "",
        ]
        days = active_connection.execute(
            text(
                """
                SELECT id, number, date, title
                FROM study_days
                WHERE course_id = :course_id AND deleted_at IS NULL
                ORDER BY order_index
                """
            ),
            {"course_id": course["id"]},
        ).mappings()
        for day in days:
            day_id = str(day["id"])
            day_key = keys_by_entity.get(("day", day_id), day_id)
            lines.append(f"### Day {day['number']}: {day['title']} {{#{day_key}}}")
            if day["date"]:
                lines.append(f"Date: {day['date']}")
            sections = active_connection.execute(
                text(
                    """
                    SELECT id, title
                    FROM day_sections
                    WHERE day_id = :day_id AND deleted_at IS NULL
                    ORDER BY order_index
                    """
                ),
                {"day_id": day_id},
            ).mappings()
            for section in sections:
                lines.extend(["", f"#### {section['title']}"])
                tasks = active_connection.execute(
                    text(
                        """
                        SELECT id, title, status
                        FROM tasks
                        WHERE section_id = :section_id AND deleted_at IS NULL
                        ORDER BY order_index
                        """
                    ),
                    {"section_id": section["id"]},
                ).mappings()
                for task in tasks:
                    task_id = str(task["id"])
                    task_key = keys_by_entity.get(("task", task_id), task_id)
                    checkbox = "x" if task["status"] == "done" else " "
                    lines.append(f"- [{checkbox}] {task['title']} {{#{task_key}}}")
            lines.append("")
        return "\n".join(lines).rstrip() + "\n"
