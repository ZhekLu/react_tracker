from pathlib import Path
from typing import Annotated, Any
from zoneinfo import ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import Connection

from ..repositories.workspace_repository import EntityNotFoundError, RevisionConflictError
from ..services import task_admin_service as service
from ..services.course_progress_service import CourseProgressExport, export_course_progress
from .deps import db_connection

router = APIRouter(prefix="/api")
Database = Annotated[Connection, Depends(db_connection)]


@router.get("/courses/{course_id}/progress-export", response_model=CourseProgressExport)
def progress_export(
    course_id: str, connection: Database, time_zone: str = "UTC",
) -> CourseProgressExport:
    try:
        return export_course_progress(connection, course_id, time_zone=time_zone)
    except EntityNotFoundError as error:
        raise HTTPException(404, str(error)) from error
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise HTTPException(422, "Unknown time zone.") from error


@router.get("/plan-patching-guide")
def patching_guide() -> dict[str, str]:
    path = Path(__file__).resolve().parents[3] / "docs" / "plan-patching.md"
    return {"markdown": path.read_text(encoding="utf-8")}


@router.get("/courses/{course_id}/task-admin")
def overview(course_id: str, connection: Database) -> dict[str, Any]:
    try:
        return service.overview(connection, course_id)
    except EntityNotFoundError as error:
        raise HTTPException(404, str(error)) from error


@router.post("/tasks/{task_id}/admin")
def edit(task_id: str, command: service.TaskAdminCommand, connection: Database) -> dict[str, Any]:
    try:
        return service.apply(connection, task_id, command)
    except EntityNotFoundError as error:
        raise HTTPException(404, str(error)) from error
    except RevisionConflictError as error:
        raise HTTPException(409, str(error)) from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    except OSError as error:
        raise HTTPException(503, "Backup unavailable; no task changes were made.") from error
