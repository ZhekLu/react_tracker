from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy.engine import Connection

from ..api.deps import db_connection
from ..config import get_settings
from ..repositories import workspace_repository
from ..schemas.workspace import (
    AnnotationCommand,
    AnnotationCreateCommand,
    CourseFileItem,
    CourseFileOpenCommand,
    CourseFileOpenResponse,
    CourseFilesResponse,
    CourseListResponse,
    CourseWorkspace,
    DayStatusCommand,
    DiscussionAnswerDeleteCommand,
    DiscussionAttentionCommand,
    DiscussionCreateCommand,
    DiscussionDeleteCommand,
    DiscussionMessageCreateCommand,
    DiscussionMessageReviewCommand,
    DiscussionMessageUpdateCommand,
    DiscussionQuestionLinkCommand,
    DiscussionStatusCommand,
    DrawboardColorRolesCommand,
    DrawboardColorRolesResponse,
    ExamStatusCommand,
    ExerciseScreenshotItem,
    ExerciseScreenshotResponse,
    MutationResponse,
    NoteDeleteCommand,
    NoteUpsertCommand,
    PdfAnnotationCollectionResponse,
    PdfReaderMetadataResponse,
    PdfReaderPage,
    PromptBatchCreateCommand,
    PromptBatchCreateResponse,
    PromptBatchJobResponse,
    ResourceChapterProgressCommand,
    ResourceContentResponse,
    ResourceOpenResponse,
    ResourceProgressCommand,
    ResourceStatusCommand,
    TaskStatusCommand,
    TogglStartCommand,
    TogglStatusResponse,
)
from ..services.course_file_service import (
    CourseFileError,
    list_course_files,
    open_course_file,
)
from ..services.exercise_solution_service import (
    ExerciseSolutionError,
    prepare_exercise_solution_screenshots,
)
from ..services.pdf_annotation_service import (
    PdfAnnotationError,
    collect_resource_pdf_annotations,
    save_drawboard_color_roles,
)
from ..services.pdf_ink_image_service import (
    PdfInkImageError,
    annotation_image_path,
)
from ..services.pdf_reader_service import (
    PdfReaderError,
    pdf_metadata,
    render_pdf_page,
)
from ..services.prompt_attachment_service import PromptAttachmentError
from ..services.prompt_batch_job_service import (
    get_prompt_batch_job,
    start_prompt_batch_job,
)
from ..services.prompt_batch_service import (
    create_prompt_batch as create_prompt_batch_with_attachments,
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


@router.get(
    "/courses/{course_id}/files",
    response_model=CourseFilesResponse,
)
def get_course_files(
    course_id: str,
    connection: Database,
) -> CourseFilesResponse:
    try:
        short_code = workspace_repository.course_short_code(
            connection,
            course_id,
        )
        return CourseFilesResponse(
            files=[
                CourseFileItem(
                    id=item.id,
                    name=item.name,
                    relative_path=item.relative_path,
                    root_name=item.root_name,
                )
                for item in list_course_files(short_code)
            ]
        )
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error
    except CourseFileError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(error),
        ) from error


@router.post(
    "/courses/{course_id}/files/open",
    response_model=CourseFileOpenResponse,
)
def open_configured_course_file(
    course_id: str,
    command: CourseFileOpenCommand,
    connection: Database,
) -> CourseFileOpenResponse:
    try:
        short_code = workspace_repository.course_short_code(
            connection,
            course_id,
        )
        target, application = open_course_file(short_code, command.file_id)
        return CourseFileOpenResponse(
            target=str(target),
            application=application,
        )
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error
    except CourseFileError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(error),
        ) from error


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


@router.get(
    "/resources/{resource_id}/pdf",
    response_model=PdfReaderMetadataResponse,
)
def get_resource_pdf_metadata(
    resource_id: str,
    connection: Database,
) -> PdfReaderMetadataResponse:
    try:
        title, _version_id, local_path = (
            workspace_repository.resource_content_target(
                connection,
                resource_id,
            )
        )
        metadata = pdf_metadata(local_path)
        return PdfReaderMetadataResponse(
            resource_id=resource_id,
            title=title,
            page_count=metadata.page_count,
            pages=[
                PdfReaderPage(number=page.number, title=page.title)
                for page in metadata.pages
            ],
            source_path=str(metadata.path),
        )
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error
    except PdfReaderError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(error),
        ) from error


@router.get("/resources/{resource_id}/pdf/pages/{page_number}")
def get_resource_pdf_page(
    resource_id: str,
    page_number: int,
    connection: Database,
) -> Response:
    try:
        _title, _version_id, local_path = (
            workspace_repository.resource_content_target(
                connection,
                resource_id,
            )
        )
        return Response(
            content=render_pdf_page(local_path, page_number),
            media_type="image/png",
            headers={"Cache-Control": "private, max-age=86400"},
        )
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error
    except PdfReaderError as error:
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
    source_day_id: str | None = None,
) -> PdfAnnotationCollectionResponse:
    try:
        result = collect_resource_pdf_annotations(
            connection,
            resource_id,
            source_day_id=source_day_id,
        )
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
            color_palette=[
                {
                    "key": entry.key,
                    "rgb": entry.rgb,
                    "count": entry.count,
                    "annotation_kinds": list(entry.annotation_kinds),
                    "role": entry.role,
                    "suggested_role": entry.suggested_role,
                }
                for entry in result.color_palette
            ],
            requires_color_roles=result.requires_color_roles,
        )
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error
    except PdfAnnotationError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(error),
        ) from error


@router.put(
    "/resources/{resource_id}/pdf-annotations/color-roles",
    response_model=DrawboardColorRolesResponse,
)
def update_resource_drawboard_color_roles(
    resource_id: str,
    command: DrawboardColorRolesCommand,
    connection: Database,
) -> DrawboardColorRolesResponse:
    try:
        roles = save_drawboard_color_roles(
            connection,
            resource_id,
            dict(command.roles),
        )
        return DrawboardColorRolesResponse(
            resource_id=resource_id,
            roles=roles,
        )
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error
    except PdfAnnotationError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(error),
        ) from error


@router.post(
    "/tasks/{task_id}/exercise-screenshots",
    response_model=ExerciseScreenshotResponse,
)
def prepare_task_exercise_screenshots(
    task_id: str,
    connection: Database,
) -> ExerciseScreenshotResponse:
    try:
        bundle = prepare_exercise_solution_screenshots(connection, task_id)
        return ExerciseScreenshotResponse(
            directory=bundle.directory,
            available_exercises=bundle.available_exercises,
            exercises=bundle.exercises,
            screenshots=[
                ExerciseScreenshotItem(
                    exercise=item.exercise,
                    name=item.name,
                    page=item.page,
                    path=item.path,
                )
                for item in bundle.screenshots
            ],
            warnings=bundle.warnings,
        )
    except (
        ExerciseSolutionError,
        workspace_repository.WorkspaceRepositoryError,
    ) as error:
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
    return FileResponse(
        path,
        media_type="image/png",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
        },
    )


def _toggl_status_response(
    connection: Connection,
    payload: dict[str, Any],
) -> TogglStatusResponse:
    current = payload.get("current")
    if isinstance(current, dict):
        current["task_id"] = workspace_repository.toggl_task_id(
            connection,
            str(current.get("id") or ""),
        )
    payload["tasks"] = workspace_repository.toggl_task_totals(connection)
    return TogglStatusResponse.model_validate(payload)


@router.get("/integrations/toggl", response_model=TogglStatusResponse)
def get_toggl_status(
    connection: Database,
    force: bool = False,
) -> TogglStatusResponse:
    payload = public_status(force=force, include_entries=force)
    entries = payload.pop("_entries", None)
    window_start = payload.pop("_window_start", None)
    if (
        force
        and not payload.get("error")
        and isinstance(entries, list)
        and isinstance(window_start, str)
    ):
        workspace_repository.reconcile_toggl_entries(
            connection,
            entries,
            window_start=window_start,
        )
    return _toggl_status_response(connection, payload)


def _toggl_error(error: TogglServiceError) -> HTTPException:
    code = (
        status.HTTP_422_UNPROCESSABLE_ENTITY
        if isinstance(error, TogglConfigurationError)
        else status.HTTP_502_BAD_GATEWAY
    )
    return HTTPException(status_code=code, detail=str(error))


@router.post("/integrations/toggl/start", response_model=TogglStatusResponse)
def start_toggl(
    command: TogglStartCommand,
    connection: Database,
) -> TogglStatusResponse:
    try:
        workspace_repository.validate_toggl_scope(
            connection,
            course_id=command.course_id,
            day_id=command.day_id,
            task_id=command.task_id,
        )
        payload = start(command.description)
        current = payload.get("current")
        if isinstance(current, dict):
            workspace_repository.record_toggl_start(
                connection,
                course_id=command.course_id,
                day_id=command.day_id,
                task_id=command.task_id,
                external_id=str(current.get("id") or ""),
                description=str(current.get("description") or command.description),
                started_at=str(current.get("start") or ""),
            )
        return _toggl_status_response(connection, payload)
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error
    except TogglServiceError as error:
        raise _toggl_error(error) from error


@router.post("/integrations/toggl/stop", response_model=TogglStatusResponse)
def stop_toggl(connection: Database) -> TogglStatusResponse:
    try:
        payload = stop()
        workspace_repository.record_toggl_stop(connection)
        return _toggl_status_response(connection, payload)
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


@router.patch(
    "/resources/{resource_id}/chapters/{chapter_number}",
    response_model=MutationResponse,
)
def update_resource_chapter_progress(
    resource_id: str,
    chapter_number: int,
    command: ResourceChapterProgressCommand,
    connection: Database,
) -> MutationResponse:
    try:
        return workspace_repository.update_resource_chapter_progress(
            connection,
            resource_id,
            chapter_number,
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


@router.delete("/notes/{note_id}", response_model=MutationResponse)
def delete_note(
    note_id: str,
    command: NoteDeleteCommand,
    connection: Database,
) -> MutationResponse:
    try:
        return workspace_repository.delete_note(connection, note_id, command)
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error


@router.post("/prompt-batches", response_model=PromptBatchCreateResponse)
def create_prompt_batch(
    command: PromptBatchCreateCommand,
    connection: Database,
) -> PromptBatchCreateResponse:
    try:
        return create_prompt_batch_with_attachments(connection, command)
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error
    except PromptAttachmentError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(error),
        ) from error


def _prompt_job_response(job: Any) -> PromptBatchJobResponse:
    return PromptBatchJobResponse(
        job_id=job.id,
        status=job.status,
        progress=job.progress,
        stage=job.stage,
        result=job.result,
        error=job.error,
    )


@router.post(
    "/prompt-batches/jobs",
    response_model=PromptBatchJobResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def start_prompt_batch_preparation(
    command: PromptBatchCreateCommand,
) -> PromptBatchJobResponse:
    return _prompt_job_response(start_prompt_batch_job(command))


@router.get(
    "/prompt-batches/jobs/{job_id}",
    response_model=PromptBatchJobResponse,
)
def prompt_batch_preparation_status(job_id: str) -> PromptBatchJobResponse:
    job = get_prompt_batch_job(job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Prompt preparation job not found.",
        )
    return _prompt_job_response(job)


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


@router.post(
    "/discussion-messages/{message_id}/review",
    response_model=MutationResponse,
)
def review_discussion_message(
    message_id: str,
    command: DiscussionMessageReviewCommand,
    connection: Database,
) -> MutationResponse:
    try:
        return workspace_repository.review_discussion_message(
            connection,
            message_id,
            command,
        )
    except workspace_repository.WorkspaceRepositoryError as error:
        raise _translate_repository_error(error) from error


@router.delete(
    "/discussion-messages/{message_id}/answer",
    response_model=MutationResponse,
)
def delete_discussion_answer(
    message_id: str,
    command: DiscussionAnswerDeleteCommand,
    connection: Database,
) -> MutationResponse:
    try:
        return workspace_repository.delete_discussion_answer(
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
