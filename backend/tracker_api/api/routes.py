from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
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
    DiscussionAttentionCommand,
    DiscussionCreateCommand,
    DiscussionDeleteCommand,
    DiscussionMessageCreateCommand,
    DiscussionMessageUpdateCommand,
    DiscussionQuestionLinkCommand,
    DiscussionStatusCommand,
    ExamStatusCommand,
    MutationResponse,
    NoteUpsertCommand,
    PdfAnnotationCollectionResponse,
    PromptBatchCreateCommand,
    ResourceContentResponse,
    ResourceOpenResponse,
    ResourceProgressCommand,
    ResourceStatusCommand,
    TaskStatusCommand,
    TogglStartCommand,
    TogglStatusResponse,
)
from ..services.pdf_annotation_service import (
    PdfAnnotationError,
    collect_resource_pdf_annotations,
)
from ..services.pdf_ink_image_service import (
    PdfInkImageError,
    annotation_image_path,
)
from ..services.resource_content_service import read_resource_content
from ..services.resource_open_service import ResourceOpenError, open_resource
from ..services.toggl_service import (
    TogglConfigurationError,
    TogglServiceError,
    public_status,
    start,
    stop,
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


@router.post(
    "/resources/{resource_id}/files/{file_index}/open",
    response_model=ResourceOpenResponse,
)
def open_resource_local_file(
    resource_id: str,
    file_index: int,
    connection: Database,
) -> ResourceOpenResponse:
    try:
        local_path, source_url = workspace_repository.resource_file_open_target(
            connection,
            resource_id,
            file_index,
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


@router.post(
    "/resources/{resource_id}/pdf-annotations/collect",
    response_model=PdfAnnotationCollectionResponse,
)
def collect_resource_annotations(
    resource_id: str,
    connection: Database,
) -> PdfAnnotationCollectionResponse:
    try:
        result = collect_resource_pdf_annotations(connection, resource_id)
        return PdfAnnotationCollectionResponse(
            resource_id=result.resource_id,
            path=str(result.path),
            extracted_count=result.extracted_count,
            created_count=result.created_count,
            updated_count=result.updated_count,
            existing_count=result.existing_count,
            removed_count=result.removed_count,
            ignored_count=result.ignored_count,
            ignored=result.ignored,
            kind_counts=result.kind_counts,
        )
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error
    except PdfAnnotationError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(error),
        ) from error


@router.get(
    "/resources/{resource_id}/annotation-images/{image_id}",
    response_class=FileResponse,
)
def get_annotation_image(resource_id: str, image_id: str) -> FileResponse:
    try:
        path = annotation_image_path(resource_id, image_id)
    except PdfInkImageError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(error),
        ) from error
    if not path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Annotation image does not exist.",
        )
    return FileResponse(path, media_type="image/png")


@router.get("/integrations/toggl", response_model=TogglStatusResponse)
def get_toggl_status() -> TogglStatusResponse:
    return TogglStatusResponse.model_validate(public_status())


def _toggl_error(error: TogglServiceError) -> HTTPException:
    code = (
        status.HTTP_422_UNPROCESSABLE_ENTITY
        if isinstance(error, TogglConfigurationError)
        else status.HTTP_502_BAD_GATEWAY
    )
    return HTTPException(status_code=code, detail=str(error))


@router.post("/integrations/toggl/start", response_model=TogglStatusResponse)
def start_toggl(command: TogglStartCommand) -> TogglStatusResponse:
    try:
        return TogglStatusResponse.model_validate(start(command.description))
    except TogglServiceError as error:
        raise _toggl_error(error) from error


@router.post("/integrations/toggl/stop", response_model=TogglStatusResponse)
def stop_toggl() -> TogglStatusResponse:
    try:
        return TogglStatusResponse.model_validate(stop())
    except TogglServiceError as error:
        raise _toggl_error(error) from error


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


@router.patch("/discussion-messages/{message_id}", response_model=MutationResponse)
def update_discussion_message(
    message_id: str,
    command: DiscussionMessageUpdateCommand,
    connection: Database,
) -> MutationResponse:
    try:
        return workspace_repository.update_discussion_message(
            connection,
            message_id,
            command,
        )
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error


@router.put(
    "/discussion-messages/{message_id}/questions/{annotation_id}",
    response_model=MutationResponse,
)
def link_discussion_question(
    message_id: str,
    annotation_id: str,
    command: DiscussionQuestionLinkCommand,
    connection: Database,
) -> MutationResponse:
    try:
        return workspace_repository.link_discussion_question(
            connection,
            message_id,
            annotation_id,
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


@router.patch(
    "/discussions/{discussion_id}/attention",
    response_model=MutationResponse,
)
def update_discussion_attention(
    discussion_id: str,
    command: DiscussionAttentionCommand,
    connection: Database,
) -> MutationResponse:
    try:
        return workspace_repository.update_discussion_attention(
            connection,
            discussion_id,
            command,
        )
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error


@router.delete("/discussions/{discussion_id}", response_model=MutationResponse)
def delete_discussion(
    discussion_id: str,
    command: DiscussionDeleteCommand,
    connection: Database,
) -> MutationResponse:
    try:
        return workspace_repository.delete_discussion(
            connection,
            discussion_id,
            command,
        )
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error
