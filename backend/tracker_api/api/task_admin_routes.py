from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import Connection

from ..repositories.workspace_repository import EntityNotFoundError, RevisionConflictError
from ..services import task_admin_service as service
from .deps import db_connection

router = APIRouter(prefix="/api")
Database = Annotated[Connection, Depends(db_connection)]


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
