from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import text

from tracker_api.config import get_settings
from tracker_api.database import get_engine, transaction
from tracker_api.repositories.workspace_repository import (
    create_annotation,
    create_prompt_batch,
    resource_content_target,
    update_resource_progress,
)
from tracker_api.schemas.workspace import (
    AnnotationAnchorCreate,
    AnnotationCreateCommand,
    PromptBatchCreateCommand,
    ResourceProgressCommand,
)
from tracker_api.services.resource_content_service import read_resource_content
from tracker_api.services.study_plan_service import sync_study_plan


@pytest.fixture(autouse=True)
def isolated_database(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[None]:
    helper_config = tmp_path / "toggl_config.json"
    helper_config.write_text(
        f'{{"open_allowed_roots": ["{tmp_path}"]}}',
        encoding="utf-8",
    )
    monkeypatch.setenv("TRACKER_DATABASE_PATH", str(tmp_path / "tracker.db"))
    monkeypatch.setenv("TRACKER_HELPER_CONFIG_PATH", str(helper_config))
    get_settings.cache_clear()
    get_engine.cache_clear()
    yield
    if get_engine.cache_info().currsize:
        get_engine().dispose()
    get_engine.cache_clear()
    get_settings.cache_clear()


def _seed_course(tmp_path: Path) -> tuple[str, str]:
    (tmp_path / "paper.txt").write_text(
        "Coverage assumption\n\nWhy it matters.",
        encoding="utf-8",
    )
    plan_path = tmp_path / "plan.md"
    plan_path.write_text(
        """
+++
format = "study-plan/v1"
id = "mutation_course"
title = "Mutation Course"
mode = "full"

[resources.paper]
title = "Paper"
path = "paper.txt"
kind = "paper"
+++

# Mutation Course

### Day 1: 2026-07-01 - Read {#day-01}

#### Reading

- [ ] Read the paper. {#read-paper resources=paper}

Stop when: the paper is read. {#day01-stop}
""".lstrip(),
        encoding="utf-8",
    )
    result = sync_study_plan(plan_path)
    with transaction() as connection:
        resource_id = connection.execute(
            text(
                """
                SELECT entity_id
                FROM source_bindings
                WHERE entity_type = 'resource'
                  AND source_key = 'mutation_course:paper'
                LIMIT 1
                """
            )
        ).scalar_one()
    return result.course_id, str(resource_id)


def test_pdf_annotation_import_is_idempotent_and_prompt_snapshot_is_saved(
    tmp_path: Path,
) -> None:
    course_id, resource_id = _seed_course(tmp_path)
    command = AnnotationCreateCommand(
        resource_id=resource_id,
        kind="question",
        origin="pdf_import",
        external_id="pdf-fingerprint",
        source_fingerprint="pdf-fingerprint",
        markdown="Why is this assumption needed?",
        plain_text="Why is this assumption needed?",
        anchor=AnnotationAnchorCreate(
            anchor_type="pdf_rect",
            quote="Coverage assumption",
            page_number=7,
            rect=[10.0, 20.0, 30.0, 40.0],
            color="red",
            annotation_kind="Highlight",
        ),
    )
    with transaction() as connection:
        first = create_annotation(connection, command)
        second = create_annotation(connection, command)
        prompt = create_prompt_batch(
            connection,
            PromptBatchCreateCommand(
                course_id=course_id,
                title="Question batch",
                source_scope="course_questions",
                markdown="# Questions\n\nWhy is this assumption needed?",
                annotation_ids=[first.id],
            ),
        )

    assert second.id == first.id
    with transaction() as connection:
        annotation_count = connection.execute(
            text(
                """
                SELECT COUNT(*)
                FROM annotations
                WHERE resource_id = :resource_id
                  AND source_fingerprint = 'pdf-fingerprint'
                """
            ),
            {"resource_id": resource_id},
        ).scalar_one()
        prompt_item = connection.execute(
            text(
                """
                SELECT question_label, quote_snapshot, question_snapshot_markdown
                FROM prompt_batch_items
                WHERE prompt_batch_id = :prompt_batch_id
                """
            ),
            {"prompt_batch_id": prompt.id},
        ).mappings().one()
    assert annotation_count == 1
    assert prompt_item["question_label"] == "Q-001"
    assert prompt_item["quote_snapshot"] == "Coverage assumption"
    assert prompt_item["question_snapshot_markdown"] == (
        "Why is this assumption needed?"
    )


def test_reader_content_and_progress_are_persisted(tmp_path: Path) -> None:
    _course_id, resource_id = _seed_course(tmp_path)
    with transaction() as connection:
        _title, _version_id, local_path = resource_content_target(
            connection,
            resource_id,
        )
        first = update_resource_progress(
            connection,
            resource_id,
            ResourceProgressCommand(progress_percent=35, position={"scrollTop": 100}),
        )
        second = update_resource_progress(
            connection,
            resource_id,
            ResourceProgressCommand(progress_percent=72, position={"scrollTop": 300}),
        )

    assert local_path is not None
    content = read_resource_content(local_path)
    assert content.format == "text"
    assert "Coverage assumption" in content.content
    assert first.id == second.id
    assert second.revision == 2
    with transaction() as connection:
        row = connection.execute(
            text(
                """
                SELECT progress_percent, position_json
                FROM resource_reading_progress
                WHERE id = :id
                """
            ),
            {"id": second.id},
        ).mappings().one()
    assert row["progress_percent"] == 72
    assert '"scrollTop":300' in row["position_json"]
