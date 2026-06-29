from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.engine import Connection

from ..api.deps import db_connection
from ..config import get_settings
from ..repositories import workspace_repository
from ..schemas.workspace import (
    AnnotationCommand,
    CourseListResponse,
    CourseWorkspace,
    DayStatusCommand,
    ExamStatusCommand,
    MutationResponse,
    NoteUpsertCommand,
    ResourceStatusCommand,
    TaskStatusCommand,
)


class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ok: bool
    database: str


router = APIRouter(prefix="/api")
Database = Annotated[Connection, Depends(db_connection)]


def _translate_repository_error(
    error: workspace_repository.WorkspaceRepositoryError,
) -> HTTPException:
    if isinstance(error, workspace_repository.EntityNotFoundError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))
    if isinstance(error, workspace_repository.RevisionConflictError):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error))
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(error))


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(ok=True, database=str(get_settings().database_path))


@router.get("/courses", response_model=CourseListResponse)
def list_courses(connection: Database) -> CourseListResponse:
    return workspace_repository.list_courses(connection)


@router.get("/courses/{course_id}/workspace", response_model=CourseWorkspace)
def get_workspace(course_id: str, connection: Database) -> CourseWorkspace:
    try:
        return workspace_repository.get_workspace(connection, course_id)
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error


@router.patch("/tasks/{task_id}/status", response_model=MutationResponse)
def update_task_status(
    task_id: str,
    command: TaskStatusCommand,
    connection: Database,
) -> MutationResponse:
    try:
        return workspace_repository.update_task_status(connection, task_id, command)
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error


@router.patch("/days/{day_id}/status", response_model=MutationResponse)
def update_day_status(
    day_id: str,
    command: DayStatusCommand,
    connection: Database,
) -> MutationResponse:
    try:
        return workspace_repository.update_day_status(connection, day_id, command)
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error


@router.patch("/resources/{resource_id}/status", response_model=MutationResponse)
def update_resource_status(
    resource_id: str,
    command: ResourceStatusCommand,
    connection: Database,
) -> MutationResponse:
    try:
        return workspace_repository.update_resource_status(connection, resource_id, command)
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error


@router.patch("/exam-questions/{question_id}/status", response_model=MutationResponse)
def update_exam_question_status(
    question_id: str,
    command: ExamStatusCommand,
    connection: Database,
) -> MutationResponse:
    try:
        return workspace_repository.update_exam_question_status(connection, question_id, command)
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error


@router.patch("/annotations/{annotation_id}", response_model=MutationResponse)
def update_annotation(
    annotation_id: str,
    command: AnnotationCommand,
    connection: Database,
) -> MutationResponse:
    try:
        return workspace_repository.update_annotation(connection, annotation_id, command)
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error


@router.post("/notes", response_model=MutationResponse)
def upsert_note(command: NoteUpsertCommand, connection: Database) -> MutationResponse:
    try:
        return workspace_repository.upsert_note(connection, command)
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error
