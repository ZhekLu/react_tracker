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


def test_parser_merges_registry_descriptions_and_multiple_local_files(
    tmp_path: Path,
) -> None:
    main_file = tmp_path / "main paper.pdf"
    supplement = tmp_path / "supplement.pdf"
    main_file.touch()
    supplement.touch()
    (tmp_path / "registry.json").write_text(
        """
{
  "format": "paper-registry/v1",
  "papers": [
    {
      "id": "paper",
      "title": "Registry title",
      "authors": ["Ada Researcher"],
      "year": 2026,
      "category": "OPE",
      "source": "https://example.org/paper",
      "source_type": "url",
      "reading_level": "MASTER",
      "central_question": "Can the estimator be trusted?",
      "scheduled_tasks": [{"day": 99}]
    }
  ]
}
""".strip(),
        encoding="utf-8",
    )
    plan_path = tmp_path / "plan.md"
    plan_path.write_text(
        f"""
+++
format = "study-plan/v1"
id = "registry_course"
mode = "full"
resource_registry = "./registry.json"

[resources.paper]
title = "Plan title"
path = ["{main_file}", "{supplement}"]
kind = "paper"
+++

### Day 1: Registry {{#day-01}}

- [ ] Read it. {{#read-paper resources=paper info="Inspect $V^\\\\pi$."}}
""".lstrip(),
        encoding="utf-8",
    )

    result = parse_study_plan(plan_path)

    assert result.errors == []
    resource = result.require_plan().resources[0]
    assert resource.title == "Plan title"
    assert resource.paths == (str(main_file), str(supplement))
    assert resource.url == "https://example.org/paper"
    assert resource.authors == ("Ada Researcher",)
    assert "Can the estimator be trusted?" in resource.description_markdown
    assert "scheduled_tasks" not in resource.metadata
    task = result.require_plan().days[0].sections[0].tasks[0]
    assert task.rationale == r"Inspect $V^\pi$."
