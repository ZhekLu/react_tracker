from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

import pymupdf
from sqlalchemy import text
from sqlalchemy.engine import Connection

from ..repositories import workspace_repository
from ..schemas.workspace import (
    AnnotationAnchorCreate,
    AnnotationCreateCommand,
    AnnotationKind,
)
from .chapter_scope_service import referenced_chapter_numbers
from .drawboard_service import (
    DrawboardCapture,
    DrawboardError,
    DrawboardInk,
    extract_drawboard_annotations,
    is_drawboard_cloud_url,
)
from .pdf_context_service import (
    PdfAnnotationContext,
    PdfContextError,
    extract_pdf_annotation_contexts,
)
from .pdf_ink_image_service import (
    INK_RENDERER_VERSION,
    PdfInkImageError,
    render_annotated_page_images,
    render_ink_context_images,
)
from .resource_open_service import ResourceOpenError, safe_local_resource_path

MARKUP_KINDS = {"Highlight", "Underline", "Squiggly", "StrikeOut"}


class PdfAnnotationError(RuntimeError):
    """Raised when PDF annotations cannot be collected safely."""


@dataclass(frozen=True, slots=True)
class PdfCapture:
    fingerprint: str
    page: int
    annotation_kind: str
    color: str
    rgb: list[float]
    quote: str
    comment: str
    is_question: bool
    created_at: str
    rect: list[float]


@dataclass(frozen=True, slots=True)
class PdfExtraction:
    path: Path
    captures: list[PdfCapture]
    ignored: dict[str, int]


@dataclass(frozen=True, slots=True)
class PdfCollection:
    resource_id: str
    path: str
    extracted_count: int
    created_count: int
    updated_count: int
    existing_count: int
    removed_count: int
    ignored: dict[str, int]
    kind_counts: dict[str, int]

    @property
    def ignored_count(self) -> int:
        return sum(self.ignored.values())


def _chapter_study_days(
    connection: Connection,
    resource_id: str,
) -> dict[int, str]:
    """Map a book chapter to its first explicit study-plan day."""

    rows = connection.execute(
        text(
            """
            SELECT d.id AS day_id, d.number AS day_number, t.title
            FROM study_days d
            JOIN tasks t ON t.day_id = d.id
            JOIN task_resources tr ON tr.task_id = t.id
            JOIN resources r ON r.id = tr.resource_id
            WHERE tr.resource_id = :resource_id
              AND r.kind = 'book'
              AND d.deleted_at IS NULL
              AND t.deleted_at IS NULL
            ORDER BY d.number, t.order_index
            """
        ),
        {"resource_id": resource_id},
    ).mappings()
    study_days: dict[int, str] = {}
    for row in rows:
        for chapter in referenced_chapter_numbers(str(row["title"])):
            study_days.setdefault(chapter, str(row["day_id"]))
    return study_days


def _capture_study_day(
    context: PdfAnnotationContext | None,
    chapter_study_days: dict[int, str],
    fallback_day_id: str | None,
) -> str | None:
    if context is not None and context.chapter_number is not None:
        return chapter_study_days.get(context.chapter_number, fallback_day_id)
    return fallback_day_id


def _utc_now_iso() -> str:
    return (
        datetime.now(UTC)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z")
    )


def _parse_pdf_date(value: str) -> str:
    match = re.match(
        r"D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})",
        value or "",
    )
    if not match:
        return _utc_now_iso()
    year, month, day, hour, minute, second = map(int, match.groups())
    try:
        parsed = datetime(
            year,
            month,
            day,
            hour,
            minute,
            second,
            tzinfo=UTC,
        )
    except ValueError:
        return _utc_now_iso()
    return parsed.isoformat(timespec="seconds").replace("+00:00", "Z")


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def _annotation_color(annotation: Any) -> tuple[str, list[float]]:
    colors = annotation.colors or {}
    raw_rgb = colors.get("stroke") or colors.get("fill") or []
    if len(raw_rgb) < 3:
        return "", []
    rgb = [float(part) for part in raw_rgb[:3]]
    red, green, blue = rgb
    if red >= 0.85 and green <= 0.55 and blue <= 0.65:
        return "red", rgb
    if red >= 0.85 and green >= 0.75 and blue <= 0.55:
        return "yellow", rgb
    if red <= 0.35 and green >= 0.75 and blue >= 0.75:
        return "cyan", rgb
    if green >= 0.55 and red <= 0.55:
        return "green", rgb
    if blue >= 0.55 and red <= 0.55:
        return "blue", rgb
    return "custom", rgb


def _fingerprint(
    path: Path,
    page: int,
    kind: str,
    content: str,
    color: str,
    rect: list[float],
    modified: str,
) -> str:
    payload = {
        "path": str(path),
        "page": page,
        "kind": kind,
        "content": content,
        "color": color,
        "rect": [round(value, 2) for value in rect],
        "modified": modified,
    }
    digest = hashlib.sha1(
        json.dumps(payload, sort_keys=True, ensure_ascii=True).encode("utf-8"),
        usedforsecurity=False,
    ).hexdigest()
    return f"pdf-{digest[:24]}"


def _capture_from_annotation(
    *,
    annotation: Any,
    page: Any,
    page_number: int,
    path: Path,
) -> PdfCapture | None:
    annotation_kind = str(annotation.type[1])
    if annotation_kind == "Ink":
        return None
    info = annotation.info or {}
    content = _normalize_text(str(info.get("content") or ""))
    if not content and annotation_kind in MARKUP_KINDS:
        content = _normalize_text(page.get_textbox(annotation.rect))
    if not content:
        return None
    color, rgb = _annotation_color(annotation)
    rect = [float(value) for value in annotation.rect]
    modified = str(info.get("modDate") or info.get("creationDate") or "")
    is_markup = annotation_kind in MARKUP_KINDS
    return PdfCapture(
        fingerprint=_fingerprint(
            path,
            page_number,
            annotation_kind,
            content,
            color,
            rect,
            modified,
        ),
        page=page_number,
        annotation_kind=annotation_kind,
        color=color,
        rgb=rgb,
        quote=content if is_markup else "",
        comment="" if is_markup else content,
        is_question=(
            color == "red"
            or "??" in content
            or "todo!" in content.casefold()
        ),
        created_at=_parse_pdf_date(
            str(info.get("creationDate") or modified)
        ),
        rect=rect,
    )


def extract_pdf_annotations(path: Path) -> PdfExtraction:
    pdf_path = path.expanduser().resolve()
    if not pdf_path.exists():
        raise PdfAnnotationError(f"PDF not found: {pdf_path}")
    if pdf_path.suffix.casefold() != ".pdf":
        raise PdfAnnotationError(f"Not a PDF: {pdf_path}")

    captures: list[PdfCapture] = []
    ignored: dict[str, int] = {}
    try:
        document: Any = pymupdf.open(  # type: ignore[no-untyped-call]
            pdf_path
        )
    except Exception as error:
        raise PdfAnnotationError(f"Could not open PDF: {pdf_path}") from error
    try:
        pages = cast(Iterable[Any], document)
        for page_index, page in enumerate(pages):
            annotation = page.first_annot
            while annotation:
                annotation_kind = str(annotation.type[1])
                capture = _capture_from_annotation(
                    annotation=annotation,
                    page=page,
                    page_number=page_index + 1,
                    path=pdf_path,
                )
                if capture is None:
                    ignored[annotation_kind] = ignored.get(annotation_kind, 0) + 1
                else:
                    captures.append(capture)
                annotation = annotation.next
    finally:
        document.close()

    captures.sort(
        key=lambda capture: (
            capture.page,
            capture.rect[1],
            capture.rect[0],
            capture.annotation_kind,
        )
    )
    return PdfExtraction(path=pdf_path, captures=captures, ignored=ignored)


def _annotation_command(
    resource_id: str,
    source_path: Path,
    capture: PdfCapture,
    context: PdfAnnotationContext | None,
    sync_revision: str,
    source_day_id: str | None = None,
) -> AnnotationCreateCommand:
    kind: AnnotationKind = (
        "question"
        if capture.is_question
        else "highlight"
        if capture.quote
        else "note"
    )
    metadata: dict[str, Any] = {
        "createdAt": capture.created_at,
        "sourceLabel": source_path.name,
        "sourcePath": str(source_path),
        "syncRevision": sync_revision,
        **_context_metadata(context),
    }
    if source_day_id:
        metadata["createdDayId"] = source_day_id
    return AnnotationCreateCommand(
        resource_id=resource_id,
        kind=kind,
        origin="pdf_import",
        external_id=capture.fingerprint,
        source_fingerprint=capture.fingerprint,
        markdown=capture.comment,
        plain_text=capture.comment,
        anchor=AnnotationAnchorCreate(
            anchor_type="pdf_rect",
            quote=capture.quote or None,
            section_title=context.subchapter_title if context else None,
            page_number=capture.page,
            rect=capture.rect,
            color=capture.color or None,
            rgb=capture.rgb or None,
            annotation_kind=capture.annotation_kind,
            metadata=metadata,
        ),
    )


def _drawboard_annotation_command(
    resource_id: str,
    source_url: str,
    document_id: str,
    capture: DrawboardCapture,
    context: PdfAnnotationContext | None,
    annotated_page_url: str | None,
    sync_revision: str,
    source_day_id: str | None = None,
) -> AnnotationCreateCommand:
    kind: AnnotationKind = (
        "question"
        if capture.is_question
        else "highlight"
        if capture.quote
        else "note"
    )
    source_content = capture.comment or capture.quote
    metadata: dict[str, Any] = {
        "createdAt": capture.created_at,
        "drawboardDocumentId": document_id,
        "sourceContent": source_content,
        "sourceLabel": "Drawboard cloud PDF",
        "sourcePath": source_url,
        "sourceRevision": capture.source_revision,
        "syncRevision": sync_revision,
    }
    if context is not None:
        metadata.update(
            {
                "chapterNumber": context.chapter_number,
                "chapterTitle": context.chapter_title,
                "contextAfter": context.context_after,
                "contextBefore": context.context_before,
                "contextMatch": context.match_method,
                "contextSentence": context.context_sentence,
                "contextGroupId": context.paragraph_id,
                "contextParagraph": context.paragraph_text,
                "contextParagraphEndPage": context.paragraph_end_page,
                "contextParagraphStartPage": context.paragraph_start_page,
                "contextParagraphTruncated": context.paragraph_truncated,
                "subchapterTitle": context.subchapter_title,
                "pageWidth": context.page_width,
                "pageHeight": context.page_height,
                "pageCount": context.page_count,
            }
        )
    if annotated_page_url:
        metadata["annotatedPageImageUrl"] = annotated_page_url
    if source_day_id:
        metadata["createdDayId"] = source_day_id
    return AnnotationCreateCommand(
        resource_id=resource_id,
        kind=kind,
        origin="drawboard_cloud",
        external_id=capture.fingerprint,
        source_fingerprint=capture.fingerprint,
        markdown=capture.comment,
        plain_text=capture.comment,
        anchor=AnnotationAnchorCreate(
            anchor_type="pdf_rect",
            quote=capture.quote or None,
            section_title=context.subchapter_title if context else None,
            page_number=capture.page,
            rect=capture.rect or None,
            color=capture.color or None,
            rgb=capture.rgb or None,
            annotation_kind=capture.annotation_kind,
            metadata=metadata,
        ),
    )


def _context_metadata(
    context: PdfAnnotationContext | None,
) -> dict[str, Any]:
    if context is None:
        return {}
    return {
        "chapterNumber": context.chapter_number,
        "chapterTitle": context.chapter_title,
        "contextAfter": context.context_after,
        "contextBefore": context.context_before,
        "contextMatch": context.match_method,
        "contextSentence": context.context_sentence,
        "contextGroupId": context.paragraph_id,
        "contextParagraph": context.paragraph_text,
        "contextParagraphEndPage": context.paragraph_end_page,
        "contextParagraphStartPage": context.paragraph_start_page,
        "contextParagraphTruncated": context.paragraph_truncated,
        "subchapterTitle": context.subchapter_title,
        "pageWidth": context.page_width,
        "pageHeight": context.page_height,
        "pageCount": context.page_count,
    }


def _drawboard_ink_command(
    resource_id: str,
    source_url: str,
    document_id: str,
    ink: DrawboardInk,
    context: PdfAnnotationContext | None,
    image_url: str | None,
    annotated_page_url: str | None,
    sync_revision: str,
    source_day_id: str | None = None,
) -> AnnotationCreateCommand:
    context_text = " ".join(
        part
        for part in (
            context.context_sentence if context else "",
            context.paragraph_text if context else "",
        )
        if part
    )
    nearby_tag = re.search(
        r"\b(?:Exercise|Example|Figure|Algorithm|Theorem|Definition)\s+"
        r"\d+(?:\.\d+)*\b",
        context_text,
        re.IGNORECASE,
    )
    label = (
        nearby_tag.group(0)
        if nearby_tag
        else context.subchapter_title
        if context and context.subchapter_title
        else "handwriting"
    )
    markdown = f"Screenshot · {label}"
    metadata: dict[str, Any] = {
        "createdAt": ink.created_at,
        "drawboardDocumentId": document_id,
        "inkGroupSize": len(ink.member_fingerprints),
        "inkGrouping": "guide-bands-v2",
        "inkMemberFingerprints": list(ink.member_fingerprints),
        "sourceContent": "",
        "sourceLabel": "Drawboard cloud PDF",
        "sourcePath": source_url,
        "sourceRevision": ink.source_revision,
        "syncRevision": sync_revision,
        **_context_metadata(context),
    }
    if image_url:
        metadata["contextImageUrl"] = image_url
    if annotated_page_url:
        metadata["annotatedPageImageUrl"] = annotated_page_url
    if source_day_id:
        metadata["createdDayId"] = source_day_id
    return AnnotationCreateCommand(
        resource_id=resource_id,
        kind="question",
        origin="drawboard_cloud_ink",
        external_id=ink.fingerprint,
        source_fingerprint=ink.fingerprint,
        markdown=markdown,
        plain_text=markdown,
        anchor=AnnotationAnchorCreate(
            anchor_type="pdf_rect",
            page_number=ink.page,
            rect=ink.rect or None,
            color=ink.color,
            rgb=ink.rgb,
            annotation_kind="Ink",
            section_title=context.subchapter_title if context else None,
            metadata=metadata,
        ),
    )


def collect_resource_pdf_annotations(
    connection: Connection,
    resource_id: str,
    source_day_id: str | None = None,
) -> PdfCollection:
    local_path, source_url = workspace_repository.resource_open_target(
        connection,
        resource_id,
    )
    if is_drawboard_cloud_url(source_url):
        assert source_url is not None
        try:
            cloud_extraction = extract_drawboard_annotations(source_url)
        except DrawboardError as error:
            raise PdfAnnotationError(str(error)) from error
        contexts: dict[str, PdfAnnotationContext] = {}
        image_urls: dict[str, str] = {}
        annotated_page_urls: dict[int, str] = {}
        safe_path: Path | None = None
        if local_path:
            try:
                safe_path = safe_local_resource_path(local_path)
            except ResourceOpenError:
                safe_path = None
        if safe_path is not None:
            try:
                contexts = extract_pdf_annotation_contexts(
                    safe_path,
                    [*cloud_extraction.captures, *cloud_extraction.red_ink],
                    drawboard_coordinates=True,
                )
            except PdfContextError:
                contexts = {}
            if cloud_extraction.red_ink:
                try:
                    image_urls = render_ink_context_images(
                        safe_path,
                        resource_id,
                        cloud_extraction.red_ink,
                        captures=cloud_extraction.captures,
                        page_inks=cloud_extraction.all_ink,
                    )
                except PdfInkImageError:
                    image_urls = {}
            try:
                source_annotation_pages = {
                    item.page for item in cloud_extraction.captures
                } | {
                    item.page for item in cloud_extraction.all_ink
                }
                question_pages = {
                    item.page
                    for item in cloud_extraction.captures
                    if item.is_question
                } | {
                    item.page for item in cloud_extraction.red_ink
                }
                review_pages = {
                    neighboring_page
                    for page in question_pages
                    for neighboring_page in (page - 1, page, page + 1)
                    if neighboring_page in source_annotation_pages
                }
                annotated_page_urls = render_annotated_page_images(
                    safe_path,
                    resource_id,
                    review_pages,
                    captures=cloud_extraction.captures,
                    page_inks=cloud_extraction.all_ink,
                )
            except PdfInkImageError:
                annotated_page_urls = {}
        counts = {"created": 0, "existing": 0, "updated": 0}
        cloud_kind_counts: dict[str, int] = {}
        chapter_study_days = _chapter_study_days(connection, resource_id)
        for cloud_capture in cloud_extraction.captures:
            context = contexts.get(cloud_capture.fingerprint)
            capture_day_id = _capture_study_day(
                context,
                chapter_study_days,
                source_day_id,
            )
            sync_revision = (
                f"{cloud_capture.source_revision}:"
                f"{'pdf-paragraph-context-v2' if context else 'plain-v1'}:"
                f"study-day-v1:{capture_day_id or '-'}"
            )
            command = _drawboard_annotation_command(
                resource_id,
                cloud_extraction.source_url,
                cloud_extraction.document_id,
                cloud_capture,
                context,
                annotated_page_urls.get(cloud_capture.page),
                sync_revision,
                capture_day_id,
            )
            cloud_kind_counts[command.kind] = (
                cloud_kind_counts.get(command.kind, 0) + 1
            )
            outcome = workspace_repository.upsert_imported_annotation(
                connection,
                command,
                source_revision=sync_revision,
            )
            counts[outcome] += 1
        for ink in cloud_extraction.red_ink:
            context = contexts.get(ink.fingerprint)
            capture_day_id = _capture_study_day(
                context,
                chapter_study_days,
                source_day_id,
            )
            sync_revision = (
                f"{ink.source_revision}:"
                f"{'ink-paragraph-context-v3' if context else 'ink-plain-v4'}:"
                f"{INK_RENDERER_VERSION}:study-day-v1:{capture_day_id or '-'}"
            )
            command = _drawboard_ink_command(
                resource_id,
                cloud_extraction.source_url,
                cloud_extraction.document_id,
                ink,
                context,
                image_urls.get(ink.fingerprint),
                annotated_page_urls.get(ink.page),
                sync_revision,
                capture_day_id,
            )
            cloud_kind_counts["question"] = (
                cloud_kind_counts.get("question", 0) + 1
            )
            outcome = workspace_repository.upsert_imported_annotation(
                connection,
                command,
                source_revision=sync_revision,
            )
            counts[outcome] += 1
        active_cloud_fingerprints = {
            capture.fingerprint for capture in cloud_extraction.captures
        } | {ink.fingerprint for ink in cloud_extraction.red_ink}
        removed_count = (
            workspace_repository.soft_delete_stale_imported_annotations(
                connection,
                resource_id,
                active_cloud_fingerprints,
            )
        )
        return PdfCollection(
            resource_id=resource_id,
            path=cloud_extraction.source_url,
            extracted_count=(
                len(cloud_extraction.captures) + len(cloud_extraction.red_ink)
            ),
            created_count=counts["created"],
            updated_count=counts["updated"],
            existing_count=counts["existing"],
            removed_count=removed_count,
            ignored=cloud_extraction.ignored,
            kind_counts=cloud_kind_counts,
        )

    if not local_path:
        raise PdfAnnotationError("This resource has no local PDF path.")
    try:
        safe_path = safe_local_resource_path(local_path)
    except ResourceOpenError as error:
        raise PdfAnnotationError(str(error)) from error
    local_extraction = extract_pdf_annotations(safe_path)
    try:
        contexts = extract_pdf_annotation_contexts(
            safe_path,
            local_extraction.captures,
        )
    except PdfContextError:
        contexts = {}
    try:
        source_version = str(safe_path.stat().st_mtime_ns)
    except OSError:
        source_version = "unknown"

    counts = {"created": 0, "existing": 0, "updated": 0}
    kind_counts: dict[str, int] = {}
    chapter_study_days = _chapter_study_days(connection, resource_id)
    for local_capture in local_extraction.captures:
        context = contexts.get(local_capture.fingerprint)
        capture_day_id = _capture_study_day(
            context,
            chapter_study_days,
            source_day_id,
        )
        sync_revision = (
            f"{source_version}:"
            f"{'pdf-paragraph-context-v1' if context else 'local-plain-v1'}:"
            f"study-day-v1:{capture_day_id or '-'}"
        )
        command = _annotation_command(
            resource_id,
            local_extraction.path,
            local_capture,
            context,
            sync_revision,
            capture_day_id,
        )
        kind_counts[command.kind] = kind_counts.get(command.kind, 0) + 1
        outcome = workspace_repository.upsert_imported_annotation(
            connection,
            command,
            source_revision=sync_revision,
        )
        counts[outcome] += 1
    return PdfCollection(
        resource_id=resource_id,
        path=str(local_extraction.path),
        extracted_count=len(local_extraction.captures),
        created_count=counts["created"],
        updated_count=counts["updated"],
        existing_count=counts["existing"],
        removed_count=0,
        ignored=local_extraction.ignored,
        kind_counts=kind_counts,
    )
