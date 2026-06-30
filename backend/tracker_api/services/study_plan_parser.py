from __future__ import annotations

import hashlib
import re
import shlex
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, cast
from urllib.parse import unquote, urlparse

from .study_plan_registry import (
    RegistryResource,
    ResourceRegistryError,
    load_resource_registry,
)

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
    paths: tuple[str, ...] = ()
    url: str | None = None
    authors: tuple[str, ...] = ()
    publication_year: int | None = None
    description_markdown: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def path(self) -> str | None:
        return self.paths[0] if self.paths else None


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
        diagnostics.append(PlanDiagnostic("error", "invalid_attributes", str(error), line))
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
        explicit_number.group("title").strip() if explicit_number else title_with_attributes.strip()
    )
    date_value = _string(attributes.get("date")) or (date_match.group(1) if date_match else None)
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
        normalized_target if is_web else str((source_path.parent / normalized_target).resolve())
    )
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:10]
    key = f"link-{_slug(label)[:36]}-{digest}"
    suffix = Path(parsed.path).suffix.lower().lstrip(".")
    kind = "web" if is_web else _infer_resource_kind(label, suffix)
    return ResourceSpec(
        key=key,
        title=_clean_markdown(label),
        kind=kind,
        paths=() if is_web else (identity,),
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


def _resolve_local_path(
    raw_path: str,
    *,
    source_path: Path,
    resource_key: str,
    diagnostics: list[PlanDiagnostic],
) -> str:
    normalized = re.sub(r"\\([ ~()\[\]])", r"\1", raw_path)
    if normalized != raw_path:
        diagnostics.append(
            PlanDiagnostic(
                "warning",
                "normalized_shell_escaped_path",
                (
                    f"Resource {resource_key!r} used shell escapes in a TOML path; "
                    f"interpreting it as {normalized!r}."
                ),
            )
        )
    candidate = Path(normalized).expanduser()
    return str(
        candidate.resolve()
        if candidate.is_absolute()
        else (source_path.parent / candidate).resolve()
    )


def _registry_resources(
    raw_registry_path: object,
    source_path: Path,
    diagnostics: list[PlanDiagnostic],
) -> dict[str, RegistryResource]:
    registry_value = _string(raw_registry_path)
    if registry_value is None:
        return {}
    registry_path = Path(
        _resolve_local_path(
            registry_value,
            source_path=source_path,
            resource_key="resource_registry",
            diagnostics=diagnostics,
        )
    )
    try:
        return load_resource_registry(registry_path)
    except ResourceRegistryError as error:
        diagnostics.append(PlanDiagnostic("error", "invalid_resource_registry", str(error)))
        return {}


def _parse_resources(
    raw_resources: object,
    raw_registry_path: object,
    source_path: Path,
    diagnostics: list[PlanDiagnostic],
) -> dict[str, ResourceSpec]:
    registry = _registry_resources(raw_registry_path, source_path, diagnostics)
    if raw_resources is None:
        raw_resources = {}
    if not isinstance(raw_resources, dict):
        diagnostics.append(
            PlanDiagnostic(
                "error",
                "invalid_resources",
                "[resources] must contain keyed resource tables.",
            )
        )
        raw_resources = {}
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
        raw_paths = _string_list(payload.get("path"))
        resolved_paths = tuple(
            _resolve_local_path(
                raw_path,
                source_path=source_path,
                resource_key=key,
                diagnostics=diagnostics,
            )
            for raw_path in raw_paths
        )
        url = _string(payload.get("url"))
        title = _string(payload.get("title")) or key.replace("-", " ").title()
        suffix = Path(resolved_paths[0]).suffix.lower().lstrip(".") if resolved_paths else ""
        registry_resource = registry.pop(key, None)
        resources[key] = ResourceSpec(
            key=key,
            title=title,
            kind=_string(payload.get("kind")) or _infer_resource_kind(title, suffix),
            category=_string(payload.get("category")),
            paths=resolved_paths
            or ((registry_resource.path,) if registry_resource and registry_resource.path else ()),
            url=url or (registry_resource.url if registry_resource else None),
            authors=_string_list(payload.get("authors"))
            or (registry_resource.authors if registry_resource else ()),
            publication_year=(
                int(payload["year"])
                if payload.get("year") is not None
                else registry_resource.publication_year
                if registry_resource
                else None
            ),
            description_markdown=(
                registry_resource.description_markdown if registry_resource else ""
            ),
            metadata=(registry_resource.metadata if registry_resource else {}),
        )
        for resolved_path in resources[key].paths:
            if Path(resolved_path).exists():
                continue
            diagnostics.append(
                PlanDiagnostic(
                    "warning",
                    "missing_resource_file",
                    f"Resource {key!r} points to a file that does not exist: {resolved_path}",
                )
            )
    for key, registry_resource in registry.items():
        _validate_key(key, entity="resource", line=None, diagnostics=diagnostics)
        paths = (registry_resource.path,) if registry_resource.path else ()
        resources[key] = ResourceSpec(
            key=key,
            title=registry_resource.title,
            kind=registry_resource.kind,
            category=registry_resource.category,
            paths=paths,
            url=registry_resource.url,
            authors=registry_resource.authors,
            publication_year=registry_resource.publication_year,
            description_markdown=registry_resource.description_markdown,
            metadata=registry_resource.metadata,
        )
        diagnostics.extend(
            [
                PlanDiagnostic(
                    "warning",
                    "missing_resource_file",
                    (
                        f"Registry resource {key!r} points to a file that "
                        f"does not exist: {resolved_path}"
                    ),
                )
                for resolved_path in paths
                if not Path(resolved_path).exists()
            ]
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


@dataclass(frozen=True)
class _SourceLine:
    number: int
    text: str


class _CourseBodyParser:
    def __init__(
        self,
        *,
        source_path: Path,
        mode: PlanMode,
        resources: dict[str, ResourceSpec],
        diagnostics: list[PlanDiagnostic],
    ) -> None:
        self.source_path = source_path
        self.mode = mode
        self.resources = resources
        self.diagnostics = diagnostics
        self.seen_day_keys: set[str] = set()
        self.seen_task_keys: set[str] = set()
        self.task_counts: dict[tuple[str, str], int] = {}

    def parse_course(self, body: str, *, line_offset: int) -> tuple[DaySpec, ...]:
        days: list[DaySpec] = []
        heading: _SourceLine | None = None
        day_lines: list[_SourceLine] = []
        for relative_line, raw_line in enumerate(body.splitlines(), start=1):
            source_line = _SourceLine(line_offset + relative_line, raw_line.rstrip())
            heading_match = DAY_HEADING.match(source_line.text)
            if heading_match:
                if heading is not None:
                    day = self.parse_day(heading, day_lines, len(days) + 1)
                    if day is not None:
                        days.append(day)
                heading = _SourceLine(source_line.number, heading_match.group("body"))
                day_lines = []
            elif heading is not None:
                day_lines.append(source_line)
        if heading is not None:
            day = self.parse_day(heading, day_lines, len(days) + 1)
            if day is not None:
                days.append(day)
        return tuple(sorted(days, key=lambda item: item.order_index))

    def parse_day(
        self,
        heading: _SourceLine,
        lines: list[_SourceLine],
        fallback_number: int,
    ) -> DaySpec | None:
        parsed = _parse_day_heading(
            heading.text,
            fallback_number=fallback_number,
            line=heading.number,
            diagnostics=self.diagnostics,
        )
        if parsed is None:
            return None
        raw_day, explicit_key = parsed
        day_key = str(raw_day["key"])
        if day_key in self.seen_day_keys:
            self.diagnostics.append(
                PlanDiagnostic(
                    "error",
                    "duplicate_day_id",
                    f"Duplicate day id {day_key!r}.",
                    heading.number,
                )
            )
        self.seen_day_keys.add(day_key)
        current_section = "Tasks"
        for line in lines:
            section_title = self._parse_section_heading(line, raw_day)
            if section_title is not None:
                current_section = section_title
                continue
            purpose = PURPOSE.match(line.text)
            if purpose:
                raw_day["purpose"] = _clean_markdown(purpose.group("body"))
                continue
            task = self.parse_task(
                line,
                day_key=day_key,
                current_section=current_section,
                raw_day=raw_day,
            )
            if task is not None:
                section = self._ensure_section(raw_day, task.section)
                cast(list[TaskSpec], section["tasks"]).append(task)
        sections = tuple(
            SectionSpec(
                key=str(section["key"]),
                title=str(section["title"]),
                order_index=int(section["order_index"]),
                default_collapsed=bool(section["default_collapsed"]),
                tasks=tuple(cast(list[TaskSpec], section["tasks"])),
            )
            for section in sorted(
                cast(list[dict[str, Any]], raw_day["sections"]),
                key=lambda item: int(item["order_index"]),
            )
        )
        return DaySpec(
            key=day_key,
            number=int(raw_day["number"]),
            title=str(raw_day["title"]),
            order_index=int(raw_day["order_index"]),
            line=int(raw_day["line"]),
            explicit_key=explicit_key,
            date=cast(str | None, raw_day["date"]),
            topic=cast(str | None, raw_day["topic"]),
            purpose=cast(str | None, raw_day["purpose"]),
            skill_keys=cast(tuple[str, ...], raw_day["skills"]),
            sections=sections,
        )

    def parse_task(
        self,
        line: _SourceLine,
        *,
        day_key: str,
        current_section: str,
        raw_day: dict[str, Any],
    ) -> TaskSpec | None:
        stop_when = STOP_WHEN.match(line.text)
        checkbox = CHECKBOX.match(line.text)
        if stop_when:
            task_body = stop_when.group("body")
            state = " "
            section_title = "Stop when"
        elif checkbox:
            task_body = checkbox.group("body")
            state = checkbox.group("state")
            section_title = current_section
        else:
            return None
        task_body, attributes = _parse_attributes(
            task_body,
            line=line.number,
            diagnostics=self.diagnostics,
        )
        title_with_annotations, inline_rationale = _split_task_annotations(task_body)
        title = _clean_markdown(title_with_annotations)
        section = self._ensure_section(raw_day, section_title)
        count_key = (day_key, str(section["key"]))
        self.task_counts[count_key] = self.task_counts.get(count_key, 0) + 1
        explicit_key = "id" in attributes
        task_key = _string(attributes.get("id")) or (
            f"{day_key}-{section['key']}-{self.task_counts[count_key]}"
        )
        assert task_key is not None
        _validate_key(
            task_key,
            entity="task",
            line=line.number,
            diagnostics=self.diagnostics,
        )
        if task_key in self.seen_task_keys:
            self.diagnostics.append(
                PlanDiagnostic(
                    "error",
                    "duplicate_task_id",
                    f"Duplicate task id {task_key!r}.",
                    line.number,
                )
            )
        self.seen_task_keys.add(task_key)
        link_resource_keys = self._link_resources(task_body)
        resource_keys = tuple(
            dict.fromkeys((*_string_list(attributes.get("resources")), *link_resource_keys))
        )
        status = self._task_status(attributes, state, line.number)
        rationale = "\n\n".join(
            part
            for part in (
                _string(attributes.get("why")) or inline_rationale,
                _string(attributes.get("info")),
            )
            if part
        )
        return TaskSpec(
            key=task_key,
            title=title,
            section=str(section["title"]),
            order_index=self._integer_attribute(
                attributes,
                "order",
                default=len(cast(list[TaskSpec], section["tasks"])) + 1,
                line=line.number,
            ),
            line=line.number,
            explicit_key=explicit_key,
            task_type=_string(attributes.get("type"))
            or _infer_task_type(str(section["title"]), title),
            is_optional=bool(
                attributes.get("optional") is True
                or str(section["title"]).lower() in {"optional", "additional", "skip"}
            ),
            estimated_minutes=self._optional_integer_attribute(
                attributes,
                "minutes",
                line=line.number,
            ),
            status=status,
            rationale=rationale,
            resource_keys=resource_keys,
            skill_keys=_string_list(attributes.get("skills")),
        )

    def _parse_section_heading(
        self,
        line: _SourceLine,
        raw_day: dict[str, Any],
    ) -> str | None:
        section_heading = SECTION_HEADING.match(line.text)
        colon_section = COLON_SECTION.match(line.text)
        matched = section_heading or colon_section
        if matched is None:
            return None
        section_title, attributes = _parse_attributes(
            matched.group("body"),
            line=line.number,
            diagnostics=self.diagnostics,
        )
        cleaned_title = _clean_markdown(section_title)
        section = self._ensure_section(raw_day, cleaned_title)
        if attributes.get("collapsed") is True:
            section["default_collapsed"] = True
        if _string(attributes.get("order")):
            section["order_index"] = self._integer_attribute(
                attributes,
                "order",
                default=int(section["order_index"]),
                line=line.number,
            )
        return cleaned_title

    def _ensure_section(
        self,
        raw_day: dict[str, Any],
        title: str,
    ) -> dict[str, Any]:
        sections = cast(list[dict[str, Any]], raw_day["sections"])
        for section in sections:
            if section["title"] == title:
                return section
        section = {
            "key": _slug(title),
            "title": title,
            "order_index": len(sections) + 1,
            "default_collapsed": title.lower() in {"optional", "additional", "skip"},
            "tasks": [],
        }
        sections.append(section)
        return section

    def _link_resources(self, task_body: str) -> list[str]:
        resource_keys: list[str] = []
        for link in MARKDOWN_LINK.finditer(task_body):
            resource = _resource_from_link(
                link.group(1),
                link.group(2),
                self.source_path,
            )
            self.resources.setdefault(resource.key, resource)
            resource_keys.append(resource.key)
        return resource_keys

    def _task_status(
        self,
        attributes: dict[str, str | bool],
        checkbox_state: str,
        line: int,
    ) -> TaskStatus | None:
        status_value = _string(attributes.get("status"))
        if status_value is None:
            return _status_from_checkbox(checkbox_state)
        if status_value not in {"todo", "in_progress", "done", "later", "skipped"}:
            self.diagnostics.append(
                PlanDiagnostic(
                    "error",
                    "invalid_task_status",
                    f"Task status {status_value!r} is not supported.",
                    line,
                )
            )
            return None
        return cast(TaskStatus, status_value)

    def _integer_attribute(
        self,
        attributes: dict[str, str | bool],
        key: str,
        *,
        default: int,
        line: int,
    ) -> int:
        value = self._optional_integer_attribute(attributes, key, line=line)
        return value if value is not None else default

    def _optional_integer_attribute(
        self,
        attributes: dict[str, str | bool],
        key: str,
        *,
        line: int,
    ) -> int | None:
        value = _string(attributes.get(key))
        if value is None:
            return None
        try:
            return int(value)
        except ValueError:
            self.diagnostics.append(
                PlanDiagnostic(
                    "error",
                    "invalid_integer_attribute",
                    f"Task attribute {key!r} must be an integer; received {value!r}.",
                    line,
                )
            )
            return None


def _validate_references(
    days: tuple[DaySpec, ...],
    resources: dict[str, ResourceSpec],
    skills: dict[str, SkillSpec],
    diagnostics: list[PlanDiagnostic],
) -> None:

    referenced_resources = {
        key
        for day in days
        for section in day.sections
        for task in section.tasks
        for key in task.resource_keys
    }
    referenced_skills = {
        *(key for day in days for key in day.skill_keys),
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


def _validate_structure(
    days: tuple[DaySpec, ...],
    mode: PlanMode,
    diagnostics: list[PlanDiagnostic],
) -> None:
    if mode == "full":
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
    if mode == "patch":
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
    if mode == "full" and not days:
        diagnostics.append(
            PlanDiagnostic(
                "error",
                "no_days",
                "A full study plan must contain at least one ### Day heading.",
            )
        )


def parse_study_plan(path: Path) -> PlanParseResult:
    diagnostics: list[PlanDiagnostic] = []
    try:
        source = path.read_text(encoding="utf-8")
    except OSError as error:
        return PlanParseResult(
            plan=None,
            diagnostics=[PlanDiagnostic("error", "cannot_read", f"Cannot read {path}: {error}")],
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
            diagnostics=[PlanDiagnostic("error", "invalid_frontmatter", str(error), 1)],
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
    raw_mode = _string(metadata.get("mode")) or "full"
    if raw_mode not in {"full", "patch"}:
        diagnostics.append(
            PlanDiagnostic(
                "error",
                "invalid_mode",
                "mode must be either 'full' or 'patch'.",
            )
        )
        raw_mode = "full"
    mode = cast(PlanMode, raw_mode)
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
    resources = _parse_resources(
        metadata.get("resources"),
        metadata.get("resource_registry"),
        path,
        diagnostics,
    )
    skills = _parse_skills(metadata.get("skills"), diagnostics)
    days = _CourseBodyParser(
        source_path=path,
        mode=mode,
        resources=resources,
        diagnostics=diagnostics,
    ).parse_course(body, line_offset=body_line_offset)
    _validate_references(days, resources, skills, diagnostics)
    _validate_structure(days, mode, diagnostics)
    plan = StudyPlanSpec(
        format=plan_format,
        plan_id=plan_id,
        mode=mode,
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
