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
    AnnotationCreateCommand,
    CourseListResponse,
    CourseWorkspace,
    DayStatusCommand,
    DiscussionCreateCommand,
    DiscussionMessageCreateCommand,
    DiscussionStatusCommand,
    ExamStatusCommand,
    MutationResponse,
    NoteUpsertCommand,
    PromptBatchCreateCommand,
    ResourceContentResponse,
    ResourceOpenResponse,
    ResourceProgressCommand,
    ResourceStatusCommand,
    TaskStatusCommand,
)
from ..services.resource_content_service import read_resource_content
from ..services.resource_open_service import ResourceOpenError, open_resource


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


@router.post("/resources/{resource_id}/open", response_model=ResourceOpenResponse)
def open_resource_file(resource_id: str, connection: Database) -> ResourceOpenResponse:
    try:
        local_path, source_url = workspace_repository.resource_open_target(
            connection,
            resource_id,
        )
        target, application = open_resource(
            local_path=local_path,
            source_url=source_url,
        )
        return ResourceOpenResponse(
            resource_id=resource_id,
            target=target,
            application=application,
        )
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error
    except ResourceOpenError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(error),
        ) from error


@router.get("/resources/{resource_id}/content", response_model=ResourceContentResponse)
def get_resource_content(
    resource_id: str,
    connection: Database,
) -> ResourceContentResponse:
    try:
        title, version_id, local_path = workspace_repository.resource_content_target(
            connection,
            resource_id,
        )
        content = read_resource_content(local_path)
        return ResourceContentResponse(
            resource_id=resource_id,
            version_id=version_id,
            title=title,
            format=content.format,
            content=content.content,
            source_path=str(content.path),
        )
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error
    except ResourceOpenError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(error),
        ) from error


@router.patch("/resources/{resource_id}/progress", response_model=MutationResponse)
def update_resource_progress(
    resource_id: str,
    command: ResourceProgressCommand,
    connection: Database,
) -> MutationResponse:
    try:
        return workspace_repository.update_resource_progress(
            connection,
            resource_id,
            command,
        )
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


@router.post("/annotations", response_model=MutationResponse)
def create_annotation(
    command: AnnotationCreateCommand,
    connection: Database,
) -> MutationResponse:
    try:
        return workspace_repository.create_annotation(connection, command)
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error


@router.post("/notes", response_model=MutationResponse)
def upsert_note(command: NoteUpsertCommand, connection: Database) -> MutationResponse:
    try:
        return workspace_repository.upsert_note(connection, command)
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error


@router.post("/prompt-batches", response_model=MutationResponse)
def create_prompt_batch(
    command: PromptBatchCreateCommand,
    connection: Database,
) -> MutationResponse:
    try:
        return workspace_repository.create_prompt_batch(connection, command)
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error


@router.post("/discussions", response_model=MutationResponse)
def create_discussion(
    command: DiscussionCreateCommand,
    connection: Database,
) -> MutationResponse:
    try:
        return workspace_repository.create_discussion(connection, command)
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error


@router.post("/discussions/{discussion_id}/messages", response_model=MutationResponse)
def create_discussion_message(
    discussion_id: str,
    command: DiscussionMessageCreateCommand,
    connection: Database,
) -> MutationResponse:
    try:
        return workspace_repository.create_discussion_message(
            connection,
            discussion_id,
            command,
        )
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error


@router.patch("/discussions/{discussion_id}/status", response_model=MutationResponse)
def update_discussion_status(
    discussion_id: str,
    command: DiscussionStatusCommand,
    connection: Database,
) -> MutationResponse:
    try:
        return workspace_repository.update_discussion_status(
            connection,
            discussion_id,
            command,
        )
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error
