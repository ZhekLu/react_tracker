from __future__ import annotations

from sqlalchemy.engine import Connection

from ..repositories import workspace_repository
from ..schemas.workspace import (
    PromptAttachmentItem,
    PromptBatchCreateCommand,
    PromptBatchCreateResponse,
)
from .prompt_attachment_service import prepare_prompt_attachments


def create_prompt_batch(
    connection: Connection,
    command: PromptBatchCreateCommand,
) -> PromptBatchCreateResponse:
    """Prepare ephemeral files, persist the exact copied prompt, and return both."""

    bundle = prepare_prompt_attachments(connection, command)
    persisted_command = command.model_copy(
        update={
            "markdown": bundle.markdown,
            "plain_text": bundle.markdown,
        }
    )
    result = workspace_repository.create_prompt_batch(connection, persisted_command)
    return PromptBatchCreateResponse(
        id=result.id,
        revision=result.revision,
        updated_at=result.updated_at,
        markdown=bundle.markdown,
        attachment_directory=bundle.directory,
        attachments=[
            PromptAttachmentItem(
                name=item.name,
                kind=item.kind,
                path=item.path,
                resource_id=item.resource_id,
                annotation_id=item.annotation_id,
                question_label=item.question_label,
            )
            for item in bundle.attachments
        ],
        warnings=bundle.warnings,
    )
