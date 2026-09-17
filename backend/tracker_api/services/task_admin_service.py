"""Transactional task maintenance, with backups, retry receipts and patch protection."""
from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import Field, field_validator, model_validator
from sqlalchemy import Connection, text

from ..backup import backup_database
from ..repositories.workspace_repository import EntityNotFoundError, RevisionConflictError
from ..schemas.workspace import StrictModel, TaskStatus

logger = logging.getLogger("uvicorn.error")
EDIT_FIELDS = {"title", "status", "resource_ids", "estimated_minutes", "is_optional"}


class TaskAdminCommand(StrictModel):
    request_id: UUID
    revision: int = Field(ge=1)
    action: Literal["edit", "delete", "restore", "release"]
    title: str | None = Field(default=None, max_length=2000)
    status: TaskStatus | None = None
    resource_ids: list[str] | None = Field(default=None, max_length=200)
    estimated_minutes: int | None = Field(default=None, ge=0, le=10080)
    is_optional: bool | None = None

    @field_validator("title")
    @classmethod
    def valid_title(cls, value: str | None) -> str | None:
        if value is not None and (not value.strip() or "\n" in value or "\r" in value):
            raise ValueError("Use a non-empty, single-line task title.")
        return value.strip() if value is not None else value

    @model_validator(mode="after")
    def valid_edit(self) -> TaskAdminCommand:
        fields = self.model_fields_set & EDIT_FIELDS
        if self.action != "edit" and fields:
            raise ValueError("Only edit actions accept task fields.")
        if self.action == "edit" and not fields:
            raise ValueError("Choose at least one task field to edit.")
        if any(getattr(self, key) is None for key in fields - {"estimated_minutes"}):
            raise ValueError("Only estimated_minutes can be cleared with null.")
        if self.resource_ids is not None and len(set(self.resource_ids)) != len(self.resource_ids):
            raise ValueError("Resource IDs must be unique.")
        return self


def _snapshot(connection: Connection, task_id: str) -> dict[str, Any]:
    row = connection.execute(text("""
        SELECT t.*, d.course_id, d.number day_number, d.title day_title,
          d.deleted_at day_deleted_at, s.title section_title, s.deleted_at section_deleted_at
        FROM tasks t JOIN study_days d ON d.id=t.day_id
        JOIN courses c ON c.id=d.course_id
        LEFT JOIN day_sections s ON s.id=t.section_id
        WHERE t.id=:id AND c.deleted_at IS NULL
    """), {"id": task_id}).mappings().one_or_none()
    if row is None:
        raise EntityNotFoundError("Task not found.")
    result = dict(row)
    result["resource_ids"] = sorted(connection.execute(text(
        "SELECT DISTINCT resource_id FROM task_resources WHERE task_id=:id"
    ), {"id": task_id}).scalars())
    state = connection.execute(text(
        "SELECT * FROM task_admin_state WHERE task_id=:id"
    ), {"id": task_id}).mappings().one_or_none()
    result["protected_fields"] = json.loads(state["protected_fields_json"]) if state else []
    result["removed_at"] = state["removed_at"] if state else None
    result["note_count"] = connection.execute(text("""
        SELECT count(DISTINCT n.id) FROM notes n JOIN note_links l ON l.note_id=n.id
        WHERE l.entity_type='task' AND l.entity_id=:id AND n.deleted_at IS NULL
    """), {"id": task_id}).scalar_one()
    result["running_timer"] = bool(connection.execute(text("""
        SELECT 1 FROM time_entries WHERE task_id=:id AND stopped_at IS NULL LIMIT 1
    """), {"id": task_id}).scalar_one_or_none())
    return result


def overview(connection: Connection, course_id: str) -> dict[str, Any]:
    if not connection.execute(text(
        "SELECT 1 FROM courses WHERE id=:id AND deleted_at IS NULL"
    ), {"id": course_id}).scalar_one_or_none():
        raise EntityNotFoundError("Course not found.")
    ids = connection.execute(text("""
        SELECT t.id FROM tasks t JOIN study_days d ON d.id=t.day_id
        LEFT JOIN task_admin_state a ON a.task_id=t.id
        WHERE d.course_id=:id AND d.deleted_at IS NULL
          AND (t.deleted_at IS NULL OR a.removed_at IS NOT NULL)
        ORDER BY d.order_index, t.order_index
    """), {"id": course_id}).scalars()
    history = connection.execute(text("""
        SELECT id,task_id,action,before_json,after_json,backup_path,created_at
        FROM task_admin_events WHERE course_id=:id ORDER BY created_at DESC LIMIT 100
    """), {"id": course_id}).mappings()
    return {"tasks": [_snapshot(connection, str(id)) for id in ids], "history": [
        {**dict(row), "before": json.loads(row["before_json"]),
         "after": json.loads(row["after_json"]), "before_json": None, "after_json": None}
        for row in history
    ]}


def apply(
    connection: Connection, task_id: str, command: TaskAdminCommand,
    *, transaction_ready: bool = False, existing_backup: str | None = None,
) -> dict[str, Any]:
    # Acquire the write reservation before reading revisions, validating or backing up.
    if not transaction_ready:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    request_json = command.model_dump_json(exclude_unset=True)
    receipt = connection.execute(text(
        "SELECT * FROM task_admin_events WHERE id=:id"
    ), {"id": str(command.request_id)}).mappings().one_or_none()
    if receipt:
        if receipt["task_id"] != task_id or receipt["request_json"] != request_json:
            raise RevisionConflictError("This request ID was already used for another change.")
        return {"task": _snapshot(connection, task_id), "backup_path": receipt["backup_path"],
                "event_id": str(command.request_id)}
    before = _snapshot(connection, task_id)
    if before["revision"] != command.revision:
        raise RevisionConflictError("Task changed since it was opened. Reload before editing.")
    if before["day_deleted_at"] or before["section_deleted_at"]:
        raise ValueError("The owning day or section was removed. Restore the plan structure first.")
    if command.action == "restore":
        if not before["removed_at"]:
            raise ValueError("Only tasks removed in Administration can be restored here.")
    elif before["deleted_at"]:
        raise ValueError("Restore this task before editing it.")
    if before["running_timer"] and (command.action == "delete" or command.status == "skipped"):
        raise ValueError("Stop this task's running timer before cancelling or deleting it.")
    fields = command.model_fields_set & EDIT_FIELDS
    if command.resource_ids is not None:
        for resource_id in command.resource_ids:
            if not connection.execute(text("""
                SELECT 1 FROM resources WHERE id=:id AND course_id=:course AND deleted_at IS NULL
            """), {"id": resource_id, "course": before["course_id"]}).scalar_one_or_none():
                raise ValueError("Resources must be active and belong to this course.")
    changed = {key for key in fields if (
        sorted(command.resource_ids or []) if key == "resource_ids" else getattr(command, key)
    ) != before[key]}
    if command.action == "edit" and not changed:
        return {"task": before, "backup_path": None, "event_id": None}
    # Plan patches already hold the write lock and share one pre-patch backup.
    backup_path = existing_backup or str(backup_database())
    now = datetime.now(UTC).isoformat()
    protection = set(before["protected_fields"])
    connection.execute(text("INSERT OR IGNORE INTO task_admin_state(task_id) VALUES (:id)"),
                       {"id": task_id})
    if command.action == "delete":
        connection.execute(text("""
            UPDATE task_admin_state SET removed_at=:now,original_order=:order WHERE task_id=:id
        """), {"id": task_id, "now": now, "order": before["order_index"]})
        connection.execute(text("""
            UPDATE tasks SET deleted_at=:now,order_index=(
                SELECT MIN(COALESCE(MIN(order_index),0),0)-1 FROM tasks WHERE day_id=:day
            ) WHERE id=:id
        """), {"id": task_id, "now": now, "day": before["day_id"]})
    elif command.action == "restore":
        order = connection.execute(text(
            "SELECT original_order FROM task_admin_state WHERE task_id=:id"
        ), {"id": task_id}).scalar_one()
        if connection.execute(text(
            "SELECT 1 FROM tasks WHERE day_id=:day AND order_index=:order AND id<>:id"
        ), {"day": before["day_id"], "order": order, "id": task_id}).scalar_one_or_none():
            order = connection.execute(text(
                "SELECT COALESCE(MAX(order_index),0)+1 FROM tasks WHERE day_id=:day"
            ), {"day": before["day_id"]}).scalar_one()
        connection.execute(text("UPDATE tasks SET deleted_at=NULL,order_index=:order WHERE id=:id"),
                           {"id": task_id, "order": order})
        connection.execute(text("UPDATE task_admin_state SET removed_at=NULL WHERE task_id=:id"),
                           {"id": task_id})
    elif command.action == "release":
        protection.clear()
    else:
        protection.update(changed)
        for key in changed - {"resource_ids"}:
            # Keys come exclusively from the fixed EDIT_FIELDS allowlist.
            connection.execute(text(f"UPDATE tasks SET {key}=:value WHERE id=:id"),
                               {"id": task_id, "value": getattr(command, key)})
        if "status" in changed:
            connection.execute(text("""
                UPDATE tasks SET
                  completed_at=CASE WHEN status='done' THEN :now ELSE NULL END,
                  skipped_at=CASE WHEN status='skipped' THEN :now ELSE NULL END,
                  deferred_at=CASE WHEN status='later' THEN :now ELSE NULL END,
                  started_at=CASE WHEN status='in_progress' THEN COALESCE(started_at,:now)
                    ELSE started_at END,
                  defer_until=NULL WHERE id=:id
            """), {"id": task_id, "now": now})
        if "resource_ids" in changed:
            desired = set(command.resource_ids or [])
            for resource_id in set(before["resource_ids"]) - desired:
                connection.execute(text(
                    "DELETE FROM task_resources WHERE task_id=:task AND resource_id=:resource"
                ), {"task": task_id, "resource": resource_id})
            for index, resource_id in enumerate(sorted(desired - set(before["resource_ids"]))):
                connection.execute(text("""
                    INSERT INTO task_resources
                    VALUES (:task,:resource,:relation,:required,:ord,:now)
                """), {"task": task_id, "resource": resource_id,
                       "relation": "exercise" if before["task_type"] == "solve" else "reading",
                       "required": not before["is_optional"],
                       "ord": len(before["resource_ids"]) + index + 1, "now": now})
    connection.execute(text("""
        UPDATE tasks SET updated_at=:now,revision=revision+1 WHERE id=:id
    """), {"id": task_id, "now": now})
    connection.execute(text("""
        UPDATE task_admin_state SET protected_fields_json=:fields WHERE task_id=:id
    """), {"id": task_id, "fields": json.dumps(sorted(protection))})
    after = _snapshot(connection, task_id)
    connection.execute(text("""
        INSERT INTO task_admin_events VALUES (:id,:course,:task,:action,:request,:before,
          :after,:backup,:now)
    """), {"id": str(command.request_id), "course": before["course_id"], "task": task_id,
           "action": command.action, "request": request_json, "before": json.dumps(before),
           "after": json.dumps(after), "backup": backup_path, "now": now})
    if connection.exec_driver_sql("PRAGMA foreign_key_check").first():
        raise ValueError("Integrity check failed; the change was rolled back.")
    logger.info("task.admin action=%s task_id=%s event_id=%s revision=%s",
                command.action, task_id, command.request_id, after["revision"])
    return {"task": after, "backup_path": backup_path, "event_id": str(command.request_id)}
