from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from ..config import get_settings


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
    if local_path:
        target = safe_local_resource_path(local_path)
        if target.suffix.lower() == ".pdf":
            pdf_app = str(config.get("pdf_app") or "").strip()
            if pdf_app:
                application = _run_open(["open", "-a", pdf_app, str(target)], pdf_app)
                return str(target), application
        application = _run_open(["open", str(target)], "system default")
        return str(target), application

    if source_url:
        application = _run_open(["open", source_url], "default browser")
        return source_url, application

    raise ResourceOpenError("This resource has no local path or source URL.")
