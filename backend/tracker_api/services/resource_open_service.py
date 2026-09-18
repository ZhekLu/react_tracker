from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from ..config import get_settings
from .course_file_service import CourseFileError, resource_file_roots
from .drawboard_service import (
    DrawboardError,
    drawboard_deep_link,
    is_drawboard_cloud_url,
    resolve_drawboard_document_id,
)


class ResourceOpenError(RuntimeError):
    """Raised when a resource cannot be opened safely."""


def _load_config() -> dict[str, Any]:
    config_path = get_settings().helper_config_path
    if not config_path.exists():
        return {}
    try:
        payload = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ResourceOpenError(f"Cannot read helper config: {config_path}") from error
    return payload if isinstance(payload, dict) else {}


def _allowed_roots(config: dict[str, Any]) -> list[Path]:
    configured = config.get("open_allowed_roots") or config.get("allowed_open_roots")
    values = configured or [
        "~/Documents/Big Data",
        "~/Documents/Thesis",
    ]
    roots: list[Path] = []
    for value in values:
        try:
            roots.append(Path(str(value)).expanduser().resolve())
        except OSError:
            continue
    try:
        roots.extend(resource_file_roots())
    except (CourseFileError, OSError) as error:
        raise ResourceOpenError(str(error)) from error
    return roots


def _is_under_root(path: Path, roots: list[Path]) -> bool:
    return any(path == root or root in path.parents for root in roots)


def _run_open(command: list[str], label: str) -> str:
    try:
        subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        detail = getattr(error, "stderr", "") or str(error)
        message = f"Could not open resource with {label}: {detail.strip()}"
        raise ResourceOpenError(message) from error
    return label


def safe_local_resource_path(local_path: str) -> Path:
    config = _load_config()
    target = Path(local_path).expanduser().resolve()
    if not target.exists():
        raise ResourceOpenError(f"File not found: {target}")
    if not _is_under_root(target, _allowed_roots(config)):
        raise ResourceOpenError(
            f"Refusing to access a file outside configured tracker roots: {target}"
        )
    return target


def open_resource(*, local_path: str | None, source_url: str | None) -> tuple[str, str]:
    config = _load_config()
    if is_drawboard_cloud_url(source_url):
        assert source_url is not None
        try:
            document_id = resolve_drawboard_document_id(source_url)
            cloud_target = drawboard_deep_link(document_id)
        except DrawboardError as error:
            raise ResourceOpenError(str(error)) from error
        application = _run_open(["open", cloud_target], "Drawboard PDF cloud")
        return source_url, application

    if local_path:
        local_target = safe_local_resource_path(local_path)
        if local_target.suffix.lower() == ".pdf":
            pdf_app = str(config.get("pdf_app") or "").strip()
            if pdf_app:
                application = _run_open(
                    ["open", "-a", pdf_app, str(local_target)],
                    pdf_app,
                )
                return str(local_target), application
        application = _run_open(["open", str(local_target)], "system default")
        return str(local_target), application

    if source_url:
        application = _run_open(["open", source_url], "default browser")
        return source_url, application

    raise ResourceOpenError("This resource has no local path or source URL.")
