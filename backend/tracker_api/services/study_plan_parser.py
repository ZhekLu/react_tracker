from __future__ import annotations

import hashlib
import re
import shlex
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, cast
from urllib.parse import unquote, urlparse

PLAN_FORMAT = "study-plan/v1"
VALID_ID = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
FRONTMATTER = re.compile(r"\A\+\+\+\s*\n(?P<body>.*?)\n\+\+\+\s*(?:\n|\Z)", re.DOTALL)
ATTRIBUTES = re.compile(r"\s+\{(?P<body>#[a-zA-Z0-9][^{}]*)\}\s*$")
MARKDOWN_LINK = re.compile(r"\[([^\]]+)\]\((<[^>]+>|[^)]+)\)")
CHECKBOX = re.compile(r"^(?P<indent>\s*)-\s+\[(?P<state>[ xX~>-])\]\s+(?P<body>.+)$")
DAY_HEADING = re.compile(r"^###\s+(?P<body>.+)$")
SECTION_HEADING = re.compile(r"^####\s+(?P<body>.+)$")
COLON_SECTION = re.compile(r"^(?P<body>[A-Za-z][A-Za-z0-9 /&+_.-]*):\s*$")
PURPOSE = re.compile(r"^Purpose:\s*(?P<body>.+)$", re.IGNORECASE)
STOP_WHEN = re.compile(r"^(?:Success condition|Stop when):\s*(?P<body>.+)$", re.IGNORECASE)

TaskStatus = Literal["todo", "in_progress", "done", "later", "skipped"]
PlanMode = Literal["full", "patch"]
DiagnosticLevel = Literal["error", "warning"]


@dataclass(frozen=True)
class PlanDiagnostic:
    level: DiagnosticLevel
    code: str
    message: str
    line: int | None = None

    def render(self) -> str:
        location = f"line {self.line}: " if self.line is not None else ""
        return f"{self.level.upper()} [{self.code}] {location}{self.message}"


@dataclass(frozen=True)
class ResourceSpec:
    key: str
    title: str
    kind: str = "other"
    category: str | None = None
    path: str | None = None
    url: str | None = None
    authors: tuple[str, ...] = ()
    publication_year: int | None = None


@dataclass(frozen=True)
class SkillSpec:
    key: str
    name: str
    category: str | None = None
    description: str = ""


@dataclass(frozen=True)
class TaskSpec:
    key: str
    title: str
    section: str
    order_index: int
    line: int
    explicit_key: bool
    task_type: str | None = None
    is_optional: bool = False
    estimated_minutes: int | None = None
    status: TaskStatus | None = None
    rationale: str = ""
    resource_keys: tuple[str, ...] = ()
    skill_keys: tuple[str, ...] = ()


@dataclass(frozen=True)
class SectionSpec:
    key: str
    title: str
    order_index: int
    default_collapsed: bool
    tasks: tuple[TaskSpec, ...]


@dataclass(frozen=True)
class DaySpec:
    key: str
    number: int
    title: str
    order_index: int
    line: int
    explicit_key: bool
    date: str | None = None
    topic: str | None = None
    purpose: str | None = None
    skill_keys: tuple[str, ...] = ()
    sections: tuple[SectionSpec, ...] = ()


@dataclass(frozen=True)
class StudyPlanSpec:
    format: str
    plan_id: str
    mode: PlanMode
    source_path: Path
    title: str
    short_code: str | None
    subtitle: str | None
    accent: str | None
    icon: str | None
    deadline: str | None
    fields_present: frozenset[str]
    days: tuple[DaySpec, ...]
    resources: tuple[ResourceSpec, ...]
    skills: tuple[SkillSpec, ...]


@dataclass
class PlanParseResult:
    plan: StudyPlanSpec | None
    diagnostics: list[PlanDiagnostic] = field(default_factory=list)

    @property
    def errors(self) -> list[PlanDiagnostic]:
        return [item for item in self.diagnostics if item.level == "error"]

    @property
    def warnings(self) -> list[PlanDiagnostic]:
        return [item for item in self.diagnostics if item.level == "warning"]

    def require_plan(self) -> StudyPlanSpec:
        if self.plan is None or self.errors:
            rendered = "\n".join(item.render() for item in self.diagnostics)
            raise ValueError(rendered or "Study plan could not be parsed.")
        return self.plan


def _slug(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return normalized or "item"


def _string(value: object) -> str | None:
    if value is None:
        return None
    rendered = str(value).strip()
    return rendered or None


def _string_list(value: object) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        return tuple(item.strip() for item in value.split(",") if item.strip())
    if isinstance(value, list):
        return tuple(str(item).strip() for item in value if str(item).strip())
    return (str(value).strip(),) if str(value).strip() else ()


def _parse_attributes(
    value: str,
    *,
    line: int,
    diagnostics: list[PlanDiagnostic],
) -> tuple[str, dict[str, str | bool]]:
    match = ATTRIBUTES.search(value)
    if match is None:
        return value.strip(), {}
    body = match.group("body")
    try:
        tokens = shlex.split(body)
    except ValueError as error:
        diagnostics.append(
            PlanDiagnostic("error", "invalid_attributes", str(error), line)
        )
        return value[: match.start()].strip(), {}
    attributes: dict[str, str | bool] = {}
    for token in tokens:
        if token.startswith("#"):
            attributes["id"] = token[1:]
        elif "=" in token:
            key, raw_value = token.split("=", 1)
            attributes[key.replace("-", "_")] = raw_value
        else:
            attributes[token.replace("-", "_")] = True
    return value[: match.start()].strip(), attributes


def _validate_key(
    key: str,
    *,
    entity: str,
    line: int | None,
    diagnostics: list[PlanDiagnostic],
) -> None:
    if not VALID_ID.fullmatch(key):
        diagnostics.append(
            PlanDiagnostic(
                "error",
                "invalid_id",
                f"{entity} id {key!r} must match {VALID_ID.pattern}.",
                line,
            )
        )


def _clean_markdown(value: str) -> str:
    cleaned = MARKDOWN_LINK.sub(lambda match: match.group(1), value)
    cleaned = re.sub(r"`([^`]+)`", r"\1", cleaned)
    cleaned = cleaned.replace("**", "").replace("__", "")
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip().rstrip(".")


def _split_task_annotations(value: str) -> tuple[str, str]:
    tags = list(re.finditer(r"\b(Why this|Resources?|Questions?)\s*:", value, flags=re.I))
    if not tags:
        return value, ""
    title = value[: tags[0].start()].strip()
    rationale = ""
    for index, tag in enumerate(tags):
        end = tags[index + 1].start() if index + 1 < len(tags) else len(value)
        if tag.group(1).lower() == "why this":
            rationale = _clean_markdown(value[tag.end() : end].strip(" ."))
    return title, rationale


def _infer_task_type(section: str, title: str) -> str:
    searchable = f"{section} {title}".lower()
    for token, task_type in (
        ("read", "reading"),
        ("study", "reading"),
        ("review", "review"),
        ("recall", "recall"),
        ("solve", "solve"),
        ("exercise", "solve"),
        ("implement", "code"),
        ("code", "code"),
        ("write", "write"),
        ("create", "project"),
    ):
        if token in searchable:
            return task_type
    return "other"


def _status_from_checkbox(value: str) -> TaskStatus | None:
    return cast(
        TaskStatus | None,
        {
        "x": "done",
        "X": "done",
        "~": "in_progress",
        ">": "later",
        "-": "skipped",
        }.get(value),
    )


def _parse_day_heading(
    value: str,
    *,
    fallback_number: int,
    line: int,
    diagnostics: list[PlanDiagnostic],
) -> tuple[dict[str, Any], bool] | None:
    title_with_attributes, attributes = _parse_attributes(
        value,
        line=line,
        diagnostics=diagnostics,
    )
    explicit_number = re.match(
        r"^(?:Day\s+)?(?P<number>\d+)\s*:\s*(?P<title>.+)$",
        title_with_attributes,
        flags=re.I,
    )
    date_match = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", title_with_attributes)
    if explicit_number is None and date_match is None:
        return None
    number = int(explicit_number.group("number")) if explicit_number else fallback_number
    title = (
        explicit_number.group("title").strip()
        if explicit_number
        else title_with_attributes.strip()
    )
    date_value = _string(attributes.get("date")) or (
        date_match.group(1) if date_match else None
    )
    topic = _string(attributes.get("topic"))
    if topic is None:
        topic = title.split(" - ", 1)[1].strip() if " - " in title else title
        if date_value and date_value in topic:
            topic = topic.split(date_value, 1)[-1].strip(" -") or topic
    explicit_key = "id" in attributes
    key = _string(attributes.get("id")) or f"day-{number:02d}"
    assert key is not None
    _validate_key(
        key,
        entity="day",
        line=line,
        diagnostics=diagnostics,
    )
    return (
        {
            "key": key,
            "number": number,
            "order_index": int(_string(attributes.get("order")) or number),
            "title": title,
            "date": date_value,
            "topic": topic,
            "purpose": None,
            "skills": _string_list(attributes.get("skills")),
            "line": line,
            "sections": [],
        },
        explicit_key,
    )


def _resource_from_link(
    label: str,
    target: str,
    source_path: Path,
) -> ResourceSpec:
    normalized_target = unquote(target.strip().strip("<>"))
    parsed = urlparse(normalized_target)
    is_web = parsed.scheme in {"http", "https"}
    identity = (
        normalized_target
        if is_web
        else str((source_path.parent / normalized_target).resolve())
    )
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:10]
    key = f"link-{_slug(label)[:36]}-{digest}"
    suffix = Path(parsed.path).suffix.lower().lstrip(".")
    kind = "web" if is_web else _infer_resource_kind(label, suffix)
    return ResourceSpec(
        key=key,
        title=_clean_markdown(label),
        kind=kind,
        path=None if is_web else identity,
        url=normalized_target if is_web else None,
    )


def _infer_resource_kind(title: str, suffix: str = "") -> str:
    searchable = title.lower()
    if suffix == "pdf" and ("paper" in searchable or "article" in searchable):
        return "paper"
    if "book" in searchable:
        return "book"
    if "slide" in searchable or "lecture" in searchable:
        return "slides"
    if "exam" in searchable:
        return "exam"
    if "exercise" in searchable or "assignment" in searchable:
        return "exercise"
    if "dataset" in searchable:
        return "dataset"
    if "guide" in searchable or suffix in {"html", "md", "markdown"}:
        return "guide"
    if suffix in {"html", "htm"}:
        return "guide"
    return "other"


def _parse_resources(
    raw_resources: object,
    source_path: Path,
    diagnostics: list[PlanDiagnostic],
) -> dict[str, ResourceSpec]:
    if raw_resources is None:
        return {}
    if not isinstance(raw_resources, dict):
        diagnostics.append(
            PlanDiagnostic(
                "error",
                "invalid_resources",
                "[resources] must contain keyed resource tables.",
            )
        )
        return {}
    resources: dict[str, ResourceSpec] = {}
    for key_value, payload in raw_resources.items():
        key = str(key_value)
        _validate_key(key, entity="resource", line=None, diagnostics=diagnostics)
        if not isinstance(payload, dict):
            diagnostics.append(
                PlanDiagnostic(
                    "error",
                    "invalid_resource",
                    f"resources.{key} must be a TOML table.",
                )
            )
            continue
        raw_path = _string(payload.get("path"))
        resolved_path = (
            str((source_path.parent / raw_path).expanduser().resolve())
            if raw_path and not Path(raw_path).expanduser().is_absolute()
            else str(Path(raw_path).expanduser().resolve())
            if raw_path
            else None
        )
        url = _string(payload.get("url"))
        title = _string(payload.get("title")) or key.replace("-", " ").title()
        suffix = Path(resolved_path).suffix.lower().lstrip(".") if resolved_path else ""
        resources[key] = ResourceSpec(
            key=key,
            title=title,
            kind=_string(payload.get("kind")) or _infer_resource_kind(title, suffix),
            category=_string(payload.get("category")),
            path=resolved_path,
            url=url,
            authors=_string_list(payload.get("authors")),
            publication_year=(
                int(payload["year"]) if payload.get("year") is not None else None
            ),
        )
        if resolved_path and not Path(resolved_path).exists():
            diagnostics.append(
                PlanDiagnostic(
                    "warning",
                    "missing_resource_file",
                    f"Resource {key!r} points to a file that does not exist: {resolved_path}",
                )
            )
    return resources


def _parse_skills(
    raw_skills: object,
    diagnostics: list[PlanDiagnostic],
) -> dict[str, SkillSpec]:
    if raw_skills is None:
        return {}
    if not isinstance(raw_skills, dict):
        diagnostics.append(
            PlanDiagnostic(
                "error",
                "invalid_skills",
                "[skills] must contain keyed skill tables.",
            )
        )
        return {}
    skills: dict[str, SkillSpec] = {}
    for key_value, payload in raw_skills.items():
        key = str(key_value)
        _validate_key(key, entity="skill", line=None, diagnostics=diagnostics)
        if not isinstance(payload, dict):
            diagnostics.append(
                PlanDiagnostic(
                    "error",
                    "invalid_skill",
                    f"skills.{key} must be a TOML table.",
                )
            )
            continue
        skills[key] = SkillSpec(
            key=key,
            name=_string(payload.get("name")) or key.replace("-", " ").title(),
            category=_string(payload.get("category")),
            description=_string(payload.get("description")) or "",
        )
    return skills


def parse_study_plan(path: Path) -> PlanParseResult:
    diagnostics: list[PlanDiagnostic] = []
    try:
        source = path.read_text(encoding="utf-8")
    except OSError as error:
        return PlanParseResult(
            plan=None,
            diagnostics=[
                PlanDiagnostic("error", "cannot_read", f"Cannot read {path}: {error}")
            ],
        )
    frontmatter_match = FRONTMATTER.match(source)
    if frontmatter_match is None:
        return PlanParseResult(
            plan=None,
            diagnostics=[
                PlanDiagnostic(
                    "error",
                    "missing_frontmatter",
                    "Study Plan v1 files must begin with TOML frontmatter between +++ lines.",
                    1,
                )
            ],
        )
    try:
        metadata = tomllib.loads(frontmatter_match.group("body"))
    except tomllib.TOMLDecodeError as error:
        return PlanParseResult(
            plan=None,
            diagnostics=[
                PlanDiagnostic("error", "invalid_frontmatter", str(error), 1)
            ],
        )
    plan_format = _string(metadata.get("format")) or ""
    if plan_format != PLAN_FORMAT:
        diagnostics.append(
            PlanDiagnostic(
                "error",
                "unsupported_format",
                f"format must be {PLAN_FORMAT!r}; received {plan_format!r}.",
            )
        )
    plan_id = _string(metadata.get("id")) or ""
    _validate_key(plan_id, entity="plan", line=None, diagnostics=diagnostics)
    mode_value = _string(metadata.get("mode")) or "full"
    if mode_value not in {"full", "patch"}:
        diagnostics.append(
            PlanDiagnostic(
                "error",
                "invalid_mode",
                "mode must be either 'full' or 'patch'.",
            )
        )
        mode_value = "full"
    body = source[frontmatter_match.end() :]
    body_line_offset = source[: frontmatter_match.end()].count("\n")
    heading_title = next(
        (
            _clean_markdown(line.removeprefix("# "))
            for line in body.splitlines()
            if line.startswith("# ")
        ),
        None,
    )
    title = _string(metadata.get("title")) or heading_title or plan_id.replace("-", " ").title()
    resources = _parse_resources(metadata.get("resources"), path, diagnostics)
    skills = _parse_skills(metadata.get("skills"), diagnostics)

    raw_days: list[dict[str, Any]] = []
    explicit_day_keys: dict[str, bool] = {}
    current_day: dict[str, Any] | None = None
    current_section = "Tasks"
    task_counts: dict[tuple[str, str], int] = {}
    seen_day_keys: set[str] = set()
    seen_task_keys: set[str] = set()

    def ensure_section(day: dict[str, Any], title_value: str) -> dict[str, Any]:
        for section in day["sections"]:
            if section["title"] == title_value:
                return cast(dict[str, Any], section)
        section = {
            "key": _slug(title_value),
            "title": title_value,
            "order_index": len(day["sections"]) + 1,
            "default_collapsed": title_value.lower() in {"optional", "additional", "skip"},
            "tasks": [],
        }
        day["sections"].append(section)
        return section

    for relative_line, raw_line in enumerate(body.splitlines(), start=1):
        line_number = body_line_offset + relative_line
        line = raw_line.rstrip()
        day_heading = DAY_HEADING.match(line)
        if day_heading:
            parsed_day = _parse_day_heading(
                day_heading.group("body"),
                fallback_number=len(raw_days) + 1,
                line=line_number,
                diagnostics=diagnostics,
            )
            if parsed_day is not None:
                current_day, explicit_key = parsed_day
                raw_days.append(current_day)
                explicit_day_keys[current_day["key"]] = explicit_key
                if current_day["key"] in seen_day_keys:
                    diagnostics.append(
                        PlanDiagnostic(
                            "error",
                            "duplicate_day_id",
                            f"Duplicate day id {current_day['key']!r}.",
                            line_number,
                        )
                    )
                seen_day_keys.add(current_day["key"])
                current_section = "Tasks"
                continue
            current_day = None
            continue
        if current_day is None:
            continue
        section_heading = SECTION_HEADING.match(line)
        colon_section = COLON_SECTION.match(line)
        if section_heading or colon_section:
            matched_section = section_heading or colon_section
            assert matched_section is not None
            section_text = matched_section.group("body")
            section_title, attributes = _parse_attributes(
                section_text,
                line=line_number,
                diagnostics=diagnostics,
            )
            current_section = _clean_markdown(section_title)
            section = ensure_section(current_day, current_section)
            if attributes.get("collapsed") is True:
                section["default_collapsed"] = True
            if _string(attributes.get("order")):
                section["order_index"] = int(str(attributes["order"]))
            continue
        purpose = PURPOSE.match(line)
        if purpose:
            current_day["purpose"] = _clean_markdown(purpose.group("body"))
            continue
        stop_when = STOP_WHEN.match(line)
        checkbox = CHECKBOX.match(line)
        if stop_when:
            task_body = stop_when.group("body")
            state = " "
            target_section = "Stop when"
        elif checkbox:
            task_body = checkbox.group("body")
            state = checkbox.group("state")
            target_section = current_section
        else:
            continue
        task_body, attributes = _parse_attributes(
            task_body,
            line=line_number,
            diagnostics=diagnostics,
        )
        title_with_annotations, inline_rationale = _split_task_annotations(task_body)
        title_value = _clean_markdown(title_with_annotations)
        section = ensure_section(current_day, target_section)
        count_key = (current_day["key"], section["key"])
        task_counts[count_key] = task_counts.get(count_key, 0) + 1
        explicit_key = "id" in attributes
        task_key = _string(attributes.get("id")) or (
            f"{current_day['key']}-{section['key']}-{task_counts[count_key]}"
        )
        assert task_key is not None
        _validate_key(
            task_key,
            entity="task",
            line=line_number,
            diagnostics=diagnostics,
        )
        if task_key in seen_task_keys:
            diagnostics.append(
                PlanDiagnostic(
                    "error",
                    "duplicate_task_id",
                    f"Duplicate task id {task_key!r}.",
                    line_number,
                )
            )
        seen_task_keys.add(task_key)
        link_resource_keys: list[str] = []
        for link in MARKDOWN_LINK.finditer(task_body):
            resource = _resource_from_link(link.group(1), link.group(2), path)
            resources.setdefault(resource.key, resource)
            link_resource_keys.append(resource.key)
        resource_keys = tuple(
            dict.fromkeys(
                (*_string_list(attributes.get("resources")), *link_resource_keys)
            )
        )
        skill_keys = _string_list(attributes.get("skills"))
        status_value = _string(attributes.get("status"))
        inferred_status = _status_from_checkbox(state)
        status: TaskStatus | None = None
        if status_value:
            if status_value not in {"todo", "in_progress", "done", "later", "skipped"}:
                diagnostics.append(
                    PlanDiagnostic(
                        "error",
                        "invalid_task_status",
                        f"Task status {status_value!r} is not supported.",
                        line_number,
                    )
                )
            else:
                status = status_value  # type: ignore[assignment]
        elif mode_value == "patch":
            status = inferred_status
        rationale = _string(attributes.get("why")) or inline_rationale
        minutes_value = _string(attributes.get("minutes"))
        section["tasks"].append(
            TaskSpec(
                key=task_key,
                title=title_value,
                section=section["title"],
                order_index=int(
                    _string(attributes.get("order")) or len(section["tasks"]) + 1
                ),
                line=line_number,
                explicit_key=explicit_key,
                task_type=_string(attributes.get("type"))
                or _infer_task_type(section["title"], title_value),
                is_optional=bool(
                    attributes.get("optional") is True
                    or section["title"].lower() in {"optional", "additional", "skip"}
                ),
                estimated_minutes=int(minutes_value) if minutes_value else None,
                status=status,
                rationale=rationale or "",
                resource_keys=resource_keys,
                skill_keys=skill_keys,
            )
        )

    days: list[DaySpec] = []
    for raw_day in raw_days:
        sections = tuple(
            SectionSpec(
                key=section["key"],
                title=section["title"],
                order_index=section["order_index"],
                default_collapsed=section["default_collapsed"],
                tasks=tuple(section["tasks"]),
            )
            for section in sorted(
                raw_day["sections"],
                key=lambda item: int(item["order_index"]),
            )
        )
        days.append(
            DaySpec(
                key=raw_day["key"],
                number=raw_day["number"],
                title=raw_day["title"],
                order_index=raw_day["order_index"],
                line=raw_day["line"],
                explicit_key=explicit_day_keys[raw_day["key"]],
                date=raw_day["date"],
                topic=raw_day["topic"],
                purpose=raw_day["purpose"],
                skill_keys=raw_day["skills"],
                sections=sections,
            )
        )

    referenced_resources = {
        key
        for day in days
        for section in day.sections
        for task in section.tasks
        for key in task.resource_keys
    }
    referenced_skills = {
        *(
            key
            for day in days
            for key in day.skill_keys
        ),
        *(
            key
            for day in days
            for section in day.sections
            for task in section.tasks
            for key in task.skill_keys
        ),
    }
    diagnostics.extend(
        [
            PlanDiagnostic(
                "error",
                "unknown_resource",
                f"Task references undefined resource {resource_key!r}.",
            )
            for resource_key in sorted(referenced_resources - resources.keys())
        ]
    )
    diagnostics.extend(
        [
            PlanDiagnostic(
                "error",
                "unknown_skill",
                f"Day or task references undefined skill {skill_key!r}.",
            )
            for skill_key in sorted(referenced_skills - skills.keys())
        ]
    )
    if mode_value == "full":
        for day in days:
            if not day.explicit_key:
                diagnostics.append(
                    PlanDiagnostic(
                        "warning",
                        "implicit_day_id",
                        (
                            f"Day {day.number} uses generated id {day.key!r}; "
                            f"add {{#{day.key}}} before patching it."
                        ),
                        day.line,
                    )
                )
            for plan_section in day.sections:
                for task in plan_section.tasks:
                    if not task.explicit_key:
                        message = (
                            f"Task uses generated id {task.key!r}; "
                            f"add {{#{task.key}}} so title/order edits preserve progress."
                        )
                        diagnostics.append(
                            PlanDiagnostic(
                                "warning",
                                "implicit_task_id",
                                message,
                                task.line,
                            )
                        )
    if mode_value == "patch":
        for day in days:
            if not day.explicit_key:
                diagnostics.append(
                    PlanDiagnostic(
                        "error",
                        "patch_requires_day_id",
                        "Patch days must use an explicit {#day-id}.",
                        day.line,
                    )
                )
            for plan_section in day.sections:
                for task in plan_section.tasks:
                    if not task.explicit_key:
                        diagnostics.extend(
                            [
                                PlanDiagnostic(
                                    "error",
                                    "patch_requires_task_id",
                                    "Patch tasks must use an explicit {#task-id}.",
                                    task.line,
                                )
                            ]
                        )
    if mode_value == "full" and not days:
        diagnostics.append(
            PlanDiagnostic(
                "error",
                "no_days",
                "A full study plan must contain at least one ### Day heading.",
            )
        )

    plan = StudyPlanSpec(
        format=plan_format,
        plan_id=plan_id,
        mode=mode_value,  # type: ignore[arg-type]
        source_path=path.resolve(),
        title=title,
        short_code=_string(metadata.get("short_code")),
        subtitle=_string(metadata.get("subtitle")),
        accent=_string(metadata.get("accent")),
        icon=_string(metadata.get("icon")),
        deadline=_string(metadata.get("deadline")),
        fields_present=frozenset(str(key) for key in metadata),
        days=tuple(sorted(days, key=lambda item: item.order_index)),
        resources=tuple(resources.values()),
        skills=tuple(skills.values()),
    )
    return PlanParseResult(plan=plan, diagnostics=diagnostics)
