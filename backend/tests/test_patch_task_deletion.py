from pathlib import Path
import re

import pytest
from sqlalchemy import text
from test_plan_patch_integrity import patch, seed, snapshot, task_id
from test_study_plan_sync import _full_plan, isolated_database  # noqa: F401
from test_task_admin import state

from tracker_api.database import transaction
from tracker_api.services.study_plan_parser import parse_study_plan
from tracker_api.services.study_plan_service import StudyPlanSyncError, sync_study_plan


def test_delete_preview_apply_replay_and_no_resurrection(tmp_path):
    seed(tmp_path)
    id = task_id()
    path = patch(tmp_path, "- [ ] Duplicate task {#read-book delete=true}")
    before = snapshot()
    preview = sync_study_plan(path, dry_run=True)
    assert preview.counts["tasks_deleted"] == 1 and preview.backup_path is None
    assert snapshot() == before
    result = sync_study_plan(path)
    assert result.backup_path and Path(result.backup_path).is_file()
    assert state(id)["removed_at"]
    with transaction() as db:
        event = db.execute(text("SELECT backup_path FROM task_admin_events")).scalar_one()
        assert event == result.backup_path
    assert sync_study_plan(path).counts["tasks_deleted"] == 0
    with transaction() as db:
        assert db.execute(text("SELECT count(*) FROM task_admin_events")).scalar_one() == 1
    with pytest.raises(StudyPlanSyncError, match="deleted in Administration"):
        sync_study_plan(patch(tmp_path, "- [ ] Accidentally recreate {#read-book}"))


@pytest.mark.parametrize("suffix", [
    "minutes=5", "status=todo", "optional=true", "resources=book",
])
def test_delete_cannot_hide_other_edits(tmp_path, suffix):
    path = patch(tmp_path, f"- [ ] Task {{#read-book delete=true {suffix}}}")
    assert "unsafe_task_delete" in [error.code for error in parse_study_plan(path).errors]


def test_unknown_delete_rolls_back_other_task_edits(tmp_path):
    seed(tmp_path)
    before = snapshot()
    with pytest.raises(StudyPlanSyncError, match="existing task"):
        sync_study_plan(patch(tmp_path,
            "- [ ] Rename real task {#read-book}\n- [ ] Missing {#typo delete=true}"))
    assert snapshot() == before


def test_full_plan_delete_is_rejected(tmp_path):
    path = tmp_path / "full.md"
    path.write_text(_full_plan().replace("#write-summary", "#write-summary delete=true"))
    assert "unsafe_task_delete" in [error.code for error in parse_study_plan(path).errors]


def test_delete_with_note_and_invalid_boolean_are_rejected(tmp_path):
    path = patch(tmp_path, "- [ ] Task {#read-book delete=true}\n"
                 "::: task-note {#read-book}\nPreserve this\n:::\n")
    assert "unsafe_task_delete" in [error.code for error in parse_study_plan(path).errors]
    path = patch(tmp_path, "- [ ] Task {#read-book delete=maybe}")
    assert "invalid_delete" in [error.code for error in parse_study_plan(path).errors]


def test_empty_resource_attribute_detaches_without_deleting_resource(tmp_path):
    seed(tmp_path)
    id = task_id()
    resource = state(id)["resource_ids"][0]
    sync_study_plan(patch(tmp_path, '- [ ] Read the book {#read-book resources=""}'))
    assert state(id)["resource_ids"] == []
    with transaction() as db:
        assert db.execute(text("SELECT deleted_at FROM resources WHERE id=:id"),
                          {"id": resource}).scalar_one() is None


def test_real_ids_from_ui_update_existing_structure_without_duplicates(tmp_path):
    seed(tmp_path)
    id = task_id()
    task = state(id)
    path = tmp_path / "ids.md"
    path.write_text(f'''+++
format = "study-plan/v1"
id = "native_course"
mode = "patch"
+++
### Day 1: Foundations {{#{task['day_id']}}}
#### New section title {{#{task['section_id']}}}
- [ ] New task title {{#{id}}}
''')
    with transaction() as db:
        counts = [db.execute(text(f"SELECT count(*) FROM {table}")).scalar_one()
                  for table in ["tasks", "study_days", "day_sections"]]
    sync_study_plan(path)
    assert state(id)["title"] == "New task title"
    assert state(id)["section_title"] == "New section title"
    with transaction() as db:
        assert counts == [db.execute(text(f"SELECT count(*) FROM {table}")).scalar_one()
                          for table in ["tasks", "study_days", "day_sections"]]


def test_complete_reference_examples_parse(tmp_path):
    guide = Path(__file__).resolve().parents[2] / "docs" / "plan-patching.md"
    examples = re.findall(r"```md\n(\+\+\+\n.*?)(?=\n```)", guide.read_text(), re.S)
    assert len(examples) == 2
    for index, example in enumerate(examples):
        path = tmp_path / f"example-{index}.md"
        path.write_text(example)
        assert not parse_study_plan(path).errors
