"""A content-free, point-in-time course progress outline."""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from pydantic import BaseModel
from sqlalchemy import Connection, RowMapping, text

from ..repositories.workspace_repository import EntityNotFoundError


class CourseProgressExport(BaseModel):
    filename: str
    markdown: str
    exported_at: str


STATUS = {
    "todo": "To do", "in_progress": "In progress", "done": "Done",
    "later": "Later", "skipped": "Cancelled", "not_started": "Not started",
    "open": "Open", "closed": "Closed", "completed": "Completed",
    "archived": "Archived", "unread": "Unread", "skimmed": "Skimmed",
    "reading": "Reading", "read": "Read", "review": "Read (review)",
    "read_partially": "Partially read", "read_fully": "Read",
}
QUESTION_STATES = ("open", "answered", "later", "skipped", "archived")


def _cell(value: object) -> str:
    # Titles are data, including Markdown punctuation and embedded newlines.
    return re.sub(r"([\\`*_[\]<>#|])", r"\\\1", " ".join(str(value).split()))


def _duration(seconds: int) -> str:
    hours, remainder = divmod(seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours}h {minutes:02}m {seconds:02}s"


def _date(value: object, zone: ZoneInfo) -> str:
    if not value:
        return "—"
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return "Unknown"
    return parsed.replace(tzinfo=parsed.tzinfo or UTC).astimezone(zone).strftime("%Y-%m-%d %H:%M")


def _questions(rows: Iterable[RowMapping]) -> Counter[str]:
    groups: dict[tuple[str, str], set[str]] = defaultdict(set)
    for row in rows:
        identity = row["frame_id"] or row["identity_id"] or row["id"]
        state = str(row["status"])
        if state == "open":
            state = "skipped" if row["skipped_at"] else "later" if row["postponed_at"] else state
        groups[(str(row["resource_id"]), str(identity))].add(state)
    # A resolved capture resolves its logical question; active captures otherwise
    # take priority over deferred/skipped copies. Never count image crops twice.
    precedence = ("archived", "answered", "open", "later", "skipped")
    return Counter(next(state for state in precedence if state in states)
                   for states in groups.values())


def _question_cells(counts: Counter[str]) -> str:
    return " | ".join(str(counts[state]) for state in QUESTION_STATES)


@dataclass
class Timing:
    seconds: int = 0
    sessions: int = 0
    running: int = 0

    def add(self, row: RowMapping) -> None:
        self.seconds += int(row["seconds"])
        self.sessions += 1
        self.running += row["stopped_at"] is None


def export_course_progress(
    connection: Connection, course_id: str, *, time_zone: str = "UTC",
    as_of: datetime | None = None,
) -> CourseProgressExport:
    zone = ZoneInfo(time_zone)
    now = as_of or datetime.now(UTC)
    timestamp = now.astimezone(UTC).isoformat()
    params = {"course": course_id, "at": timestamp}

    def rows(sql: str) -> list[RowMapping]:
        return list(connection.execute(text(sql), params).mappings())

    courses = rows("""
        SELECT title, short_code, status FROM courses
        WHERE id=:course AND deleted_at IS NULL
    """)
    if not courses:
        raise EntityNotFoundError(f"Course does not exist: {course_id}")
    course = courses[0]
    materials = rows("""
        SELECT r.id, r.title, r.kind, r.status,
          (SELECT MAX(p.progress_percent) FROM resource_reading_progress p
           WHERE p.resource_id=r.id) AS progress
        FROM resources r WHERE r.course_id=:course AND r.deleted_at IS NULL
          AND r.kind NOT IN ('discussion', 'exam_question', 'note')
        ORDER BY r.kind, r.title, r.id
    """)
    questions = rows("""
        SELECT a.id, a.resource_id, a.status, a.postponed_at, a.skipped_at,
          aqi.question_identity_id AS identity_id,
          NULLIF(TRIM(json_extract(aa.selector_json, '$.questionFrameId')), '') AS frame_id
        FROM annotations a JOIN resources r ON r.id=a.resource_id
        LEFT JOIN annotation_anchors aa ON aa.annotation_id=a.id
        LEFT JOIN annotation_question_identities aqi ON aqi.annotation_id=a.id
        WHERE r.course_id=:course AND r.deleted_at IS NULL AND a.deleted_at IS NULL
          AND (a.kind IN ('question', 'todo') OR aqi.question_identity_id IS NOT NULL)
          AND NOT EXISTS (
            SELECT 1 FROM annotations replacement
            WHERE replacement.id=json_extract(aa.selector_json, '$.supersededByAnnotationId')
              AND replacement.id != a.id AND replacement.resource_id=a.resource_id
              AND replacement.deleted_at IS NULL
          )
    """)
    days = rows("""
        SELECT id, number, date, title, status, opened_at, closed_at, completed_at
        FROM study_days WHERE course_id=:course AND deleted_at IS NULL
        ORDER BY date IS NULL, date, order_index
    """)
    tasks = rows("""
        SELECT t.id, t.day_id, t.title, t.status, t.is_optional, t.estimated_minutes,
          t.started_at, t.completed_at, s.title AS section
        FROM tasks t JOIN study_days d ON d.id=t.day_id
        LEFT JOIN day_sections s ON s.id=t.section_id AND s.deleted_at IS NULL
        WHERE d.course_id=:course AND d.deleted_at IS NULL AND t.deleted_at IS NULL
        ORDER BY d.order_index, s.order_index, t.order_index
    """)
    entries = rows("""
        SELECT day_id, task_id, started_at, stopped_at,
          MAX(0, COALESCE(duration_override_seconds,
            CAST(strftime('%s', COALESCE(stopped_at, :at))
              - strftime('%s', started_at) AS INTEGER), 0)) AS seconds
        FROM time_entries WHERE course_id=:course ORDER BY started_at, id
    """)
    total = Timing()
    task_days = {task["id"]: task["day_id"] for task in tasks}
    by_day: dict[str, Timing] = defaultdict(Timing)
    by_task: dict[str, Timing] = defaultdict(Timing)
    by_date: dict[str, Timing] = defaultdict(Timing)
    for entry in entries:
        total.add(entry)
        day_id = entry["day_id"] or task_days.get(entry["task_id"])
        by_day[str(day_id)].add(entry)
        if task_days.get(entry["task_id"]) == day_id and entry["task_id"] in task_days:
            by_task[str(entry["task_id"])].add(entry)
        by_date[_date(entry["started_at"], zone).split(" ")[0]].add(entry)
    counts = _questions(questions)
    task_counts = Counter(str(task["status"]) for task in tasks)
    read = sum(material["status"] in {"read", "review"} for material in materials)
    lines = [
        f"# Course progress — {_cell(course['title'])}", "",
        f"Course: {_cell(course['short_code'])} · Status: {_cell(course['status'])}",
        f"Exported: {_date(timestamp, zone)} ({_cell(time_zone)})", "",
        "## Overview", "",
        f"- Materials: {read}/{len(materials)} read (including read/review).",
        f"- Tasks: {task_counts['done']}/{len(tasks)} done; "
        + "; ".join(f"{task_counts[state]} {STATUS[state].lower()}"
                    for state in ("in_progress", "todo", "later", "skipped")) + ".",
        "- Questions: " + ", ".join(f"{counts[state]} {state}" for state in QUESTION_STATES)
        + f" ({sum(counts.values())} total).",
        f"- Recorded time: {_duration(total.seconds)} across {total.sessions} sessions; "
        f"{total.running} running.", "",
        "Question counts use logical questions (including tracked to-dos), not image crops. "
        "Open/answered reflect saved status; later, skipped and archived are separate.",
        "Timing uses saved tracker records, including running timers as of export. "
        "Zero recorded time does not imply no work. No external time sync is triggered.", "",
        "## Materials", "",
        "| Material | Kind | Reading status | Reading progress | Open | Answered | Later | "
        "Skipped | Archived |",
        "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for material in materials:
        progress = (f"{material['progress']:g}%" if material["progress"] is not None
                    else "Not recorded")
        questions_here = _questions(q for q in questions if q["resource_id"] == material["id"])
        lines.append(f"| {_cell(material['title'])} | {_cell(material['kind'])} | "
                     f"{STATUS[str(material['status'])]} | {progress} | "
                     f"{_question_cells(questions_here)} |")
    if not materials:
        lines.append("\nNo materials.")
    listed = {material["id"] for material in materials}
    other_questions = _questions(q for q in questions if q["resource_id"] not in listed)
    if other_questions:
        lines.extend(["", "Other course questions (outside the material rows): "
                      + ", ".join(f"{other_questions[state]} {state}"
                                  for state in QUESTION_STATES) + "."])
    chapters = rows("""
        SELECT r.title, cp.chapter_number, cp.status FROM resource_chapter_progress cp
        JOIN resources r ON r.id=cp.resource_id
        WHERE r.course_id=:course AND r.deleted_at IS NULL AND r.kind='book'
        ORDER BY r.title, cp.chapter_number
    """)
    if chapters:
        lines.extend(["", "### Saved chapter progress", "",
                      "Unlisted chapters have no saved chapter status.", "",
                      "| Book | Chapter | Status |", "| --- | ---: | --- |"])
        lines.extend(f"| {_cell(c['title'])} | {c['chapter_number']} | {STATUS[str(c['status'])]} |"
                     for c in chapters)
    lines.extend(["", "## Study days and tasks", ""])
    for day in days:
        day_tasks = [task for task in tasks if task["day_id"] == day["id"]]
        timing = by_day[str(day["id"])]
        lines.extend([
            f"### {day['date'] or 'Unscheduled'} · Day {day['number']} — {_cell(day['title'])}", "",
            f"Status: {STATUS[str(day['status'])]} · "
            f"Tasks done: {sum(t['status'] == 'done' for t in day_tasks)}/{len(day_tasks)} · "
            f"Recorded: {_duration(timing.seconds)} ({timing.sessions} sessions)",
            f"Opened: {_date(day['opened_at'], zone)} · Closed: {_date(day['closed_at'], zone)} · "
            f"Completed: {_date(day['completed_at'], zone)}", "",
            "| Section / task | Status | Planned | Recorded | Started | Completed |",
            "| --- | --- | ---: | ---: | --- | --- |",
        ])
        for task in day_tasks:
            label = f"{task['section']} / {task['title']}" if task["section"] else task["title"]
            optional = " (optional)" if task["is_optional"] else ""
            planned = (f"{task['estimated_minutes']} min" if task["estimated_minutes"] is not None
                       else "Not estimated")
            lines.append(f"| {_cell(label)}{optional} | {STATUS[str(task['status'])]} | "
                         f"{planned} | "
                         f"{_duration(by_task[str(task['id'])].seconds)} | "
                         f"{_date(task['started_at'], zone)} | "
                         f"{_date(task['completed_at'], zone)} |")
        if not day_tasks:
            lines.append("\nNo tasks.")
        assigned = sum(by_task[str(task["id"])].seconds for task in day_tasks)
        if remaining := timing.seconds - assigned:
            lines.extend(["", "Other time on this day (unassigned or removed tasks): "
                          + _duration(remaining) + "."])
        lines.append("")
    if not days:
        lines.extend(["No study days.", ""])
    unassigned = total.seconds - sum(by_day[str(day["id"])].seconds for day in days)
    if unassigned:
        lines.extend(["Time outside the listed study days: " + _duration(unassigned) + ".", ""])
    if by_date:
        lines.extend(["## Recorded activity by calendar date", "",
                      f"Grouped by session start date in {_cell(time_zone)}; "
                      "sessions crossing midnight stay with their start date.", "",
                      "| Date | Recorded | Sessions | Running |",
                      "| --- | ---: | ---: | ---: |"])
        lines.extend(f"| {date} | {_duration(t.seconds)} | {t.sessions} | {t.running} |"
                     for date, t in sorted(by_date.items()))
    stem = re.sub(r"[^A-Za-z0-9_-]+", "-", str(course["short_code"])).strip("-") or "course"
    return CourseProgressExport(
        filename=f"{stem}-progress-{now.astimezone(UTC):%Y%m%d-%H%M%SZ}.md",
        markdown="\n".join(lines).rstrip() + "\n", exported_at=timestamp,
    )
