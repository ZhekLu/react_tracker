from __future__ import annotations

import json
import re
import shutil
import threading
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

from sqlalchemy import bindparam, text
from sqlalchemy.engine import Connection, RowMapping

from ..config import get_settings
from ..schemas.workspace import PromptBatchCreateCommand
from .pdf_ink_image_service import annotation_image_path
from .pdf_reader_service import PdfReaderError, render_pdf_page
from .resource_open_service import ResourceOpenError, safe_local_resource_path


class PromptAttachmentError(RuntimeError):
    """Raised when the ephemeral ChatGPT attachment folder cannot be prepared."""


_ATTACHMENT_LOCK = threading.Lock()
_SAFE_FILENAME = re.compile(r"[^A-Za-z0-9._ -]+")
_WHITESPACE = re.compile(r"\s+")
_WINDOWS_RESERVED = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}


@dataclass(frozen=True, slots=True)
class PreparedPromptAttachment:
    name: str
    kind: str
    path: str
    resource_id: str | None = None
    annotation_id: str | None = None
    question_label: str | None = None


@dataclass(frozen=True, slots=True)
class PreparedPromptBundle:
    markdown: str
    directory: str
    attachments: list[PreparedPromptAttachment]
    warnings: list[str]


def _json_object(value: object) -> dict[str, Any]:
    if isinstance(value, dict):
        return cast(dict[str, Any], value)
    if not isinstance(value, str) or not value.strip():
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return cast(dict[str, Any], parsed) if isinstance(parsed, dict) else {}


def _json_list(value: object) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    if not isinstance(value, str) or not value.strip():
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [str(item) for item in parsed if str(item).strip()]


def _rows(
    connection: Connection,
    statement: str,
    params: dict[str, object] | None = None,
) -> list[RowMapping]:
    return list(connection.execute(text(statement), params or {}).mappings())


def _sanitize_stem(value: str, *, fallback: str) -> str:
    cleaned = _SAFE_FILENAME.sub("-", value or "")
    cleaned = _WHITESPACE.sub("-", cleaned).strip(" .-_")
    cleaned = re.sub(r"-+", "-", cleaned)
    if not cleaned:
        cleaned = fallback
    if cleaned.upper() in _WINDOWS_RESERVED:
        cleaned = f"{cleaned}-file"
    return cleaned[:90].rstrip(" .-_") or fallback


def _unique_name(
    preferred: str,
    used_names: set[str],
) -> str:
    candidate = preferred
    stem = Path(preferred).stem
    suffix = Path(preferred).suffix
    index = 2
    while candidate.casefold() in used_names:
        candidate = f"{stem}-{index}{suffix}"
        index += 1
    used_names.add(candidate.casefold())
    return candidate


def _copy_file(
    source: Path,
    destination_dir: Path,
    preferred_name: str,
    used_names: set[str],
) -> Path:
    name = _unique_name(preferred_name, used_names)
    target = destination_dir / name
    try:
        shutil.copy2(source, target)
    except OSError as error:
        raise PromptAttachmentError(
            f"Could not copy prompt attachment {source} to {target}."
        ) from error
    return target


def _annotation_resource_ids(
    connection: Connection,
    annotation_ids: Iterable[str],
) -> list[str]:
    values = list(dict.fromkeys(annotation_ids))
    if not values:
        return []
    statement = text(
        """
        SELECT DISTINCT resource_id
        FROM annotations
        WHERE id IN :annotation_ids
          AND deleted_at IS NULL
        """
    ).bindparams(bindparam("annotation_ids", expanding=True))
    return [
        str(row["resource_id"])
        for row in connection.execute(
            statement,
            {"annotation_ids": values},
        ).mappings()
    ]


def _task_resource_ids(connection: Connection, task_id: str | None) -> list[str]:
    if not task_id:
        return []
    return [
        str(row["resource_id"])
        for row in _rows(
            connection,
            """
            SELECT DISTINCT tr.resource_id
            FROM task_resources tr
            JOIN tasks t ON t.id = tr.task_id
            JOIN resources r ON r.id = tr.resource_id
            WHERE tr.task_id = :task_id
              AND t.deleted_at IS NULL
              AND r.deleted_at IS NULL
            ORDER BY tr.order_index, r.title
            """,
            {"task_id": task_id},
        )
    ]


def _day_resource_ids(connection: Connection, day_id: str | None) -> list[str]:
    if not day_id:
        return []
    return [
        str(row["resource_id"])
        for row in _rows(
            connection,
            """
            SELECT DISTINCT tr.resource_id, MIN(t.order_index) AS task_order,
                            MIN(tr.order_index) AS resource_order
            FROM tasks t
            JOIN task_resources tr ON tr.task_id = t.id
            JOIN resources r ON r.id = tr.resource_id
            WHERE t.day_id = :day_id
              AND t.deleted_at IS NULL
              AND r.deleted_at IS NULL
            GROUP BY tr.resource_id
            ORDER BY task_order, resource_order, r.title
            """,
            {"day_id": day_id},
        )
    ]


def _prompt_resource_ids(
    connection: Connection,
    command: PromptBatchCreateCommand,
) -> list[str]:
    ordered = [
        *([command.source_resource_id] if command.source_resource_id else []),
        *_task_resource_ids(connection, command.source_task_id),
        *_day_resource_ids(connection, command.source_day_id),
        *_annotation_resource_ids(connection, command.annotation_ids),
    ]
    return list(dict.fromkeys(ordered))


def _expand_parent_resources(
    connection: Connection,
    resource_ids: list[str],
) -> list[str]:
    if not resource_ids:
        return []
    statement = text(
        """
        SELECT id, parent_resource_id
        FROM resources
        WHERE id IN :resource_ids
          AND deleted_at IS NULL
        """
    ).bindparams(bindparam("resource_ids", expanding=True))
    rows = list(
        connection.execute(
            statement,
            {"resource_ids": resource_ids},
        ).mappings()
    )
    parents = [
        str(row["parent_resource_id"])
        for row in rows
        if row["parent_resource_id"]
    ]
    return list(dict.fromkeys([*resource_ids, *parents]))


def _resource_file_rows(
    connection: Connection,
    resource_ids: list[str],
) -> list[RowMapping]:
    if not resource_ids:
        return []
    statement = text(
        """
        SELECT
          r.id AS resource_id,
          r.title AS resource_title,
          r.metadata_json,
          rv.local_path AS current_local_path,
          rv.file_name AS current_file_name
        FROM resources r
        LEFT JOIN resource_versions rv ON rv.id = r.current_version_id
        WHERE r.id IN :resource_ids
          AND r.deleted_at IS NULL
        ORDER BY r.title, r.id
        """
    ).bindparams(bindparam("resource_ids", expanding=True))
    return list(
        connection.execute(
            statement,
            {"resource_ids": resource_ids},
        ).mappings()
    )


def _resource_paths(row: RowMapping) -> list[Path]:
    candidates: list[str] = []
    if row["current_local_path"]:
        candidates.append(str(row["current_local_path"]))
    metadata = _json_object(row["metadata_json"])
    candidates.extend(_json_list(metadata.get("local_paths")))

    paths: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        try:
            path = safe_local_resource_path(candidate)
        except ResourceOpenError:
            continue
        key = str(path).casefold()
        if key in seen or not path.is_file():
            continue
        seen.add(key)
        paths.append(path)
    return paths


def _question_rows(
    connection: Connection,
    annotation_ids: list[str],
) -> list[RowMapping]:
    if not annotation_ids:
        return []
    statement = text(
        """
        SELECT
          a.id AS annotation_id,
          a.resource_id,
          a.source_fingerprint,
          a.origin,
          aa.page_number,
          aa.annotation_kind,
          aa.selector_json,
          r.title AS resource_title,
          r.metadata_json,
          rv.local_path AS current_local_path,
          rv.file_name AS current_file_name
        FROM annotations a
        JOIN resources r ON r.id = a.resource_id
        LEFT JOIN resource_versions rv ON rv.id = r.current_version_id
        LEFT JOIN annotation_anchors aa ON aa.annotation_id = a.id
        WHERE a.id IN :annotation_ids
          AND a.deleted_at IS NULL
          AND r.deleted_at IS NULL
        """
    ).bindparams(bindparam("annotation_ids", expanding=True))
    rows_by_id = {
        str(row["annotation_id"]): row
        for row in connection.execute(
            statement,
            {"annotation_ids": annotation_ids},
        ).mappings()
    }
    return [rows_by_id[item] for item in annotation_ids if item in rows_by_id]


def _question_image_path(row: RowMapping) -> Path | None:
    metadata = _json_object(row["selector_json"])
    context_image_url = str(metadata.get("contextImageUrl") or "")
    fingerprint = str(row["source_fingerprint"] or "")

    image_id = ""
    if context_image_url:
        match = re.search(r"/annotation-images/([^/?#]+)", context_image_url)
        if match:
            image_id = match.group(1)
    if not image_id and row["annotation_kind"] == "Ink":
        image_id = fingerprint
    if not image_id:
        return None
    try:
        path = annotation_image_path(str(row["resource_id"]), image_id)
    except Exception:
        return None
    return path if path.is_file() else None


def _question_image_bytes(row: RowMapping) -> bytes | None:
    image_path = _question_image_path(row)
    if image_path is not None:
        try:
            return image_path.read_bytes()
        except OSError:
            return None

    metadata = _json_object(row["selector_json"])
    if not metadata.get("includeSlideScreenshot") or row["page_number"] is None:
        return None
    paths = _resource_paths(row)
    if not paths:
        return None
    try:
        return render_pdf_page(str(paths[0]), int(row["page_number"]))
    except PdfReaderError:
        return None


def _resource_attachment_name(
    *,
    ordinal: int,
    resource_title: str,
    source: Path,
) -> str:
    title = _sanitize_stem(resource_title, fallback="resource")
    original = _sanitize_stem(source.stem, fallback="file")
    suffix = source.suffix.lower()
    stem = (
        title
        if original.casefold() == title.casefold()
        else f"{title}__{original}"
    )
    return f"R-{ordinal:02d}__{stem}{suffix}"


def _question_attachment_name(
    *,
    question_label: str,
    resource_title: str,
    page_number: int | None,
) -> str:
    title = _sanitize_stem(resource_title, fallback="resource")
    page = f"__p-{page_number}" if page_number else ""
    return f"{question_label}__{title}{page}__handwriting.png"


def _render_manifest(
    attachments: list[PreparedPromptAttachment],
    warnings: list[str],
) -> str:
    resources = [item for item in attachments if item.kind == "resource"]
    screenshots = [item for item in attachments if item.kind == "question_image"]
    lines = [
        "# ChatGPT prompt attachments",
        "",
        "Upload the relevant files together with the copied prompt.",
    ]
    if screenshots:
        lines += ["", "## Question screenshots", ""]
        for item in screenshots:
            lines.append(
                f"- `{item.name}` — screenshot for {item.question_label or 'a question'}"
            )
    if resources:
        lines += ["", "## Source resources", ""]
        for item in resources:
            lines.append(f"- `{item.name}`")
    if warnings:
        lines += ["", "## Files not copied", ""]
        lines.extend(f"- {warning}" for warning in warnings)
    return "\n".join(lines).rstrip() + "\n"


def _append_attachment_section(
    markdown: str,
    attachments: list[PreparedPromptAttachment],
) -> str:
    if not attachments:
        return markdown
    resources = [item for item in attachments if item.kind == "resource"]
    screenshots = [item for item in attachments if item.kind == "question_image"]
    lines = [
        "## Attached files",
        "",
        "I will upload the following files from the prepared attachment folder. "
        "Use them as source material and keep each screenshot associated with its "
        "matching question label.",
    ]
    if screenshots:
        lines += ["", "### Question screenshots", ""]
        lines.extend(
            f"- `{item.name}` → {item.question_label}"
            for item in screenshots
        )
    if resources:
        lines += ["", "### Resource files", ""]
        lines.extend(f"- `{item.name}`" for item in resources)
    return f"{markdown.rstrip()}\n\n" + "\n".join(lines).rstrip() + "\n"


def prepare_prompt_attachments(
    connection: Connection,
    command: PromptBatchCreateCommand,
) -> PreparedPromptBundle:
    """Rebuild the single-use ChatGPT attachment folder for a prompt copy.

    The folder is intentionally ephemeral: every prompt preparation removes the
    previous contents. Source files come from the prompt's day/task/resource and
    from resources owning the selected questions. Red-ink screenshots are named
    after the exact Q-xxx labels used by the prompt batch.
    """

    destination = get_settings().chatgpt_attachment_dir.expanduser().resolve()
    attachments: list[PreparedPromptAttachment] = []
    warnings: list[str] = []
    used_names: set[str] = set()

    with _ATTACHMENT_LOCK:
        try:
            if destination.exists():
                for child in destination.iterdir():
                    if child.is_dir() and not child.is_symlink():
                        shutil.rmtree(child)
                    else:
                        child.unlink()
            else:
                destination.mkdir(parents=True, exist_ok=True)
        except OSError as error:
            raise PromptAttachmentError(
                f"Could not reset ChatGPT attachment folder: {destination}"
            ) from error

        resource_ids = _expand_parent_resources(
            connection,
            _prompt_resource_ids(connection, command),
        )
        resource_ordinal = 0
        copied_source_paths: set[str] = set()
        for row in _resource_file_rows(connection, resource_ids):
            paths = _resource_paths(row)
            if not paths:
                metadata = _json_object(row["metadata_json"])
                had_configured_path = bool(
                    row["current_local_path"] or metadata.get("local_paths")
                )
                if had_configured_path:
                    warnings.append(
                        f"{row['resource_title']}: configured local file is missing "
                        "or outside the allowed resource roots."
                    )
                continue
            for source in paths:
                source_key = str(source).casefold()
                if source_key in copied_source_paths:
                    continue
                copied_source_paths.add(source_key)
                resource_ordinal += 1
                preferred_name = _resource_attachment_name(
                    ordinal=resource_ordinal,
                    resource_title=str(row["resource_title"]),
                    source=source,
                )
                target = _copy_file(source, destination, preferred_name, used_names)
                attachments.append(
                    PreparedPromptAttachment(
                        name=target.name,
                        kind="resource",
                        path=str(target),
                        resource_id=str(row["resource_id"]),
                    )
                )

        for index, row in enumerate(
            _question_rows(connection, command.annotation_ids),
            start=1,
        ):
            image_bytes = _question_image_bytes(row)
            if image_bytes is None:
                continue
            question_label = f"Q-{index:03d}"
            preferred_name = _question_attachment_name(
                question_label=question_label,
                resource_title=str(row["resource_title"]),
                page_number=(
                    int(row["page_number"])
                    if row["page_number"] is not None
                    else None
                ),
            )
            target = destination / _unique_name(preferred_name, used_names)
            try:
                target.write_bytes(image_bytes)
            except OSError as error:
                raise PromptAttachmentError(
                    f"Could not write question screenshot to {target}."
                ) from error
            attachments.append(
                PreparedPromptAttachment(
                    name=target.name,
                    kind="question_image",
                    path=str(target),
                    resource_id=str(row["resource_id"]),
                    annotation_id=str(row["annotation_id"]),
                    question_label=question_label,
                )
            )

        manifest_path = destination / "README.md"
        try:
            manifest_path.write_text(
                _render_manifest(attachments, warnings),
                encoding="utf-8",
            )
        except OSError as error:
            raise PromptAttachmentError(
                f"Could not write attachment manifest: {manifest_path}"
            ) from error
        attachments.append(
            PreparedPromptAttachment(
                name=manifest_path.name,
                kind="manifest",
                path=str(manifest_path),
            )
        )

    prompt_attachments = [item for item in attachments if item.kind != "manifest"]
    return PreparedPromptBundle(
        markdown=_append_attachment_section(command.markdown, prompt_attachments),
        directory=str(destination),
        attachments=attachments,
        warnings=warnings,
    )
