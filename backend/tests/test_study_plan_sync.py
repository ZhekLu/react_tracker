from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import text

from tracker_api.config import get_settings
from tracker_api.database import get_engine, transaction
from tracker_api.services.study_plan_service import sync_study_plan


@pytest.fixture(autouse=True)
def isolated_database(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[None]:
    database_path = tmp_path / "tracker.db"
    monkeypatch.setenv("TRACKER_DATABASE_PATH", str(database_path))
    get_settings.cache_clear()
    get_engine.cache_clear()
    yield
    if get_engine.cache_info().currsize:
        get_engine().dispose()
    get_engine.cache_clear()
    get_settings.cache_clear()


def _full_plan(second_task: bool = True, first_title: str = "Read the book") -> str:
    second = (
        "\n- [ ] Write a summary. "
        "{#write-summary type=write minutes=30 skills=foundation}"
        if second_task
        else ""
    )
    return f"""
+++
format = "study-plan/v1"
id = "native_course"
title = "Native Course"
short_code = "NATIVE"
mode = "full"

[resources.book]
title = "The Book"
url = "https://example.org/book"
kind = "book"

[skills.foundation]
name = "Foundation"
+++

# Native Course

### Day 1: 2026-07-01 - Foundations {{#day-01 skills=foundation}}

#### Tasks

- [ ] {first_title}. {{#read-book type=reading resources=book skills=foundation}}{second}

Stop when: both tasks are clear. {{#day01-stop}}
""".lstrip()


def test_full_sync_creates_course_and_preserves_progress_for_stable_ids(
    tmp_path: Path,
) -> None:
    plan_path = tmp_path / "plan.md"
    plan_path.write_text(_full_plan(), encoding="utf-8")
    first = sync_study_plan(plan_path)

    with transaction() as connection:
        connection.execute(
            text(
                """
                UPDATE tasks
                SET status = 'done'
                WHERE id = (
                  SELECT entity_id
                  FROM source_bindings
                  WHERE entity_type = 'task'
                    AND source_key = 'native_course:read-book'
                  LIMIT 1
                )
                """
            )
        )

    plan_path.write_text(
        _full_plan(first_title="Read chapters one and two"),
        encoding="utf-8",
    )
    second = sync_study_plan(plan_path)

    assert second.course_id == first.course_id
    with transaction() as connection:
        row = connection.execute(
            text(
                """
                SELECT t.title, t.status, t.deleted_at
                FROM tasks t
                JOIN source_bindings sb ON sb.entity_id = t.id
                WHERE sb.entity_type = 'task'
                  AND sb.source_key = 'native_course:read-book'
                LIMIT 1
                """
            )
        ).mappings().one()
    assert row["title"] == "Read chapters one and two"
    assert row["status"] == "done"
    assert row["deleted_at"] is None


def test_full_sync_soft_deletes_removed_task(tmp_path: Path) -> None:
    plan_path = tmp_path / "plan.md"
    plan_path.write_text(_full_plan(), encoding="utf-8")
    sync_study_plan(plan_path)

    plan_path.write_text(_full_plan(second_task=False), encoding="utf-8")
    sync_study_plan(plan_path)

    with transaction() as connection:
        deleted_at = connection.execute(
            text(
                """
                SELECT t.deleted_at
                FROM tasks t
                JOIN source_bindings sb ON sb.entity_id = t.id
                WHERE sb.entity_type = 'task'
                  AND sb.source_key = 'native_course:write-summary'
                LIMIT 1
                """
            )
        ).scalar_one()
    assert deleted_at is not None


def test_full_sync_can_replace_section_and_task_ids_at_the_same_order(
    tmp_path: Path,
) -> None:
    plan_path = tmp_path / "plan.md"
    plan_path.write_text(_full_plan(), encoding="utf-8")
    first = sync_study_plan(plan_path)

    plan_path.write_text(
        _full_plan()
        .replace("#### Tasks", "#### Guided reading")
        .replace("#read-book", "#read-replanned")
        .replace("#write-summary", "#summary-replanned"),
        encoding="utf-8",
    )
    second = sync_study_plan(plan_path)

    assert second.course_id == first.course_id
    with transaction() as connection:
        active_sections = connection.execute(
            text(
                """
                SELECT s.title, s.order_index
                FROM day_sections s
                JOIN study_days d ON d.id = s.day_id
                WHERE d.course_id = :course_id
                  AND s.deleted_at IS NULL
                ORDER BY s.order_index
                """
            ),
            {"course_id": first.course_id},
        ).mappings().all()
        active_tasks = connection.execute(
            text(
                """
                SELECT t.title, t.order_index
                FROM tasks t
                WHERE t.day_id IN (
                  SELECT id FROM study_days WHERE course_id = :course_id
                )
                  AND t.deleted_at IS NULL
                ORDER BY t.order_index
                """
            ),
            {"course_id": first.course_id},
        ).mappings().all()

    assert active_sections[0] == {
        "title": "Guided reading",
        "order_index": 1,
    }
    assert [row["order_index"] for row in active_tasks] == [1_001, 1_002, 2_001]


def test_patch_updates_only_named_task_and_can_set_status(tmp_path: Path) -> None:
    full_path = tmp_path / "plan.md"
    full_path.write_text(_full_plan(), encoding="utf-8")
    sync_study_plan(full_path)

    patch_path = tmp_path / "patch.md"
    patch_path.write_text(
        """
+++
format = "study-plan/v1"
id = "native_course"
mode = "patch"
+++

### Day 1: 2026-07-01 - Foundations {#day-01}

#### Tasks

- [>] Read the revised book chapters. {#read-book minutes=50}
""".lstrip(),
        encoding="utf-8",
    )
    sync_study_plan(patch_path)

    with transaction() as connection:
        rows = connection.execute(
            text(
                """
                SELECT t.title, t.status, t.deleted_at
                FROM tasks t
                JOIN study_days d ON d.id = t.day_id
                WHERE d.course_id = (
                  SELECT id
                  FROM courses
                  WHERE json_extract(settings_json, '$.plan_id') = 'native_course'
                )
                ORDER BY t.title
                """
            )
        ).mappings().all()
    assert any(
        row["title"] == "Read the revised book chapters"
        and row["status"] == "later"
        for row in rows
    )
    assert any(
        row["title"] == "Write a summary" and row["deleted_at"] is None
        for row in rows
    )


def test_sync_persists_registry_description_and_local_file_list(
    tmp_path: Path,
) -> None:
    paper = tmp_path / "paper.pdf"
    supplement = tmp_path / "supplement.pdf"
    paper.touch()
    supplement.touch()
    registry = tmp_path / "registry.json"
    registry.write_text(
        """
{
  "papers": [
    {
      "id": "paper",
      "title": "Registry paper",
      "source": "https://example.org/paper",
      "source_type": "url",
      "reading_level": "CRITICAL",
      "central_question": "What can fail?"
    }
  ]
}
""".strip(),
        encoding="utf-8",
    )
    plan = tmp_path / "plan.md"
    plan.write_text(
        f"""
+++
format = "study-plan/v1"
id = "registry_sync"
mode = "full"
resource_registry = "./registry.json"

[resources.paper]
title = "Paper"
kind = "paper"
path = ["{paper}", "{supplement}"]
+++

### Day 1: Read {{#day-01}}

- [ ] Read the paper. {{#read-paper resources=paper}}
""".lstrip(),
        encoding="utf-8",
    )

    result = sync_study_plan(plan)

    with transaction() as connection:
        row = connection.execute(
            text(
                """
                SELECT d.markdown, r.canonical_url, r.metadata_json
                FROM resources r
                JOIN documents d ON d.id = r.content_document_id
                WHERE r.course_id = :course_id AND r.title = 'Paper'
                """
            ),
            {"course_id": result.course_id},
        ).mappings().one()
    assert "What can fail?" in row["markdown"]
    assert row["canonical_url"] == "https://example.org/paper"
    assert str(paper) in row["metadata_json"]
    assert str(supplement) in row["metadata_json"]
