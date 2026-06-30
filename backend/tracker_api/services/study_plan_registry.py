from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


class ResourceRegistryError(ValueError):
    pass


@dataclass(frozen=True)
class RegistryResource:
    key: str
    title: str
    kind: str
    category: str | None
    authors: tuple[str, ...]
    publication_year: int | None
    path: str | None
    url: str | None
    description_markdown: str
    metadata: dict[str, Any] = field(default_factory=dict)


def _string(value: object) -> str | None:
    if value is None:
        return None
    rendered = str(value).strip()
    return rendered or None


def _string_list(value: object) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(str(item).strip() for item in value if str(item).strip())


def _section(title: str, value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return f"### {title}\n\n{value.strip()}"
    if isinstance(value, list):
        items = [str(item).strip() for item in value if str(item).strip()]
        if items:
            return f"### {title}\n\n" + "\n".join(f"- {item}" for item in items)
    return None


def _description(entry: dict[str, Any]) -> str:
    sections = [
        _section("Central question", entry.get("central_question")),
        _section("Thesis role", entry.get("thesis_role")),
        _section("Read these sections", entry.get("read_sections")),
        _section(
            "Key equations or mechanisms",
            entry.get("key_equations_or_mechanisms"),
        ),
        _section("Pay attention to", entry.get("pay_attention_to")),
        _section("Questions to answer", entry.get("questions_to_answer")),
        _section("Skip on the first pass", entry.get("skip_on_first_pass")),
        _section("Mastery output", entry.get("mastery_output")),
        _section("Personal notes", entry.get("user_notes")),
    ]
    reading_level = _string(entry.get("reading_level"))
    importance = entry.get("course_importance")
    thesis_importance = entry.get("thesis_importance")
    summary_bits = [
        f"Reading level: **{reading_level}**" if reading_level else None,
        f"Course importance: **{importance}/5**" if importance is not None else None,
        (
            f"Thesis importance: **{thesis_importance}/5**"
            if thesis_importance is not None
            else None
        ),
    ]
    summary = " · ".join(bit for bit in summary_bits if bit)
    rendered = [summary] if summary else []
    rendered.extend(section for section in sections if section)
    return "\n\n".join(rendered)


def _resource(entry: dict[str, Any], registry_path: Path) -> RegistryResource:
    key = _string(entry.get("id"))
    title = _string(entry.get("title"))
    if key is None or title is None:
        raise ResourceRegistryError("Every registry paper needs non-empty id and title.")
    source = _string(entry.get("source"))
    source_type = _string(entry.get("source_type"))
    path: str | None = None
    url: str | None = None
    if source and source_type == "local_file":
        source_path = Path(source).expanduser()
        path = str(
            source_path.resolve()
            if source_path.is_absolute()
            else (registry_path.parent / source_path).resolve()
        )
    elif source and source.startswith(("http://", "https://")):
        url = source
    metadata = {
        key: value
        for key, value in entry.items()
        if key
        not in {
            "authors",
            "category",
            "id",
            "scheduled_tasks",
            "source",
            "source_type",
            "title",
            "year",
        }
    }
    return RegistryResource(
        key=key,
        title=title,
        kind="paper",
        category=_string(entry.get("category")),
        authors=_string_list(entry.get("authors")),
        publication_year=(int(entry["year"]) if entry.get("year") is not None else None),
        path=path,
        url=url,
        description_markdown=_description(entry),
        metadata=metadata,
    )


def load_resource_registry(path: Path) -> dict[str, RegistryResource]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except OSError as error:
        raise ResourceRegistryError(f"Cannot read resource registry {path}: {error}") from error
    except json.JSONDecodeError as error:
        raise ResourceRegistryError(f"Resource registry is not valid JSON: {error}") from error
    if not isinstance(payload, dict):
        raise ResourceRegistryError("Resource registry root must be a JSON object.")
    papers = payload.get("papers")
    if not isinstance(papers, list):
        raise ResourceRegistryError("Resource registry must contain a papers array.")
    resources: dict[str, RegistryResource] = {}
    for raw_entry in papers:
        if not isinstance(raw_entry, dict):
            raise ResourceRegistryError("Every papers entry must be a JSON object.")
        resource = _resource(raw_entry, path)
        if resource.key in resources:
            raise ResourceRegistryError(f"Duplicate resource registry id: {resource.key!r}.")
        resources[resource.key] = resource
    return resources
