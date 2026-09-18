from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..config import get_settings

ALLOWED_SUFFIXES = {
    ".c",
    ".cpp",
    ".csv",
    ".ipynb",
    ".java",
    ".json",
    ".md",
    ".m",
    ".py",
    ".r",
    ".rs",
    ".sh",
    ".tex",
    ".toml",
    ".ts",
    ".tsx",
    ".yaml",
    ".yml",
}
IGNORED_PARTS = {
    ".git",
    ".idea",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "__pycache__",
    "node_modules",
}


class CourseFileError(RuntimeError):
    """Raised when a configured course file cannot be listed or opened."""


@dataclass(frozen=True)
class CourseFile:
    id: str
    name: str
    relative_path: str
    root_name: str


def _config() -> tuple[Path, dict[str, Any]]:
    path = get_settings().course_files_config_path
    if not path.exists():
        return path, {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise CourseFileError(f"Cannot read course file config: {path}") from error
    return path, payload if isinstance(payload, dict) else {}


def _roots(short_code: str) -> list[Path]:
    config_path, config = _config()
    configured = config.get("course_file_roots")
    if not isinstance(configured, dict):
        return []
    values = configured.get(short_code) or configured.get(short_code.casefold())
    if not isinstance(values, list):
        return []
    roots: list[Path] = []
    for value in values:
        candidate = Path(str(value)).expanduser()
        if not candidate.is_absolute():
            candidate = config_path.parent / candidate
        try:
            resolved = candidate.resolve()
        except OSError:
            continue
        if resolved.is_dir():
            roots.append(resolved)
    return roots


def resource_file_roots() -> list[Path]:
    """Additional explicitly allowed PDF/resource directories (including iCloud)."""

    config_path, config = _config()
    values = config.get("resource_file_roots", [])
    if not isinstance(values, list) or any(
        not isinstance(value, str) or not value.strip() for value in values
    ):
        raise CourseFileError("resource_file_roots must be a list of directory paths.")
    roots: list[Path] = []
    for value in values:
        candidate = Path(value).expanduser()
        if not candidate.is_absolute():
            candidate = config_path.parent / candidate
        roots.append(candidate.resolve())
    return roots


def discussion_export_root(short_code: str) -> Path | None:
    """Return the configured Markdown export directory for a course."""

    config_path, config = _config()
    configured = config.get("discussion_export_roots")
    if not isinstance(configured, dict):
        return None
    value = configured.get(short_code) or configured.get(short_code.casefold())
    if not isinstance(value, str) or not value.strip():
        return None
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        candidate = config_path.parent / candidate
    try:
        resolved = candidate.resolve()
        resolved.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise CourseFileError(
            f"Cannot prepare discussion export directory: {candidate}"
        ) from error
    return resolved


def book_chapter_titles(metadata: dict[str, Any], title: str) -> list[str]:
    """Return configured chapter titles using a stable plan id or resource title."""

    _config_path, config = _config()
    configured = config.get("book_chapters")
    if not isinstance(configured, dict):
        return []
    keys = [metadata.get("plan_resource_id"), title]
    for key in keys:
        if not isinstance(key, str):
            continue
        values = configured.get(key) or configured.get(key.casefold())
        if isinstance(values, list):
            return [str(value).strip() for value in values if str(value).strip()]
    return []


def _course_files(short_code: str) -> tuple[list[Path], list[CourseFile]]:
    roots = _roots(short_code)
    records: list[CourseFile] = []
    for root_index, root in enumerate(roots):
        for path in sorted(root.rglob("*")):
            if (
                not path.is_file()
                or path.suffix.lower() not in ALLOWED_SUFFIXES
                or any(part in IGNORED_PARTS for part in path.parts)
            ):
                continue
            relative_path = path.relative_to(root).as_posix()
            records.append(
                CourseFile(
                    id=f"{root_index}:{relative_path}",
                    name=path.name,
                    relative_path=relative_path,
                    root_name=root.name,
                )
            )
    return roots, records


def list_course_files(short_code: str) -> list[CourseFile]:
    return _course_files(short_code)[1]


def open_course_file(short_code: str, file_id: str) -> tuple[Path, str]:
    roots, records = _course_files(short_code)
    record = next((item for item in records if item.id == file_id), None)
    if record is None:
        raise CourseFileError("The requested file is not in this course workspace.")
    root_index_text, _separator, relative_path = file_id.partition(":")
    try:
        root = roots[int(root_index_text)]
    except (ValueError, IndexError) as error:
        raise CourseFileError("The course file root is no longer available.") from error
    target = (root / relative_path).resolve()
    if root not in target.parents or not target.is_file():
        raise CourseFileError("Refusing to open a file outside the configured root.")
    try:
        subprocess.run(
            ["open", str(target)],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (
        FileNotFoundError,
        subprocess.CalledProcessError,
        subprocess.TimeoutExpired,
    ) as error:
        detail = getattr(error, "stderr", "") or str(error)
        raise CourseFileError(
            f"Could not open {target.name}: {detail.strip()}"
        ) from error
    return target, "system default"
