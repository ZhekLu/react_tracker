from __future__ import annotations

from pathlib import Path

from tracker_api.services.study_plan_parser import parse_study_plan


def test_parser_reads_native_plan_and_references(tmp_path: Path) -> None:
    plan_path = tmp_path / "plan.md"
    plan_path.write_text(
        """
+++
format = "study-plan/v1"
id = "test_course"
title = "Test Course"
mode = "full"

[resources.book]
title = "The Book"
url = "https://example.org/book"
kind = "book"

[skills.foundation]
name = "Foundation"
+++

# Test Course

### Day 1: 2026-07-01 - Foundations {#day-01 skills=foundation}

Purpose: learn the foundation.

#### Reading

- [ ] Read the book. {#read-book type=reading minutes=30 resources=book skills=foundation}

Stop when: the vocabulary is clear. {#day01-stop}
""".lstrip(),
        encoding="utf-8",
    )

    result = parse_study_plan(plan_path)

    assert result.errors == []
    plan = result.require_plan()
    assert plan.plan_id == "test_course"
    assert plan.days[0].key == "day-01"
    assert plan.days[0].sections[0].tasks[0].key == "read-book"
    assert plan.days[0].sections[0].tasks[0].resource_keys == ("book",)
    assert plan.days[0].sections[0].tasks[0].skill_keys == ("foundation",)
    assert len(plan.days[0].sections) == 2


def test_patch_requires_explicit_day_and_task_ids(tmp_path: Path) -> None:
    plan_path = tmp_path / "patch.md"
    plan_path.write_text(
        """
+++
format = "study-plan/v1"
id = "test_course"
mode = "patch"
+++

### Day 1: 2026-07-01 - Changed

#### Tasks

- [ ] Changed task
""".lstrip(),
        encoding="utf-8",
    )

    result = parse_study_plan(plan_path)

    assert {item.code for item in result.errors} == {
        "patch_requires_day_id",
        "patch_requires_task_id",
    }


def test_parser_rejects_unknown_resource_and_duplicate_task_id(tmp_path: Path) -> None:
    plan_path = tmp_path / "invalid.md"
    plan_path.write_text(
        """
+++
format = "study-plan/v1"
id = "test_course"
mode = "full"
+++

### Day 1: 2026-07-01 - Changed {#day-01}

#### Tasks

- [ ] First. {#same-id resources=missing}
- [ ] Second. {#same-id}
""".lstrip(),
        encoding="utf-8",
    )

    result = parse_study_plan(plan_path)

    assert {item.code for item in result.errors} == {
        "duplicate_task_id",
        "unknown_resource",
    }

