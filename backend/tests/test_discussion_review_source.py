from pathlib import Path

from sqlalchemy import text
from test_workspace_mutations import _seed_course, isolated_database  # noqa: F401

from tracker_api.database import transaction
from tracker_api.repositories.workspace_repository import (
    create_discussion,
    create_discussion_message,
    delete_discussion_message,
    get_workspace,
    mark_discussion_review_source,
    review_discussion_message,
    review_discussion_qa,
)
from tracker_api.schemas.workspace import (
    DiscussionCreateCommand,
    DiscussionMessageCreateCommand,
    DiscussionMessageDeleteCommand,
    DiscussionMessageReviewCommand,
    DiscussionQaReviewCommand,
    DiscussionReviewItem,
)


def test_standalone_note_review_lifecycle(tmp_path: Path) -> None:
    course_id, resource_id = _seed_course(tmp_path)
    markdown = (
        Path(__file__).parents[2] / "frontend/src/lib/day10TutorNote.raw.fixture.md"
    ).read_text()
    with transaction() as connection:
        discussion = create_discussion(
            connection,
            DiscussionCreateCommand(
                course_id=course_id,
                source_resource_id=resource_id,
            ),
        )
        message = create_discussion_message(
            connection,
            discussion.id,
            DiscussionMessageCreateCommand(
                role="assistant",
                markdown=markdown,
            ),
        )
        source = mark_discussion_review_source(connection, message.id)
        assert mark_discussion_review_source(connection, message.id).id == source.id
        workspace = get_workspace(connection, course_id)
        saved = workspace.discussions[0].messages[0]
        assert saved.body.markdown == markdown
        root = next(
            annotation for annotation in workspace.annotations if annotation.id == source.id
        )
        assert root.origin == "discussion_review_source"
        assert root.status == "open"
        assert root.anchor and root.anchor.discussion_message_id == message.id
        review_discussion_qa(
            connection,
            discussion.id,
            DiscussionQaReviewCommand(
                message_id=message.id,
                section_id=f"{message.id}:unstructured",
                section_fingerprint="source-fingerprint",
                question_ids=[source.id],
            ),
        )
        updated = review_discussion_message(
            connection,
            message.id,
            DiscussionMessageReviewCommand(
                revision=saved.revision,
                document_revision=saved.body.revision,
                markdown=markdown,
                review_items=[
                    DiscussionReviewItem(
                        kind="question",
                        quote="replay does NOT create coverage",
                        markdown="Why does replay not solve coverage?",
                    )
                ],
            ),
        )
        workspace = get_workspace(connection, course_id)
        followup = next(
            a for a in workspace.annotations if a.origin == "discussion_review_followup"
        )
        assert followup.anchor
        assert followup.anchor.metadata["rootQuestionIds"] == [source.id]
        assert followup.anchor.metadata["promptLabel"] == f"{root.stable_label}-F1"
        assert workspace.discussions[0].qa_reviews[0].annotation_id == source.id
        delete_discussion_message(
            connection,
            message.id,
            DiscussionMessageDeleteCommand(
                revision=updated.revision,
            ),
        )
        assert (
            connection.execute(
                text("SELECT deleted_at FROM annotations WHERE id=:id"), {"id": source.id}
            ).scalar_one()
            is not None
        )
        assert not get_workspace(connection, course_id).discussions[0].messages
