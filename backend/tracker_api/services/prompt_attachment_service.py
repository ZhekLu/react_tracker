from __future__ import annotations

import hashlib
import json
import re
import shutil
import threading
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, cast

from sqlalchemy import bindparam, text
from sqlalchemy.engine import Connection, RowMapping

from ..config import get_settings
from ..schemas.workspace import PromptBatchCreateCommand
from .chapter_scope_service import annotation_chapter_number, referenced_chapter_numbers
from .pdf_chapter_service import PdfChapterError, prepare_chapter_pdf
from .pdf_ink_image_service import annotation_image_path
from .pdf_reader_service import PdfReaderError, render_pdf_page
from .resource_open_service import ResourceOpenError, safe_local_resource_path


class PromptAttachmentError(RuntimeError):
    """Raised when the ephemeral ChatGPT attachment folder cannot be prepared."""


ATTACHMENT_LOCK = threading.Lock()
ProgressCallback = Callable[[int, str], None]
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
    kind: Literal["resource", "question_image", "manifest"]
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
        source_stat = source.stat()
        if target.is_file():
            target_stat = target.stat()
            if (
                target_stat.st_size == source_stat.st_size
                and target_stat.st_mtime_ns == source_stat.st_mtime_ns
            ):
                return target
        for candidate in destination_dir.iterdir():
            if (
                candidate == target
                or not candidate.is_file()
                or candidate.name.casefold() in used_names
            ):
                continue
            candidate_stat = candidate.stat()
            if (
                candidate_stat.st_size == source_stat.st_size
                and candidate_stat.st_mtime_ns == source_stat.st_mtime_ns
            ):
                candidate.replace(target)
                return target
    except OSError:
        pass
    try:
        shutil.copy2(source, target)
    except OSError as error:
        raise PromptAttachmentError(
            f"Could not copy prompt attachment {source} to {target}."
        ) from error
    return target


def _write_bytes(
    payload: bytes,
    destination_dir: Path,
    preferred_name: str,
    used_names: set[str],
) -> Path:
    name = _unique_name(preferred_name, used_names)
    target = destination_dir / name
    digest = hashlib.sha256(payload).digest()

    def matches(path: Path) -> bool:
        try:
            return path.is_file() and hashlib.sha256(path.read_bytes()).digest() == digest
        except OSError:
            return False

    if matches(target):
        return target
    try:
        for candidate in destination_dir.iterdir():
            if (
                candidate == target
                or candidate.name.casefold() in used_names
                or not matches(candidate)
            ):
                continue
            candidate.replace(target)
            return target
        target.write_bytes(payload)
    except OSError as error:
        raise PromptAttachmentError(
            f"Could not write prompt attachment to {target}."
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
          r.kind AS resource_kind,
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


def _annotation_chapters(
    connection: Connection,
    resource_id: str,
    *,
    annotation_ids: list[str],
    source_day_id: str | None,
) -> list[int]:
    clauses = ["a.resource_id = :resource_id", "a.deleted_at IS NULL"]
    params: dict[str, object] = {"resource_id": resource_id}
    if annotation_ids:
        clauses.append("a.id IN :annotation_ids")
        params["annotation_ids"] = annotation_ids
    elif source_day_id:
        clauses.append("json_extract(aa.selector_json, '$.createdDayId') = :source_day_id")
        params["source_day_id"] = source_day_id
    else:
        return []
    statement = text(
        f"""
        SELECT aa.section_title, aa.selector_json
        FROM annotations a
        JOIN annotation_anchors aa ON aa.annotation_id = a.id
        WHERE {' AND '.join(clauses)}
        """
    )
    if annotation_ids:
        statement = statement.bindparams(bindparam("annotation_ids", expanding=True))

    chapters: set[int] = set()
    for row in connection.execute(statement, params).mappings():
        metadata = _json_object(row["selector_json"])
        number = annotation_chapter_number(
            chapter_number=metadata.get("chapterNumber"),
            chapter_title=metadata.get("chapterTitle"),
            chapter_label=metadata.get("chapterLabel"),
            subchapter_title=metadata.get("subchapterTitle"),
            section_title=row["section_title"],
        )
        if number is not None:
            chapters.add(number)
    return sorted(chapters)


def _task_chapters(
    connection: Connection,
    resource_id: str,
    command: PromptBatchCreateCommand,
) -> list[int]:
    if command.source_task_id:
        rows = _rows(
            connection,
            """
            SELECT t.title
            FROM tasks t
            JOIN task_resources tr ON tr.task_id = t.id
            WHERE t.id = :task_id
              AND tr.resource_id = :resource_id
              AND t.deleted_at IS NULL
            """,
            {"task_id": command.source_task_id, "resource_id": resource_id},
        )
    elif command.source_day_id:
        rows = _rows(
            connection,
            """
            SELECT t.title
            FROM tasks t
            JOIN task_resources tr ON tr.task_id = t.id
            WHERE t.day_id = :day_id
              AND tr.resource_id = :resource_id
              AND t.deleted_at IS NULL
            ORDER BY t.order_index
            """,
            {"day_id": command.source_day_id, "resource_id": resource_id},
        )
    else:
        return []
    return sorted(
        {
            chapter
            for row in rows
            for chapter in referenced_chapter_numbers(str(row["title"]))
        }
    )


def _book_chapters(
    connection: Connection,
    resource_id: str,
    command: PromptBatchCreateCommand,
) -> list[int]:
    chapters = set(_task_chapters(connection, resource_id, command))
    chapters.update(
        _annotation_chapters(
            connection,
            resource_id,
            annotation_ids=command.annotation_ids,
            source_day_id=None,
        )
    )
    if command.source_day_id:
        chapters.update(
            _annotation_chapters(
                connection,
                resource_id,
                annotation_ids=[],
                source_day_id=command.source_day_id,
            )
        )
    return sorted(chapters)


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


def preview_prompt_attachments(
    connection: Connection,
    command: PromptBatchCreateCommand,
) -> tuple[int, int]:
    """Count source files and question images without touching the attachment folder."""

    resource_ids = _expand_parent_resources(
        connection,
        _prompt_resource_ids(connection, command),
    )
    resource_file_count = 0
    copied_source_paths: set[str] = set()
    for row in _resource_file_rows(connection, resource_ids):
        paths = _resource_paths(row)
        if str(row["resource_kind"]).casefold() == "book":
            has_pdf = any(path.suffix.casefold() == ".pdf" for path in paths)
            if has_pdf and _book_chapters(connection, str(row["resource_id"]), command):
                resource_file_count += 1
            continue
        for path in paths:
            key = str(path).casefold()
            if key in copied_source_paths:
                continue
            copied_source_paths.add(key)
            resource_file_count += 1

    question_image_count = sum(
        1
        for row in _question_rows(connection, command.annotation_ids)
        if _question_image_path(row) is not None
        or (
            bool(_json_object(row["selector_json"]).get("includeSlideScreenshot"))
            and row["page_number"] is not None
            and bool(_resource_paths(row))
        )
    )
    return resource_file_count, question_image_count


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


def _chapter_attachment_name(
    *,
    ordinal: int,
    resource_title: str,
    chapter_numbers: list[int],
) -> str:
    title = _sanitize_stem(resource_title, fallback="book")
    chapter_label = "-".join(str(number) for number in chapter_numbers)
    return f"R-{ordinal:02d}__{title}__chapters-{chapter_label}.pdf"


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
    progress: ProgressCallback | None = None,
) -> PreparedPromptBundle:
    """Prepare one reusable ChatGPT attachment folder for a prompt copy."""

    def notify(percent: int, stage: str) -> None:
        if progress is not None:
            progress(percent, stage)

    destination = get_settings().chatgpt_attachment_dir.expanduser().resolve()
    attachments: list[PreparedPromptAttachment] = []
    warnings: list[str] = []
    used_names: set[str] = set()

    with ATTACHMENT_LOCK:
        notify(3, "Inspecting the day and selected questions")
        try:
            destination.mkdir(parents=True, exist_ok=True)
        except OSError as error:
            raise PromptAttachmentError(
                f"Could not prepare ChatGPT attachment folder: {destination}"
            ) from error

        resource_ids = _expand_parent_resources(
            connection,
            _prompt_resource_ids(connection, command),
        )
        resource_ordinal = 0
        copied_source_paths: set[str] = set()
        resource_rows = _resource_file_rows(connection, resource_ids)
        question_rows = _question_rows(connection, command.annotation_ids)
        total_work = max(1, len(resource_rows) + len(question_rows))
        completed_work = 0
        for row in resource_rows:
            if command.attachment_limit and len(attachments) >= command.attachment_limit:
                break
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
                completed_work += 1
                continue

            if str(row["resource_kind"]).casefold() == "book":
                chapter_numbers = _book_chapters(
                    connection,
                    str(row["resource_id"]),
                    command,
                )
                source = next(
                    (path for path in paths if path.suffix.casefold() == ".pdf"),
                    None,
                )
                if source is None:
                    warnings.append(
                        f"{row['resource_title']}: no local PDF is available for "
                        "a chapter-only attachment."
                    )
                elif not chapter_numbers:
                    warnings.append(
                        f"{row['resource_title']}: no chapter could be inferred from "
                        "this study day, so the full book was intentionally not copied."
                    )
                else:
                    resource_ordinal += 1
                    preferred_name = _chapter_attachment_name(
                        ordinal=resource_ordinal,
                        resource_title=str(row["resource_title"]),
                        chapter_numbers=chapter_numbers,
                    )
                    target = destination / _unique_name(preferred_name, used_names)
                    try:
                        prepare_chapter_pdf(source, target, chapter_numbers)
                    except PdfChapterError as error:
                        warnings.append(f"{row['resource_title']}: {error}")
                        used_names.discard(target.name.casefold())
                    else:
                        attachments.append(
                            PreparedPromptAttachment(
                                name=target.name,
                                kind="resource",
                                path=str(target),
                                resource_id=str(row["resource_id"]),
                            )
                        )
                completed_work += 1
                notify(
                    10 + round(75 * completed_work / total_work),
                    "Preparing chapter PDFs and source files",
                )
                continue

            for source in paths:
                if command.attachment_limit and len(attachments) >= command.attachment_limit:
                    break
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
            completed_work += 1
            notify(
                10 + round(75 * completed_work / total_work),
                "Preparing chapter PDFs and source files",
            )

        for index, row in enumerate(
            question_rows,
            start=1,
        ):
            if command.attachment_limit and len(attachments) >= command.attachment_limit:
                break
            image_bytes = _question_image_bytes(row)
            if image_bytes is None:
                completed_work += 1
                continue
            annotation_id = str(row["annotation_id"])
            question_label = command.question_labels.get(
                annotation_id,
                f"Q-{command.question_label_start + index - 1:03d}",
            )
            preferred_name = _question_attachment_name(
                question_label=question_label,
                resource_title=str(row["resource_title"]),
                page_number=(
                    int(row["page_number"])
                    if row["page_number"] is not None
                    else None
                ),
            )
            target = _write_bytes(
                image_bytes,
                destination,
                preferred_name,
                used_names,
            )
            attachments.append(
                PreparedPromptAttachment(
                    name=target.name,
                    kind="question_image",
                    path=str(target),
                    resource_id=str(row["resource_id"]),
                    annotation_id=annotation_id,
                    question_label=question_label,
                )
            )
            completed_work += 1
            notify(
                10 + round(75 * completed_work / total_work),
                "Reusing or preparing question screenshots",
            )

        if command.attachment_limit and (
            len(resource_rows) + len(question_rows) > command.attachment_limit
        ):
            warnings.append(
                f"Attachment package was limited to the first {command.attachment_limit} files."
            )

        notify(90, "Writing the attachment manifest")
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
        used_names.add(manifest_path.name.casefold())

        notify(94, "Removing files not used by this prompt")
        try:
            for child in destination.iterdir():
                if child.name.casefold() in used_names:
                    continue
                if child.is_dir() and not child.is_symlink():
                    shutil.rmtree(child)
                else:
                    child.unlink()
        except OSError as error:
            raise PromptAttachmentError(
                f"Could not clean unused prompt attachments in {destination}."
            ) from error

    prompt_attachments = [item for item in attachments if item.kind != "manifest"]
    notify(97, "Saving the copied prompt")
    return PreparedPromptBundle(
        markdown=_append_attachment_section(command.markdown, prompt_attachments),
        directory=str(destination),
        attachments=attachments,
        warnings=warnings,
    )
