from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path

from .course_file_service import CourseFileError, discussion_export_root

_EXPORT_TAG = re.compile(
    r"<(?P<tag>[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+)>\s*"
    r"(?P<content>.*?)\s*</(?P=tag)>",
    flags=re.DOTALL,
)


def _message_section_pattern(message_id: str) -> re.Pattern[str]:
    escaped = re.escape(message_id)
    return re.compile(
        rf"\n?<!-- tracker-export:{escaped}:[^:]+:\d+:start -->\n"
        rf".*?\n<!-- tracker-export:{escaped}:[^:]+:\d+:end -->\n?",
        flags=re.DOTALL,
    )


def _write_atomic(path: Path, markdown: str) -> None:
    temporary = path.with_name(f".{path.name}.tmp")
    try:
        temporary.write_text(markdown, encoding="utf-8")
        temporary.replace(path)
    except OSError as error:
        temporary.unlink(missing_ok=True)
        raise CourseFileError(f"Cannot write discussion export: {path}") from error


def sync_discussion_exports(
    *,
    short_code: str,
    message_id: str,
    markdown: str,
) -> list[Path]:
    """Synchronize tagged message blocks into course-local Markdown files.

    Tracker-owned comment markers make repeated saves idempotent while leaving
    any hand-written content in the destination file untouched.
    """

    root = discussion_export_root(short_code)
    if root is None:
        return []

    section_pattern = _message_section_pattern(message_id)
    for path in root.glob("*.md"):
        try:
            current = path.read_text(encoding="utf-8")
        except OSError as error:
            raise CourseFileError(f"Cannot read discussion export: {path}") from error
        cleaned = section_pattern.sub("\n", current).rstrip()
        if cleaned != current.rstrip():
            _write_atomic(path, f"{cleaned}\n" if cleaned else "")

    blocks_by_tag: dict[str, list[str]] = defaultdict(list)
    for match in _EXPORT_TAG.finditer(markdown):
        content = match.group("content").strip()
        if content:
            blocks_by_tag[match.group("tag")].append(content)

    exported: list[Path] = []
    for tag, blocks in blocks_by_tag.items():
        path = root / f"{tag}.md"
        try:
            existing = path.read_text(encoding="utf-8").rstrip() if path.exists() else ""
        except OSError as error:
            raise CourseFileError(f"Cannot read discussion export: {path}") from error
        sections = []
        for index, content in enumerate(blocks, start=1):
            marker = f"tracker-export:{message_id}:{tag}:{index}"
            sections.append(
                f"<!-- {marker}:start -->\n{content}\n<!-- {marker}:end -->"
            )
        combined = "\n\n".join(part for part in [existing, *sections] if part)
        _write_atomic(path, f"{combined}\n")
        exported.append(path)
    return exported
