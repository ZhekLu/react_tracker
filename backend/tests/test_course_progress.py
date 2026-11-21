from datetime import UTC, datetime

from fastapi.testclient import TestClient
from sqlalchemy import event, text
from test_plan_patch_integrity import seed, snapshot
from test_study_plan_sync import _full_plan, isolated_database  # noqa: F401

from tracker_api.database import transaction
from tracker_api.repositories.workspace_repository import upsert_note
from tracker_api.schemas.workspace import NoteUpsertCommand
from tracker_api.services.course_progress_service import export_course_progress
from tracker_api.services.study_plan_service import sync_study_plan

AS_OF = datetime(2026, 11, 21, 12, 30, tzinfo=UTC)


def identities(db, course):
    resource = db.execute(text("SELECT id FROM resources WHERE course_id=:c LIMIT 1"),
                          {"c": course}).scalar_one()
    tasks = list(db.execute(text("SELECT id FROM tasks ORDER BY order_index")).scalars())
    day = db.execute(text("SELECT id FROM study_days WHERE course_id=:c"),
                     {"c": course}).scalar_one()
    return resource, tasks, day


def annotation(db, resource, id, status="open", postponed=None, skipped=None, metadata=None):
    db.execute(text("""
        INSERT INTO annotations
          (id,resource_id,kind,status,priority,origin,postponed_at,skipped_at,created_at,updated_at)
        VALUES (:id,:r,'question',:status,'normal','manual',:later,:skip,'now','now')
    """), {"id": id, "r": resource, "status": status, "later": postponed, "skip": skipped})
    if metadata:
        db.execute(text("""
            INSERT INTO annotation_anchors
              (annotation_id,anchor_type,selector_json,created_at,updated_at)
            VALUES (:id,'manual',:metadata,'now','now')
        """), {"id": id, "metadata": metadata})


def test_report_counts_logical_questions_and_excludes_study_content(tmp_path):
    course = seed(tmp_path)
    with transaction() as db:
        resource, tasks, day = identities(db, course)
        upsert_note(db, NoteUpsertCommand(course_id=course, entity_type="task", entity_id=tasks[0],
                                         kind="task", markdown="PRIVATE_NOTES_MUST_STAY_PRIVATE"))
        db.execute(text("UPDATE resources SET status='reading' WHERE id=:id"), {"id": resource})
        db.execute(text("""
            INSERT INTO resource_reading_progress
              (id,resource_id,progress_percent,position_type,created_at,updated_at)
            VALUES ('progress',:r,35,'page','now','now')
        """), {"r": resource})
        db.execute(text("""
            INSERT INTO resource_chapter_progress
              (id,resource_id,chapter_number,status,created_at,updated_at)
            VALUES ('chapter',:r,2,'read_partially','now','now')
        """), {"r": resource})
        for id in ["crop-1", "crop-2"]:
            annotation(db, resource, id, metadata='{"questionFrameId":"frame-1"}')
        annotation(db, resource, "answered", status="answered")
        annotation(db, resource, "later", postponed="now")
        annotation(db, resource, "skipped", skipped="now")
        annotation(db, resource, "archived", status="archived")
        annotation(db, resource, "superseded", metadata='{"supersededByAnnotationId":"answered"}')
        db.execute(text("""
            INSERT INTO resources
              (id,course_id,title,kind,format,source_type,status,created_at,updated_at)
            VALUES ('note-resource',:c,'PRIVATE_NOTE_TITLE','note','markdown','generated',
                    'reading','now','now')
        """), {"c": course})
        db.execute(text("UPDATE tasks SET status='done',started_at='2026-11-21T10:00:00Z', "
                        "completed_at='2026-11-21T10:20:00Z' WHERE id=:id"), {"id": tasks[0]})
        db.execute(text("UPDATE tasks SET is_optional=1,estimated_minutes=0 WHERE id=:id"),
                   {"id": tasks[1]})
        db.execute(text("UPDATE study_days SET status='closed' WHERE id=:id"), {"id": day})
        statements = []
        event.listen(db, "before_cursor_execute", lambda _, __, statement, *args:
                     statements.append(statement.lower()))
        result = export_course_progress(db, course, time_zone="Europe/Copenhagen", as_of=AS_OF)
    report = result.markdown
    assert result.filename == "NATIVE-progress-20261121-123000Z.md"
    assert "2026-11-21 13:30 (Europe/Copenhagen)" in report
    assert "Questions: 1 open, 1 answered, 1 later, 1 skipped, 1 archived (5 total)" in report
    assert "| The Book | book | Reading | 35% | 1 | 1 | 1 | 1 | 1 |" in report
    assert "| The Book | 2 | Partially read |" in report
    assert "### 2026-07-01 · Day 1" in report
    assert "Status: Closed" in report
    assert "2026-11-21 11:00 | 2026-11-21 11:20" in report
    assert "(optional) | To do | 0 min" in report
    assert "PRIVATE_NOTE" not in report
    assert all("from documents" not in sql and "from notes" not in sql
               and "discussion_messages" not in sql for sql in statements)


def test_timing_totals_include_running_unassigned_and_removed_task_time(tmp_path):
    course = seed(tmp_path)
    with transaction() as db:
        _, tasks, day = identities(db, course)
        db.execute(text("UPDATE tasks SET deleted_at='now' WHERE id=:id"), {"id": tasks[1]})
        entries = [
            ("override", day, tasks[0], "2026-11-20T23:30:00Z", "2026-11-21T00:00:00Z", 75),
            ("running", day, tasks[0], "2026-11-21T12:20:00Z", None, None),
            ("task-only", None, tasks[0], "2026-11-21T12:29:00Z", "2026-11-21T12:30:00Z", None),
            ("removed-task", day, tasks[1], "2026-11-21T10:00:00Z", "2026-11-21T10:10:00Z", None),
            ("day-only", day, None, "2026-11-21T09:00:00Z", "2026-11-21T09:05:00Z", None),
            ("course-only", None, None, "2026-11-21T08:00:00Z", "2026-11-21T08:02:00Z", None),
        ]
        for id, day_id, task_id, start, stop, override in entries:
            db.execute(text("""
                INSERT INTO time_entries(id,course_id,day_id,task_id,provider,started_at,
                  stopped_at,duration_override_seconds,created_at,updated_at)
                VALUES (:id,:c,:d,:t,'manual',:start,:stop,:override,'now','now')
            """), {"id": id, "c": course, "d": day_id, "t": task_id,
                   "start": start, "stop": stop, "override": override})
    before = snapshot()
    with transaction() as db:
        result = export_course_progress(db, course, time_zone="Europe/Copenhagen", as_of=AS_OF)
    assert snapshot() == before
    assert "Recorded time: 0h 29m 15s across 6 sessions; 1 running" in result.markdown
    assert "Recorded: 0h 27m 15s (5 sessions)" in result.markdown
    assert "Not estimated | 0h 12m 15s" in result.markdown
    assert "Other time on this day (unassigned or removed tasks): 0h 15m 00s" in result.markdown
    assert "Time outside the listed study days: 0h 02m 00s" in result.markdown
    assert "| 2026-11-21 | 0h 29m 15s | 6 | 1 |" in result.markdown
    assert "Write a summary" not in result.markdown


def test_resolved_sibling_and_stable_identity_are_counted_once(tmp_path):
    course = seed(tmp_path)
    with transaction() as db:
        resource, _, _ = identities(db, course)
        annotation(db, resource, "frame-open", metadata='{"questionFrameId":"shared"}')
        annotation(db, resource, "frame-answered", status="answered",
                   metadata='{"questionFrameId":"shared"}')
        db.execute(text("""
            INSERT INTO question_identities(id,course_id,resource_id,resource_code,scope_code,
              ordinal,readable_label,created_at)
            VALUES ('identity',:c,:r,'BOOK','MAIN',1,'BOOK-Q001','now')
        """), {"c": course, "r": resource})
        for id in ["stable-one", "stable-two"]:
            annotation(db, resource, id)
            db.execute(text("INSERT INTO annotation_question_identities "
                            "VALUES (:id,'identity','now')"), {"id": id})
        result = export_course_progress(db, course, as_of=AS_OF)
    expected = "Questions: 1 open, 1 answered, 0 later, 0 skipped, 0 archived (2 total)"
    assert expected in result.markdown


def test_api_scope_empty_data_and_timezone_errors(tmp_path):
    from tracker_api.main import create_app

    course = seed(tmp_path)
    other = tmp_path / "other.md"
    other.write_text(_full_plan().replace('id = "native_course"', 'id = "other_course"')
                     .replace('title = "Native Course"', 'title = "PRIVATE_OTHER_COURSE"'))
    sync_study_plan(other)
    with transaction() as db:
        db.execute(text("UPDATE study_days SET deleted_at='now' WHERE course_id=:c"), {"c": course})
        db.execute(text("UPDATE resources SET deleted_at='now' WHERE course_id=:c"), {"c": course})
    with TestClient(create_app()) as client:
        result = client.get(f"/api/courses/{course}/progress-export")
        assert result.status_code == 200
        assert set(result.json()) == {"filename", "markdown", "exported_at"}
        report = result.json()["markdown"]
        assert "No materials." in report and "No study days." in report
        assert "PRIVATE_OTHER_COURSE" not in report and "The Book" not in report
        assert client.get("/api/courses/missing/progress-export").status_code == 404
        invalid = client.get(f"/api/courses/{course}/progress-export?time_zone=invalid")
        assert invalid.status_code == 422


def test_titles_are_escaped_and_zero_time_is_explicit(tmp_path):
    course = seed(tmp_path)
    with transaction() as db:
        db.execute(text("UPDATE resources SET title='Title | extra\n# heading'"))
        result = export_course_progress(db, course, as_of=AS_OF)
    assert r"Title \| extra \# heading" in result.markdown
    assert "Recorded time: 0h 00m 00s across 0 sessions; 0 running" in result.markdown
