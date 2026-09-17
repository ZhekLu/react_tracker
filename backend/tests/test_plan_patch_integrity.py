import sqlite3
from pathlib import Path

import pytest
from sqlalchemy import text
from test_study_plan_sync import _full_plan, isolated_database  # noqa: F401

from tracker_api.config import get_settings
from tracker_api.database import transaction
from tracker_api.repositories.workspace_repository import get_workspace, upsert_note
from tracker_api.schemas.workspace import NoteUpsertCommand
from tracker_api.services import study_plan_service as service
from tracker_api.services.study_plan_parser import parse_study_plan


def snapshot(path: Path | None = None) -> str:
    with sqlite3.connect(path or get_settings().database_path) as database:
        # Include physical FTS shadow tables; querying an external-content
        # virtual table is not a reliable way to snapshot its stored rows.
        tables = database.execute(
            "SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
        result = []
        for name, schema in tables:
            if schema and not schema.startswith("CREATE VIRTUAL TABLE"):
                escaped = name.replace('"', '""')
                result.append(
                    (
                        schema,
                        sorted(repr(row) for row in database.execute(f'SELECT * FROM "{escaped}"')),
                    )
                )
        return repr(result)


def patch(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "patch.md"
    path.write_text(
        '+++\nformat = "study-plan/v1"\nid = "native_course"\nmode = "patch"\n+++\n\n'
        "### Day 1: 2026-07-01 - Foundations {#day-01}\n\n#### Tasks\n\n" + body
    )
    return path


def seed(tmp_path: Path) -> str:
    path = tmp_path / "full.md"
    path.write_text(_full_plan())
    return service.sync_study_plan(path).course_id


def task_id() -> str:
    with transaction() as connection:
        return str(
            connection.execute(
                text(
                    "SELECT entity_id FROM source_bindings "
                    "WHERE source_key='native_course:read-book' AND entity_type='task' LIMIT 1"
                )
            ).scalar_one()
        )


NOTE = r"""## A formula

Keep  these spaces and $Q_\theta$.

$$
\begin{matrix}a\\b\end{matrix}
$$

```md
### Day 99: Example {#fake-day}
- [ ] Not a task. {#fake-task}
:::
```
""".rstrip("\n")


def note_patch(tmp_path: Path, note: str = NOTE, title: str = "Read") -> Path:
    return patch(
        tmp_path, f"- [ ] {title}. {{#read-book}}\n\n::: task-note {{#read-book}}\n{note}\n:::\n"
    )


def test_multiline_notes_are_literal_and_link_to_real_tasks(tmp_path: Path) -> None:
    course_id = seed(tmp_path)
    path = note_patch(tmp_path)
    parsed = parse_study_plan(path).require_plan()
    assert len(parsed.days) == 1
    assert len(parsed.days[0].sections[0].tasks) == 1
    assert parsed.days[0].sections[0].tasks[0].note_markdown == NOTE
    service.sync_study_plan(path)
    with transaction() as connection:
        workspace = get_workspace(connection, course_id)
        task = next(
            t
            for day in workspace.days
            for section in day.sections
            for t in section.tasks
            if t.id == task_id()
        )
        assert task.notes[0].kind == "task"
        assert task.notes[0].document.markdown == NOTE


@pytest.mark.parametrize(
    ("body", "code"),
    [
        ("::: task-note {#missing}\nText\n:::\n", "unknown_task_note"),
        ("- [ ] Read {#read-book}\n::: task-note {#read-book}\nText", "unclosed_task_note"),
        (
            "- [ ] Read {#read-book}\n::: task-note {#read-book}\nA\n:::\n"
            "::: task-note {#read-book}\nB\n:::\n",
            "duplicate_task_note",
        ),
        ("- [ ] Read {#read-book minuts=15}", "unknown_attribute"),
        ("- [ ] Read {#read-book minutes=-1}", "invalid_minutes"),
        ("- [ ] Read {#read-book minutes=1 minutes=2}", "duplicate_attribute"),
        ("- [ ] Read {#read-book optional=maybe}", "invalid_boolean"),
        ("- [ ] Read {#read-book minutes=20", "invalid_attributes"),
    ],
)
def test_invalid_authoring_is_rejected_without_database_changes(
    tmp_path: Path, body: str, code: str
) -> None:
    seed(tmp_path)
    path = patch(tmp_path, body)
    before = snapshot()
    assert code in {diagnostic.code for diagnostic in parse_study_plan(path).errors}
    with pytest.raises(service.StudyPlanSyncError):
        service.sync_study_plan(path)
    assert snapshot() == before


def test_preview_and_constraint_failure_roll_back_every_table(tmp_path: Path) -> None:
    seed(tmp_path)
    before = snapshot()
    result = service.sync_study_plan(note_patch(tmp_path), dry_run=True, backup=True)
    assert result.dry_run and result.backup_path is None
    assert result.counts["task_notes_created"] == 1
    assert snapshot() == before
    # An unmentioned sibling already occupies task order 2.
    path = patch(tmp_path, "- [>] Move into occupied slot. {#read-book order=2}")
    with pytest.raises(service.StudyPlanSyncError, match="rolled back"):
        service.sync_study_plan(path)
    assert snapshot() == before


def test_exception_after_writes_restores_documents_bindings_and_progress(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    seed(tmp_path)
    before = snapshot()
    original = service._sync_task

    def fail_after_write(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("Injected storage failure")

    monkeypatch.setattr(service, "_sync_task", fail_after_write)
    with pytest.raises(RuntimeError, match="Injected"):
        service.sync_study_plan(note_patch(tmp_path))
    assert snapshot() == before


def test_note_conflicts_abort_patch_but_unchanged_source_preserves_editor_work(
    tmp_path: Path,
) -> None:
    course_id = seed(tmp_path)
    path = note_patch(tmp_path)
    service.sync_study_plan(path)
    with transaction() as connection:
        note = get_workspace(connection, course_id).notes[0]
        upsert_note(
            connection,
            NoteUpsertCommand(
                course_id=course_id,
                entity_type="task",
                entity_id=task_id(),
                kind="task",
                note_id=note.id,
                note_revision=note.revision,
                document_revision=note.document.revision,
                markdown=NOTE + "\n\nMy own explanation.",
            ),
        )
    service.sync_study_plan(path)
    with transaction() as connection:
        assert (
            get_workspace(connection, course_id)
            .notes[0]
            .document.markdown.endswith("My own explanation.")
        )
    before = snapshot()
    with pytest.raises(service.StudyPlanSyncError, match="Merge"):
        service.sync_study_plan(note_patch(tmp_path, "Replacement", "Changed task title"))
    assert snapshot() == before


def test_note_updates_use_revisions_and_omission_does_not_clear_it(tmp_path: Path) -> None:
    course_id = seed(tmp_path)
    service.sync_study_plan(note_patch(tmp_path))
    service.sync_study_plan(note_patch(tmp_path, "Updated $Q_\\theta$"))
    service.sync_study_plan(patch(tmp_path, "- [ ] Read again. {#read-book}"))
    with transaction() as connection:
        note = get_workspace(connection, course_id).notes[0]
        assert note.document.markdown == "Updated $Q_\\theta$"
        assert note.document.revision == 2
        assert (
            connection.execute(
                text("SELECT count(*) FROM document_revisions WHERE document_id=:id"),
                {"id": note.document.id},
            ).scalar_one()
            == 2
        )


def test_reapplying_cancellation_preserves_subsequent_progress_and_metadata(tmp_path: Path) -> None:
    seed(tmp_path)
    path = patch(tmp_path, "- [-] Cancel reading. {#read-book optional type=review minutes=120}")
    service.sync_study_plan(path)
    with transaction() as connection:
        connection.execute(text("UPDATE tasks SET status='todo' WHERE id=:id"), {"id": task_id()})
    service.sync_study_plan(path)
    with transaction() as connection:
        assert (
            connection.execute(
                text("SELECT status FROM tasks WHERE id=:id"), {"id": task_id()}
            ).scalar_one()
            == "todo"
        )
        connection.execute(text("UPDATE tasks SET status='done' WHERE id=:id"), {"id": task_id()})
    # Even a newly authored checkbox cancellation cannot silently undo completion.
    path = patch(tmp_path, "- [-] Old cancelled title. {#read-book}")
    service.sync_study_plan(path)
    with transaction() as connection:
        assert tuple(
            connection.execute(
                text(
                    "SELECT status,is_optional,task_type,estimated_minutes FROM tasks WHERE id=:id"
                ),
                {"id": task_id()},
            ).one()
        ) == ("done", 1, "review", 120)


def test_explicit_order_swap_and_backup_are_safe(tmp_path: Path) -> None:
    seed(tmp_path)
    before = snapshot()
    result = service.sync_study_plan(
        patch(tmp_path, "- [ ] Read. {#read-book order=2}\n- [ ] Write. {#write-summary order=1}"),
        backup=True,
    )
    assert result.backup_path and snapshot(Path(result.backup_path)) == before
    with transaction() as connection:
        assert (
            connection.execute(
                text("SELECT order_index FROM tasks WHERE id=:id"), {"id": task_id()}
            ).scalar_one()
            == 1002
        )


def test_patch_does_not_run_unapplied_migrations(tmp_path: Path) -> None:
    seed(tmp_path)
    with transaction() as connection:
        connection.execute(
            text(
                "DELETE FROM schema_migrations "
                "WHERE version=(SELECT max(version) FROM schema_migrations)"
            )
        )
    before = snapshot()
    with pytest.raises(service.StudyPlanSyncError, match="schema"):
        service.sync_study_plan(note_patch(tmp_path))
    assert snapshot() == before


def test_patch_preserves_omitted_date_skills_and_replayed_explicit_status(tmp_path: Path) -> None:
    seed(tmp_path)
    path = patch(tmp_path, "- [ ] Read. {#read-book status=skipped}")
    path.write_text(path.read_text().replace("2026-07-01 - Foundations", "Foundations"))
    service.sync_study_plan(path)
    with transaction() as connection:
        connection.execute(
            text("UPDATE tasks SET status='in_progress' WHERE id=:id"), {"id": task_id()}
        )
    service.sync_study_plan(path)
    with transaction() as connection:
        assert connection.execute(text("SELECT date FROM study_days")).scalar_one() == "2026-07-01"
        assert (
            connection.execute(
                text("SELECT status FROM tasks WHERE id=:id"), {"id": task_id()}
            ).scalar_one()
            == "in_progress"
        )
        assert connection.execute(text("SELECT count(*) FROM day_skills")).scalar_one() == 1


def test_unknown_day_id_cannot_alias_an_existing_number(tmp_path: Path) -> None:
    seed(tmp_path)
    path = patch(tmp_path, "- [ ] Read. {#read-book}")
    path.write_text(path.read_text().replace("#day-01", "#wrong-day"))
    before = snapshot()
    with pytest.raises(service.StudyPlanSyncError, match="Unknown day ID"):
        service.sync_study_plan(path)
    assert snapshot() == before
