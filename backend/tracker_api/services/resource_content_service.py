from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from .resource_open_service import ResourceOpenError, safe_local_resource_path

READABLE_SUFFIXES = {
    ".csv",
    ".htm",
    ".html",
    ".json",
    ".md",
    ".markdown",
    ".py",
    ".tex",
    ".txt",
}
MAX_RESOURCE_BYTES = 12 * 1024 * 1024


@dataclass(frozen=True)
class ResourceTextContent:
    path: Path
    format: Literal["markdown", "html", "text"]
    content: str


def _format(path: Path) -> Literal["markdown", "html", "text"]:
    suffix = path.suffix.lower()
    if suffix in {".htm", ".html"}:
        return "html"
    if suffix in {".md", ".markdown"}:
        return "markdown"
    return "text"


def read_resource_content(local_path: str | None) -> ResourceTextContent:
    if not local_path:
        raise ResourceOpenError("This resource has no readable local file.")
    path = safe_local_resource_path(local_path)
    if path.suffix.lower() not in READABLE_SUFFIXES:
        raise ResourceOpenError(
            f"{path.suffix or 'This file type'} is not supported by the in-app reader."
        )
    try:
        size = path.stat().st_size
    except OSError as error:
        raise ResourceOpenError(f"Cannot inspect resource: {path}") from error
    if size > MAX_RESOURCE_BYTES:
        raise ResourceOpenError(
            f"Resource is too large for the in-app reader ({size} bytes)."
        )
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        try:
            content = path.read_text(encoding="latin-1")
        except OSError as error:
            raise ResourceOpenError(f"Cannot read resource: {path}") from error
    except OSError as error:
        raise ResourceOpenError(f"Cannot read resource: {path}") from error
    return ResourceTextContent(path=path, format=_format(path), content=content)
