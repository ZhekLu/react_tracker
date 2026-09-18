from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
import time
from collections.abc import Iterable
from dataclasses import asdict, dataclass, field, replace
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
    DrawboardExtraction,
    DrawboardInk,
    extract_drawboard_annotations,
    group_red_ink_annotations,
    ink_vertical_guide_bounds,
    is_drawboard_cloud_url,
    merge_ink_annotation_groups,
)
from .pdf_context_service import (
    PdfAnnotationContext,
    PdfContextError,
    extract_pdf_annotation_contexts,
)
from .pdf_ink_image_service import (
    INK_RENDERER_VERSION,
    render_annotated_page_images,
    render_ink_context_images,
    render_local_annotation_images,
)
from .resource_open_service import (
    ResourceOpenError,
    readable_local_resource_path,
    safe_local_resource_path,
)

MARKUP_KINDS = {"Highlight", "Underline", "Squiggly", "StrikeOut"}
VISUAL_KINDS = {"Ink", "Square", "Circle", "Line", "PolyLine", "Polygon", "Stamp", "Caret"}
DRAWBOARD_COLOR_ROLE_PREFIX = "drawboard_color_roles"
DRAWBOARD_COLOR_ROLE_VERSION = "drawboard-color-role-v2"

logger = logging.getLogger("uvicorn.error")
# Collection snapshots must commit in source-read order. Status edits use their
# own requests and are not blocked by this lock.
_COLLECTION_LOCK = threading.Lock()
_PENDING_PALETTE: tuple[str, str, float, DrawboardExtraction] | None = None


def _merge_ink_groups_by_paragraph(
    inks: list[DrawboardInk],
    contexts: dict[str, PdfAnnotationContext],
) -> list[DrawboardInk]:
    """Collapse screenshot questions that PDF extraction maps to one paragraph."""

    buckets: dict[tuple[int, str], list[DrawboardInk]] = {}
    ungrouped: list[DrawboardInk] = []
    for ink in inks:
        context = contexts.get(ink.fingerprint)
        # A deliberate vertical guide is authoritative. Two framed questions
        # must not be joined merely because PDF text extraction maps them to
        # one broad paragraph. Paragraph fallback is only for handwriting
        # that has no guide line.
        if (
            context is None
            or not context.paragraph_id
            or ink_vertical_guide_bounds(ink)
        ):
            ungrouped.append(ink)
            continue
        buckets.setdefault((ink.page, context.paragraph_id), []).append(ink)
    merged = [
        merge_ink_annotation_groups(bucket) for _key, bucket in sorted(buckets.items())
    ]
    return sorted(
        [*merged, *ungrouped],
        key=lambda ink: (
            ink.page,
            ink.rect[1] if len(ink.rect) == 4 else 0.0,
            ink.rect[0] if len(ink.rect) == 4 else 0.0,
        ),
    )


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
    legacy_fingerprint: str | None = None
    previous_source_fingerprint: str | None = None
    source_revision: str = ""
    ink_vertex_sets: tuple[list[Any], ...] = ()
    member_fingerprints: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class PdfExtraction:
    path: Path
    captures: list[PdfCapture]
    ignored: dict[str, int]
    source_fingerprints: set[str] | None = None


@dataclass(frozen=True, slots=True)
class DrawboardColorPaletteEntry:
    key: str
    rgb: list[float]
    count: int
    annotation_kinds: tuple[str, ...]
    role: str | None
    suggested_role: str


@dataclass(frozen=True, slots=True)
class PdfCollectionItem:
    outcome: str
    kind: str
    text: str
    page: int | None
    section_title: str
    source_day_id: str | None


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
    color_palette: list[DrawboardColorPaletteEntry] = field(default_factory=list)
    requires_color_roles: bool = False
    changed_items: list[PdfCollectionItem] = field(default_factory=list)

    @property
    def ignored_count(self) -> int:
        return sum(self.ignored.values())


def _logged_collection(collection: PdfCollection) -> PdfCollection:
    logger.info(
        "Completed PDF annotation collection resource_id=%s extracted=%s "
        "created=%s updated=%s existing=%s removed=%s ignored=%s "
        "requires_color_roles=%s",
        collection.resource_id,
        collection.extracted_count,
        collection.created_count,
        collection.updated_count,
        collection.existing_count,
        collection.removed_count,
        collection.ignored_count,
        collection.requires_color_roles,
    )
    return collection


def _collection_item(
    command: AnnotationCreateCommand,
    outcome: str,
    source_day_id: str | None,
) -> PdfCollectionItem:
    anchor = command.anchor
    text_value = (
        (anchor.quote if anchor else None)
        or command.plain_text
        or command.markdown
        or "Screenshot"
    )
    return PdfCollectionItem(
        outcome=outcome,
        kind=command.kind,
        text=" ".join(text_value.split())[:280],
        page=anchor.page_number if anchor else None,
        section_title=(anchor.section_title or "") if anchor else "",
        source_day_id=source_day_id,
    )


def drawboard_color_key(rgb: Iterable[float]) -> str:
    channels = list(rgb)[:3]
    if len(channels) < 3:
        return ""
    values = [max(0, min(255, round(channel * 255))) for channel in channels]
    return "#" + "".join(f"{value:02X}" for value in values)


def _drawboard_role_preference_key(connection: Connection, resource_id: str) -> str:
    course_id = connection.execute(
        text("""
            SELECT course_id
            FROM resources
            WHERE id = :resource_id AND deleted_at IS NULL
            """),
        {"resource_id": resource_id},
    ).scalar_one_or_none()
    if course_id is None:
        raise workspace_repository.EntityNotFoundError(
            f"Resource does not exist: {resource_id}"
        )
    return f"{DRAWBOARD_COLOR_ROLE_PREFIX}:{course_id}"


def drawboard_color_roles(
    connection: Connection,
    resource_id: str,
) -> dict[str, str]:
    key = _drawboard_role_preference_key(connection, resource_id)
    raw = connection.execute(
        text("SELECT value_json FROM app_preferences WHERE key = :key"),
        {"key": key},
    ).scalar_one_or_none()
    if not raw:
        return {}
    try:
        payload = json.loads(str(raw))
    except json.JSONDecodeError:
        return {}
    if not isinstance(payload, dict):
        return {}
    return {
        str(color).upper(): str(role)
        for color, role in payload.items()
        if re.fullmatch(r"#[0-9A-Fa-f]{6}", str(color))
        and role in {"question", "regular"}
    }


def save_drawboard_color_roles(
    connection: Connection,
    resource_id: str,
    roles: dict[str, str],
) -> dict[str, str]:
    preference_key = _drawboard_role_preference_key(connection, resource_id)
    current = drawboard_color_roles(connection, resource_id)
    for raw_color, role in roles.items():
        color = raw_color.upper()
        if not re.fullmatch(r"#[0-9A-F]{6}", color):
            raise PdfAnnotationError(f"Invalid Drawboard color: {raw_color}")
        if role not in {"question", "regular"}:
            raise PdfAnnotationError(f"Invalid Drawboard color role: {role}")
        current[color] = role
    now = _utc_now_iso()
    connection.execute(
        text("""
            INSERT INTO app_preferences (key, value_json, updated_at)
            VALUES (:key, :value_json, :updated_at)
            ON CONFLICT(key) DO UPDATE SET
              value_json = excluded.value_json,
              updated_at = excluded.updated_at
            """),
        {
            "key": preference_key,
            "value_json": json.dumps(current, sort_keys=True),
            "updated_at": now,
        },
    )
    return current


def _drawboard_palette(
    extraction: DrawboardExtraction,
    roles: dict[str, str],
) -> list[DrawboardColorPaletteEntry]:
    items: dict[str, dict[str, Any]] = {}
    for capture in extraction.captures:
        key = drawboard_color_key(capture.rgb)
        if not key:
            continue
        entry = items.setdefault(
            key,
            {"rgb": capture.rgb, "count": 0, "kinds": set(), "red": False},
        )
        entry["count"] += 1
        entry["kinds"].add(capture.annotation_kind)
        entry["red"] = entry["red"] or capture.color == "red"
    for ink in extraction.all_ink:
        key = drawboard_color_key(ink.rgb)
        if not key:
            continue
        entry = items.setdefault(
            key,
            {"rgb": ink.rgb, "count": 0, "kinds": set(), "red": False},
        )
        entry["count"] += 1
        entry["kinds"].add("Ink")
        entry["red"] = entry["red"] or ink.color == "red"
    return [
        DrawboardColorPaletteEntry(
            key=key,
            rgb=list(entry["rgb"]),
            count=int(entry["count"]),
            annotation_kinds=tuple(sorted(entry["kinds"])),
            role=roles.get(key),
            suggested_role="question" if entry["red"] else "regular",
        )
        for key, entry in sorted(items.items())
    ]


def _classify_drawboard_extraction(
    extraction: DrawboardExtraction,
    roles: dict[str, str],
) -> DrawboardExtraction:
    question_ink = group_red_ink_annotations(
        [
            ink
            for ink in extraction.all_ink
            if roles.get(drawboard_color_key(ink.rgb)) == "question"
        ]
    )
    captures = []
    for capture in extraction.captures:
        source_text = capture.comment or capture.quote
        explicit_marker = "??" in source_text or "todo!" in source_text.casefold()
        color_question = roles.get(drawboard_color_key(capture.rgb)) == "question"
        merged_with_ink = (
            color_question
            and not explicit_marker
            and any(
                capture.page == ink.page
                and len(capture.rect) == 4
                and len(ink.rect) == 4
                and capture.rect[1] <= ink.rect[3] + 6.0
                and ink.rect[1] <= capture.rect[3] + 6.0
                for ink in question_ink
            )
        )
        captures.append(
            replace(
                capture,
                is_question=explicit_marker or (color_question and not merged_with_ink),
            )
        )
    return replace(extraction, captures=captures, red_ink=question_ink)


def _chapter_study_days(
    connection: Connection,
    resource_id: str,
) -> dict[int, str]:
    """Map a book chapter to its first explicit study-plan day."""

    rows = connection.execute(
        text("""
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
            """),
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
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _parse_pdf_date(value: str) -> str:
    match = re.match(
        r"D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})",
        value or "",
    )
    if not match:
        return ""
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
        return ""
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


def _local_annotation_fingerprint(path: Path, annotation: Any, page: int | None = None) -> str:
    # PDF /NM is the source identity; content, colors and modified dates are not.
    source_id = str((annotation.info or {}).get("id") or f"xref-{annotation.xref}")
    # /NM need only be unique within a page. Keep the old form for migration.
    identity = f"{path}:{source_id}" if page is None else f"{path}:page-{page}:{source_id}"
    digest = hashlib.sha256(identity.encode()).hexdigest()[:24]
    return f"pdf-source-{digest}"


def _capture_from_annotation(
    *,
    annotation: Any,
    page: Any,
    page_number: int,
    path: Path,
) -> PdfCapture | None:
    annotation_kind = str(annotation.type[1])
    info = annotation.info or {}
    comment = _normalize_text(str(info.get("content") or ""))
    quote = (
        _normalize_text(page.get_textbox(annotation.rect))
        if annotation_kind in MARKUP_KINDS
        else ""
    )
    content = comment or quote
    if not content and annotation_kind not in VISUAL_KINDS:
        return None
    color, rgb = _annotation_color(annotation)
    rect = [float(value) for value in annotation.rect]
    modified = str(info.get("modDate") or info.get("creationDate") or "")
    fingerprint = _local_annotation_fingerprint(path, annotation, page_number)
    # Missing PDF timestamps must not create a different revision on every sync.
    created_at = (
        _parse_pdf_date(str(info.get("creationDate") or modified))
        if (info.get("creationDate") or modified)
        else ""
    )
    return PdfCapture(
        fingerprint=fingerprint,
        previous_source_fingerprint=_local_annotation_fingerprint(path, annotation),
        legacy_fingerprint=_fingerprint(
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
        quote=quote,
        comment=comment,
        is_question=(color == "red" or "??" in content or "todo!" in content.casefold()),
        created_at=created_at,
        rect=rect,
        source_revision=hashlib.sha256(
            json.dumps(
                [annotation.vertices, annotation.opacity, annotation.border, modified],
                sort_keys=True,
            ).encode()
        ).hexdigest(),
        ink_vertex_sets=tuple(annotation.vertices or []) if annotation_kind == "Ink" else (),
        member_fingerprints=(fingerprint,) if annotation_kind == "Ink" else (),
    )


def extract_pdf_annotations(path: Path) -> PdfExtraction:
    pdf_path = path.expanduser().resolve()
    if not pdf_path.exists():
        raise PdfAnnotationError(f"PDF not found: {pdf_path}")
    if pdf_path.suffix.casefold() != ".pdf":
        raise PdfAnnotationError(f"Not a PDF: {pdf_path}")

    captures: list[PdfCapture] = []
    source_fingerprints: set[str] = set()
    ignored: dict[str, int] = {}
    try:
        document: Any = pymupdf.open(pdf_path)  # type: ignore[no-untyped-call]
    except Exception as error:
        raise PdfAnnotationError(f"Could not open PDF: {pdf_path}") from error
    try:
        pages = cast(Iterable[Any], document)
        for page_index, page in enumerate(pages):
            annotation = page.first_annot
            while annotation:
                source_fingerprints.add(
                    _local_annotation_fingerprint(pdf_path, annotation, page_index + 1)
                )
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
    return PdfExtraction(
        path=pdf_path,
        captures=captures,
        ignored=ignored,
        source_fingerprints=source_fingerprints,
    )


def _group_local_ink(
    captures: list[PdfCapture],
    states: dict[str, dict[str, Any]],
) -> list[PdfCapture]:
    """Reuse guide grouping while keeping local coordinates and saved identities."""

    previous = {
        fingerprint: state
        for fingerprint, state in states.items()
        if state["origin"] == "pdf_import" and state["metadata"].get("inkMemberFingerprints")
    }
    question_members = {
        member
        for state in previous.values()
        if state["kind"] in {"question", "todo"}
        for member in state["metadata"]["inkMemberFingerprints"]
    }
    by_fingerprint = {capture.fingerprint: capture for capture in captures}
    buckets: dict[str, list[DrawboardInk]] = {}
    result = [capture for capture in captures if capture.annotation_kind != "Ink"]
    for capture in captures:
        if capture.annotation_kind != "Ink":
            continue
        role = (
            "question"
            if capture.is_question or capture.fingerprint in question_members
            else capture.color
        )
        buckets.setdefault(role, []).append(
            DrawboardInk(
                fingerprint=capture.fingerprint,
                source_revision=hashlib.sha256(
                    json.dumps(asdict(capture), sort_keys=True).encode()
                ).hexdigest(),
                page=capture.page,
                color=capture.color,
                rgb=capture.rgb,
                created_at=capture.created_at,
                rect=capture.rect,
                ink_vertex_sets=capture.ink_vertex_sets,
                member_fingerprints=capture.member_fingerprints,
            )
        )
    claimed: set[str] = set()
    for role, inks in buckets.items():
        for group in group_red_ink_annotations(inks):
            members = set(group.member_fingerprints)
            fingerprint = next(
                (
                    key
                    for key, state in previous.items()
                    if key not in claimed
                    and members.intersection(state["metadata"]["inkMemberFingerprints"])
                ),
                group.fingerprint,
            )
            claimed.add(fingerprint)
            result.append(
                replace(
                    by_fingerprint[group.fingerprint],
                    fingerprint=fingerprint,
                    rect=group.rect,
                    is_question=role == "question",
                    source_revision=group.source_revision,
                    ink_vertex_sets=group.ink_vertex_sets,
                    member_fingerprints=group.member_fingerprints,
                    comment="\n\n".join(
                        dict.fromkeys(
                            by_fingerprint[member].comment
                            for member in group.member_fingerprints
                            if by_fingerprint[member].comment
                        )
                    ),
                )
            )
    return sorted(result, key=lambda item: (item.page, item.rect[1], item.rect[0]))


def _annotation_command(
    resource_id: str,
    source_path: Path,
    capture: PdfCapture,
    context: PdfAnnotationContext | None,
    sync_revision: str,
    source_day_id: str | None = None,
) -> AnnotationCreateCommand:
    kind: AnnotationKind = (
        "question" if capture.is_question else "highlight" if capture.quote else "note"
    )
    metadata: dict[str, Any] = {
        "createdAt": capture.created_at,
        "sourceLabel": source_path.name,
        "sourcePath": str(source_path),
        "syncRevision": sync_revision,
        "colorRoleRevision": f"pdf-color-v1:{capture.is_question}",
        "sourceContent": capture.comment,
        "sourceVisual": capture.annotation_kind in VISUAL_KINDS,
        **_context_metadata(context),
    }
    if source_day_id:
        metadata["createdDayId"] = source_day_id
    if capture.member_fingerprints:
        metadata["inkMemberFingerprints"] = list(capture.member_fingerprints)
        metadata["inkGroupSize"] = len(capture.member_fingerprints)
    body = capture.comment or (
        "Screenshot · handwriting"
        if capture.annotation_kind == "Ink"
        else f"Screenshot · {capture.annotation_kind}"
        if capture.annotation_kind in VISUAL_KINDS
        else ""
    )
    return AnnotationCreateCommand(
        resource_id=resource_id,
        kind=kind,
        origin="pdf_import",
        external_id=capture.fingerprint,
        source_fingerprint=capture.fingerprint,
        markdown=body,
        plain_text=body,
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
    color_role_revision: str | None = None,
) -> AnnotationCreateCommand:
    kind: AnnotationKind = (
        "question" if capture.is_question else "highlight" if capture.quote else "note"
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
    if color_role_revision:
        metadata["colorRoleRevision"] = color_role_revision
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
    color_role_revision: str | None = None,
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
        else (
            context.subchapter_title
            if context and context.subchapter_title
            else "handwriting"
        )
    )
    markdown = f"Screenshot · {label}"
    metadata: dict[str, Any] = {
        "createdAt": ink.created_at,
        "drawboardDocumentId": document_id,
        "inkGroupSize": len(ink.member_fingerprints),
        "inkGrouping": "guide-paragraph-v4",
        "inkMemberFingerprints": list(ink.member_fingerprints),
        "sourceContent": "",
        "sourceLabel": "Drawboard cloud PDF",
        "sourcePath": source_url,
        "sourceRevision": ink.source_revision,
        "syncRevision": sync_revision,
        **_context_metadata(context),
    }
    if color_role_revision:
        metadata["colorRoleRevision"] = color_role_revision
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


def _retain_tracked_ink(
    extraction: DrawboardExtraction,
    states: dict[str, dict[str, Any]],
) -> DrawboardExtraction:
    """Recolored question strokes remain tracked, including open previews."""
    inks = list(extraction.red_ink)
    represented = {ink.fingerprint for ink in inks}
    source_inks = {ink.fingerprint: ink for ink in extraction.all_ink}
    for fingerprint, state in states.items():
        if state["origin"] != "drawboard_cloud_ink" or fingerprint in represented:
            continue
        members = state["metadata"].get("inkMemberFingerprints") or [fingerprint]
        remaining = [source_inks[member] for member in members if member in source_inks]
        if remaining:
            inks.append(replace(merge_ink_annotation_groups(remaining), fingerprint=fingerprint))
    return replace(extraction, red_ink=inks)


def _attach_page_snapshots(
    command: AnnotationCreateCommand,
    pages: dict[int, str],
) -> None:
    if command.anchor is None or command.anchor.page_number is None:
        return
    page = command.anchor.page_number
    snapshots = {str(p): pages[p] for p in (page - 1, page, page + 1) if p in pages}
    if snapshots:
        command.anchor.metadata["annotatedPageImageUrls"] = snapshots


def collect_resource_pdf_annotations(
    connection: Connection,
    resource_id: str,
    source_day_id: str | None = None,
) -> PdfCollection:
    with _COLLECTION_LOCK:
        return _collect_resource_pdf_annotations(connection, resource_id, source_day_id)


def _collect_resource_pdf_annotations(
    connection: Connection,
    resource_id: str,
    source_day_id: str | None = None,
) -> PdfCollection:
    global _PENDING_PALETTE
    logger.debug(
        "Starting PDF annotation collection resource_id=%s source_day_id=%s",
        resource_id,
        source_day_id,
    )
    local_path, source_url = workspace_repository.resource_open_target(
        connection,
        resource_id,
    )
    if is_drawboard_cloud_url(source_url):
        assert source_url is not None
        cache_key = f"{connection.engine.url}:{resource_id}"
        snapshot_started_at = time.monotonic()
        try:
            pending = _PENDING_PALETTE
            _PENDING_PALETTE = None
            if (
                pending is not None
                and pending[0] == cache_key
                and pending[1] == source_url
                and time.monotonic() - pending[2] < 600
            ):
                cloud_extraction = pending[3]
                snapshot_started_at = pending[2]
                logger.debug("Reusing pending color-palette snapshot resource_id=%s", resource_id)
            else:
                cloud_extraction = extract_drawboard_annotations(source_url)
        except DrawboardError as error:
            raise PdfAnnotationError(str(error)) from error
        color_roles = drawboard_color_roles(connection, resource_id)
        color_palette = _drawboard_palette(cloud_extraction, color_roles)
        if any(entry.role is None for entry in color_palette):
            _PENDING_PALETTE = (cache_key, source_url, snapshot_started_at, cloud_extraction)
            return _logged_collection(
                PdfCollection(
                    resource_id=resource_id,
                    path=cloud_extraction.source_url,
                    extracted_count=(
                        len(cloud_extraction.captures) + len(cloud_extraction.all_ink)
                    ),
                    created_count=0,
                    updated_count=0,
                    existing_count=0,
                    removed_count=0,
                    ignored=cloud_extraction.ignored,
                    kind_counts={},
                    color_palette=color_palette,
                    requires_color_roles=True,
                )
            )
        states = workspace_repository.imported_annotation_states(connection, resource_id)
        cloud_extraction = _retain_tracked_ink(
            _classify_drawboard_extraction(cloud_extraction, color_roles),
            states,
        )

        def needs_preview(fingerprint: str, is_question: bool = True) -> bool:
            state = states.get(fingerprint)
            if state is None:
                return is_question
            return state["status"] == "open" and state["kind"] in {"question", "todo"}

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
            merged_question_ink = _merge_ink_groups_by_paragraph(
                cloud_extraction.red_ink,
                contexts,
            )
            if merged_question_ink != cloud_extraction.red_ink:
                cloud_extraction = replace(
                    cloud_extraction,
                    red_ink=merged_question_ink,
                )
                try:
                    contexts = extract_pdf_annotation_contexts(
                        safe_path,
                        [*cloud_extraction.captures, *cloud_extraction.red_ink],
                        drawboard_coordinates=True,
                    )
                except PdfContextError:
                    contexts = {}
            preview_inks = [
                ink for ink in cloud_extraction.red_ink if needs_preview(ink.fingerprint)
            ]
            if preview_inks:
                try:
                    image_urls = render_ink_context_images(
                        safe_path,
                        resource_id,
                        preview_inks,
                        captures=cloud_extraction.captures,
                        page_inks=cloud_extraction.all_ink,
                    )
                except Exception:
                    logger.exception(
                        "Handwriting preview rendering failed; continuing import resource_id=%s",
                        resource_id,
                    )
                    image_urls = {}
            try:
                source_annotation_pages = {item.page for item in cloud_extraction.captures} | {
                    item.page for item in cloud_extraction.all_ink
                }
                question_pages = {
                    item.page
                    for item in cloud_extraction.captures
                    if needs_preview(item.fingerprint, item.is_question)
                } | {item.page for item in preview_inks}
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
            except Exception:
                logger.exception(
                    "Annotated page rendering failed; continuing import resource_id=%s",
                    resource_id,
                )
                annotated_page_urls = {}
        counts = {"created": 0, "existing": 0, "updated": 0}
        changed_items: list[PdfCollectionItem] = []
        cloud_kind_counts: dict[str, int] = {}
        chapter_study_days = _chapter_study_days(connection, resource_id)
        for cloud_capture in cloud_extraction.captures:
            context = contexts.get(cloud_capture.fingerprint)
            capture_day_id = _capture_study_day(
                context,
                chapter_study_days,
                source_day_id,
            )
            color_key = drawboard_color_key(cloud_capture.rgb)
            color_role = color_roles.get(color_key, "regular")
            classification = (
                "standalone-question"
                if cloud_capture.is_question
                else "merged-with-ink"
                if color_role == "question"
                else "regular"
            )
            color_role_revision = (
                f"{DRAWBOARD_COLOR_ROLE_VERSION}:{color_key}:{color_role}:{classification}"
            )
            sync_revision = (
                f"{cloud_capture.source_revision}:"
                f"{'pdf-paragraph-context-v2' if context else 'plain-v1'}:"
                f"study-day-v1:{capture_day_id or '-'}:"
                f"{color_role_revision}"
            )
            command = _drawboard_annotation_command(
                resource_id,
                cloud_extraction.source_url,
                cloud_extraction.document_id,
                cloud_capture,
                context,
                annotated_page_urls.get(cloud_capture.page)
                if needs_preview(cloud_capture.fingerprint, cloud_capture.is_question)
                else None,
                sync_revision,
                capture_day_id,
                color_role_revision,
            )
            if needs_preview(cloud_capture.fingerprint, cloud_capture.is_question):
                _attach_page_snapshots(command, annotated_page_urls)
            cloud_kind_counts[command.kind] = cloud_kind_counts.get(command.kind, 0) + 1
            outcome = workspace_repository.upsert_imported_annotation(
                connection,
                command,
                source_revision=sync_revision,
            )
            counts[outcome] += 1
            if outcome in {"created", "updated"}:
                changed_items.append(_collection_item(command, outcome, capture_day_id))
        for ink in cloud_extraction.red_ink:
            context = contexts.get(ink.fingerprint)
            capture_day_id = _capture_study_day(
                context,
                chapter_study_days,
                source_day_id,
            )
            color_key = drawboard_color_key(ink.rgb)
            color_role_revision = f"{DRAWBOARD_COLOR_ROLE_VERSION}:{color_key}:question:ink-group"
            sync_revision = (
                f"{ink.source_revision}:"
                f"{'ink-paragraph-context-v4' if context else 'ink-plain-v4'}:"
                f"{INK_RENDERER_VERSION}:study-day-v1:{capture_day_id or '-'}:"
                f"{color_role_revision}"
            )
            command = _drawboard_ink_command(
                resource_id,
                cloud_extraction.source_url,
                cloud_extraction.document_id,
                ink,
                context,
                image_urls.get(ink.fingerprint),
                annotated_page_urls.get(ink.page) if needs_preview(ink.fingerprint) else None,
                sync_revision,
                capture_day_id,
                color_role_revision,
            )
            if needs_preview(ink.fingerprint):
                _attach_page_snapshots(command, annotated_page_urls)
            cloud_kind_counts["question"] = cloud_kind_counts.get("question", 0) + 1
            outcome = workspace_repository.upsert_imported_annotation(
                connection,
                command,
                source_revision=sync_revision,
            )
            if outcome != "existing":
                workspace_repository.reconcile_imported_question_frame(
                    connection,
                    resource_id,
                    ink.fingerprint,
                )
            counts[outcome] += 1
            if outcome in {"created", "updated"}:
                changed_items.append(_collection_item(command, outcome, capture_day_id))
        active_cloud_fingerprints = {
            capture.fingerprint for capture in cloud_extraction.captures
        } | {
            member
            for ink in [*cloud_extraction.red_ink, *cloud_extraction.all_ink]
            for member in (ink.member_fingerprints or (ink.fingerprint,))
        }
        if cloud_extraction.source_fingerprints is not None:
            active_cloud_fingerprints = cloud_extraction.source_fingerprints
        removed_count = workspace_repository.soft_delete_stale_imported_annotations(
            connection,
            resource_id,
            active_cloud_fingerprints,
        )
        return _logged_collection(
            PdfCollection(
                resource_id=resource_id,
                path=cloud_extraction.source_url,
                extracted_count=(len(cloud_extraction.captures) + len(cloud_extraction.red_ink)),
                created_count=counts["created"],
                updated_count=counts["updated"],
                existing_count=counts["existing"],
                removed_count=removed_count,
                ignored=cloud_extraction.ignored,
                kind_counts=cloud_kind_counts,
                color_palette=color_palette,
                changed_items=changed_items,
            )
        )

    if not local_path:
        raise PdfAnnotationError("This resource has no local PDF path.")
    try:
        safe_path = readable_local_resource_path(local_path)
    except ResourceOpenError as error:
        raise PdfAnnotationError(str(error)) from error
    source_stat = safe_path.stat()
    local_extraction = extract_pdf_annotations(safe_path)
    local_states = workspace_repository.imported_annotation_states(connection, resource_id)
    local_extraction = replace(
        local_extraction,
        captures=_group_local_ink(local_extraction.captures, local_states),
    )
    # Closed questions retain their saved screenshots. New/open captures follow
    # the PDF currently synced to disk, with immutable snapshots for old answers.
    preview_captures = [
        capture
        for capture in local_extraction.captures
        if (capture.annotation_kind in VISUAL_KINDS or capture.is_question)
        and (
            capture.fingerprint not in local_states
            or local_states[capture.fingerprint]["status"] == "open"
        )
    ]
    annotated_pages = {capture.page for capture in local_extraction.captures}
    review_pages = {
        neighbor
        for capture in preview_captures
        for neighbor in (capture.page - 1, capture.page, capture.page + 1)
        if neighbor in annotated_pages
    }
    try:
        local_images, local_pages = render_local_annotation_images(
            safe_path,
            resource_id,
            [(capture.fingerprint, capture.page, capture.rect) for capture in preview_captures],
            page_numbers=review_pages,
        )
    except Exception as error:
        raise PdfAnnotationError(
            f"Could not render embedded PDF annotations: {safe_path.name}. Nothing was imported."
        ) from error
    try:
        contexts = extract_pdf_annotation_contexts(
            safe_path,
            local_extraction.captures,
        )
    except PdfContextError:
        contexts = {}
    current_stat = safe_path.stat()
    if (source_stat.st_mtime_ns, source_stat.st_size, source_stat.st_ino) != (
        current_stat.st_mtime_ns, current_stat.st_size, current_stat.st_ino
    ):
        raise PdfAnnotationError("The PDF changed during collection. Let syncing finish and retry.")
    counts = {"created": 0, "existing": 0, "updated": 0}
    changed_items = []
    kind_counts: dict[str, int] = {}
    chapter_study_days = _chapter_study_days(connection, resource_id)
    for local_capture in local_extraction.captures:
        source_version = hashlib.sha256(
            json.dumps(
                {
                    key: value
                    for key, value in asdict(local_capture).items()
                    if key != "legacy_fingerprint"
                },
                sort_keys=True,
            ).encode()
        ).hexdigest()
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
        if command.anchor is not None and local_capture.fingerprint in local_images:
            command.anchor.metadata["contextImageUrl"] = local_images[local_capture.fingerprint]
            command.anchor.metadata["annotatedPageImageUrl"] = local_pages[local_capture.page]
            _attach_page_snapshots(command, local_pages)
        workspace_repository.adopt_local_pdf_identity(
            connection,
            command,
            local_capture.legacy_fingerprint,
            previous_source_fingerprint=local_capture.previous_source_fingerprint,
        )
        kind_counts[command.kind] = kind_counts.get(command.kind, 0) + 1
        outcome = workspace_repository.upsert_imported_annotation(
            connection,
            command,
            source_revision=sync_revision,
        )
        counts[outcome] += 1
        if outcome in {"created", "updated"}:
            changed_items.append(_collection_item(command, outcome, capture_day_id))
    return _logged_collection(
        PdfCollection(
            resource_id=resource_id,
            path=str(local_extraction.path),
            extracted_count=len(local_extraction.captures),
            created_count=counts["created"],
            updated_count=counts["updated"],
            existing_count=counts["existing"],
            removed_count=workspace_repository.soft_delete_stale_imported_annotations(
                connection,
                resource_id,
                local_extraction.source_fingerprints
                if local_extraction.source_fingerprints is not None
                else {capture.fingerprint for capture in local_extraction.captures},
                origins=("pdf_import",),
            ),
            ignored=local_extraction.ignored,
            kind_counts=kind_counts,
            changed_items=changed_items,
        )
    )
