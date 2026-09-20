from __future__ import annotations

import hashlib
import json
import logging
import math
import re
import threading
import time
import uuid
from collections.abc import Iterable, Mapping
from contextlib import suppress
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
from .annotation_color_service import annotation_color_name
from .chapter_scope_service import referenced_chapter_numbers
from .drawboard_service import (
    DrawboardCapture,
    DrawboardError,
    DrawboardExtraction,
    DrawboardInk,
    extract_drawboard_annotations,
    is_drawboard_cloud_url,
    merge_ink_annotation_groups,
)
from .pdf_context_service import (
    PdfAnnotationContext,
    PdfContextError,
    extract_pdf_annotation_contexts,
)
from .pdf_ink_image_service import (
    render_annotated_page_images,
    render_ink_context_images,
    render_local_annotation_images,
)
from .pdf_layout_service import (
    PdfPageLayout,
    analyze_pdf_page_layouts,
    region_layout_column,
    suggested_capture_rect,
)
from .question_region_service import question_region_groups
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
    origin: str = "pdf_import"
    layout_mode: str = "single"
    layout_column: str = "full"
    page_width: float = 0.0
    page_height: float = 0.0
    proposed_capture_rect: tuple[float, ...] = ()
    capture_rect: tuple[float, ...] = ()


@dataclass(frozen=True, slots=True)
class PdfExtraction:
    path: Path | str
    captures: list[PdfCapture]
    ignored: dict[str, int]
    source_fingerprints: set[str] | None = None
    cloud_source: DrawboardExtraction | None = None


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
    source_fingerprint: str = ""
    context_image_url: str = ""
    annotated_page_image_url: str = ""
    proposed_capture_rect: list[float] = field(default_factory=list)
    capture_rect: list[float] = field(default_factory=list)
    page_width: float = 0.0
    page_height: float = 0.0
    layout_mode: str = "single"
    layout_column: str = "full"
    requires_capture_review: bool = False


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
        (anchor.quote if anchor else None) or command.plain_text or command.markdown or "Screenshot"
    )
    return PdfCollectionItem(
        outcome=outcome,
        kind=command.kind,
        text=" ".join(text_value.split())[:280],
        page=anchor.page_number if anchor else None,
        section_title=(anchor.section_title or "") if anchor else "",
        source_day_id=source_day_id,
        source_fingerprint=command.source_fingerprint or "",
        context_image_url=str((anchor.metadata if anchor else {}).get("contextImageUrl") or ""),
        annotated_page_image_url=str(
            (anchor.metadata if anchor else {}).get("annotatedPageImageUrl") or ""
        ),
        proposed_capture_rect=list(
            (anchor.metadata if anchor else {}).get("proposedCaptureRect") or []
        ),
        capture_rect=list((anchor.metadata if anchor else {}).get("captureRect") or []),
        page_width=float((anchor.metadata if anchor else {}).get("pageWidth") or 0),
        page_height=float((anchor.metadata if anchor else {}).get("pageHeight") or 0),
        layout_mode=str((anchor.metadata if anchor else {}).get("pageLayout") or "single"),
        layout_column=str((anchor.metadata if anchor else {}).get("layoutColumn") or "full"),
        requires_capture_review=bool(
            (anchor.metadata if anchor else {}).get("contextImageUrl")
            and command.kind in {"question", "todo"}
        ),
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
        raise workspace_repository.EntityNotFoundError(f"Resource does not exist: {resource_id}")
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
        if re.fullmatch(r"#[0-9A-Fa-f]{6}", str(color)) and role in {"question", "regular"}
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


def _annotation_palette(
    captures: list[PdfCapture],
    roles: dict[str, str],
) -> list[DrawboardColorPaletteEntry]:
    items: dict[str, dict[str, Any]] = {}
    for capture in captures:
        key = drawboard_color_key(capture.rgb)
        if not key:
            continue
        entry = items.setdefault(
            key, {"rgb": capture.rgb, "count": 0, "kinds": set(), "red": False}
        )
        entry["count"] += 1
        entry["kinds"].add(capture.annotation_kind)
        entry["red"] = entry["red"] or capture.color == "red"
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


def _is_question_color(rgb: list[float], color: str, roles: dict[str, str]) -> bool:
    # Explicit course choices override the red default, for local and cloud PDFs.
    return (
        roles.get(drawboard_color_key(rgb), "question" if color == "red" else "regular")
        == "question"
    )


def _capture_as_ink(capture: PdfCapture | DrawboardCapture) -> DrawboardInk:
    return DrawboardInk(
        fingerprint=capture.fingerprint,
        source_revision=hashlib.sha256(
            json.dumps(asdict(capture), sort_keys=True).encode()
        ).hexdigest(),
        page=capture.page,
        color=capture.color,
        rgb=capture.rgb,
        created_at=capture.created_at,
        rect=capture.rect,
        ink_vertex_sets=capture.ink_vertex_sets if isinstance(capture, PdfCapture) else (),
        member_fingerprints=(capture.fingerprint,),
    )


def _from_drawboard(extraction: DrawboardExtraction) -> PdfExtraction:
    """Connector adapter only: retain source IDs and native Drawboard coordinates."""
    captures = [
        PdfCapture(
            fingerprint=capture.fingerprint,
            page=capture.page,
            annotation_kind={
                "TextHighlight": "Highlight",
                "TextUnderline": "Underline",
                "TextInsert": "FreeText",
            }.get(capture.annotation_kind, capture.annotation_kind),
            color=capture.color,
            rgb=capture.rgb,
            quote=capture.quote,
            comment=capture.comment,
            is_question=False,
            created_at=capture.created_at,
            rect=capture.rect,
            source_revision=capture.source_revision,
            origin="drawboard_cloud",
        )
        for capture in extraction.captures
    ]
    captures.extend(
        PdfCapture(
            fingerprint=ink.fingerprint,
            page=ink.page,
            annotation_kind="Ink",
            color=ink.color,
            rgb=ink.rgb,
            quote="",
            comment="",
            is_question=False,
            created_at=ink.created_at,
            rect=ink.rect,
            source_revision=ink.source_revision,
            ink_vertex_sets=ink.ink_vertex_sets,
            member_fingerprints=ink.member_fingerprints,
            origin="drawboard_cloud_ink",
        )
        for ink in extraction.all_ink
    )
    return PdfExtraction(
        path=extraction.source_url,
        captures=captures,
        ignored=extraction.ignored,
        source_fingerprints=extraction.source_fingerprints
        or {capture.fingerprint for capture in captures},
        cloud_source=extraction,
    )


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
    return annotation_color_name(rgb), rgb


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
        is_question=False,  # The shared collection policy owns classification.
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


def _classify_question_annotations(
    extraction: PdfExtraction,
    states: dict[str, dict[str, Any]],
    roles: dict[str, str],
    page_layouts: Mapping[int, PdfPageLayout] | None = None,
    capture_overrides: Mapping[str, list[float]] | None = None,
) -> PdfExtraction:
    """Select question marks before grouping; regular handwriting stays in the PDF."""
    previous = {
        fingerprint: state
        for fingerprint, state in states.items()
        if state["kind"] in {"question", "todo"}
    }
    tracked_members = {
        member
        for fingerprint, state in previous.items()
        for member in state["metadata"].get("inkMemberFingerprints", [fingerprint])
    }
    questions = []
    result = []
    ignored = dict(extraction.ignored)
    for capture in extraction.captures:
        source_text = capture.comment or capture.quote
        is_question = (
            _is_question_color(capture.rgb, capture.color, roles)
            or capture.fingerprint in tracked_members
            or "??" in source_text
            or "todo!" in source_text.casefold()
        )
        classified = replace(capture, is_question=is_question)
        if is_question:
            questions.append(classified)
        elif capture.annotation_kind in VISUAL_KINDS:
            ignored["non_question_visual"] = ignored.get("non_question_visual", 0) + 1
        else:
            result.append(classified)
    by_id = {capture.fingerprint: capture for capture in questions}
    claimed: set[str] = set()
    for members in question_region_groups(questions, page_layouts):
        combined = merge_ink_annotation_groups([_capture_as_ink(member) for member in members])
        visuals = [member for member in members if member.annotation_kind in VISUAL_KINDS]
        anchor = merge_ink_annotation_groups(
            [_capture_as_ink(member) for member in (visuals or members)]
        )
        member_ids = {member.fingerprint for member in members}
        fingerprint = next(
            (
                key
                for key, state in previous.items()
                if key not in claimed
                and not (key.startswith("pdf-") and not key.startswith("pdf-source-"))
                and member_ids.intersection(state["metadata"].get("inkMemberFingerprints", [key]))
            ),
            anchor.fingerprint,
        )
        claimed.add(fingerprint)
        layout = page_layouts.get(anchor.page) if page_layouts else None
        layout_column = region_layout_column(combined.rect, layout)
        proposed_rect: list[float] = []
        final_rect: list[float] = []
        if layout is not None:
            proposed_rect = suggested_capture_rect(
                combined.rect,
                layout,
                column=layout_column,
                drawboard_coordinates=extraction.cloud_source is not None,
                margin=12.0 if extraction.cloud_source is not None else 36.0,
            )
            override = (capture_overrides or {}).get(fingerprint)
            if override is not None:
                final_rect = _validated_capture_rect(override, layout)
            else:
                final_rect = proposed_rect
        result.append(
            replace(
                by_id[anchor.fingerprint],
                fingerprint=fingerprint,
                rect=combined.rect,
                is_question=True,
                source_revision=members[0].source_revision
                if len(members) == 1
                else combined.source_revision,
                ink_vertex_sets=combined.ink_vertex_sets,
                member_fingerprints=tuple(sorted(member_ids)),
                quote="\n\n".join(
                    dict.fromkeys(member.quote for member in members if member.quote)
                ),
                comment="\n\n".join(
                    dict.fromkeys(member.comment for member in members if member.comment)
                ),
                layout_mode=layout.mode if layout else "single",
                layout_column=layout_column,
                page_width=layout.width if layout else 0.0,
                page_height=layout.height if layout else 0.0,
                proposed_capture_rect=tuple(proposed_rect),
                capture_rect=tuple(final_rect),
            )
        )
    return replace(
        extraction,
        captures=sorted(
            result,
            key=lambda item: (
                item.page,
                item.rect[1] if len(item.rect) == 4 else 0,
                item.rect[0] if len(item.rect) == 4 else 0,
            ),
        ),
        ignored=ignored,
    )


def _validated_capture_rect(rect: list[float], layout: PdfPageLayout) -> list[float]:
    if len(rect) != 4:
        raise PdfAnnotationError("A capture correction must contain four coordinates.")
    try:
        x0, y0, x1, y1 = (float(value) for value in rect)
    except (TypeError, ValueError) as error:
        raise PdfAnnotationError(
            "A capture correction contains a non-numeric coordinate."
        ) from error
    if not all(math.isfinite(value) for value in (x0, y0, x1, y1)):
        raise PdfAnnotationError("A capture correction contains a non-finite coordinate.")
    x0, x1 = sorted((x0, x1))
    y0, y1 = sorted((y0, y1))
    values = [
        max(0.0, min(x0, layout.width)),
        max(0.0, min(y0, layout.height)),
        max(0.0, min(x1, layout.width)),
        max(0.0, min(y1, layout.height)),
    ]
    if values[2] - values[0] < 8 or values[3] - values[1] < 8:
        raise PdfAnnotationError("A capture correction is too small to render.")
    return [round(value, 3) for value in values]


def _annotation_command(
    resource_id: str,
    source_path: Path | str,
    capture: PdfCapture,
    context: PdfAnnotationContext | None,
    sync_revision: str,
    source_day_id: str | None = None,
    cloud_document_id: str | None = None,
) -> AnnotationCreateCommand:
    kind: AnnotationKind = (
        "question" if capture.is_question else "highlight" if capture.quote else "note"
    )
    text_question = (
        capture.is_question and capture.annotation_kind not in VISUAL_KINDS
    )
    body = capture.comment or (
        capture.quote
        if text_question
        else "Screenshot · handwriting"
        if capture.annotation_kind == "Ink"
        else f"Screenshot · {capture.annotation_kind}"
        if capture.annotation_kind in VISUAL_KINDS
        else ""
    )
    metadata: dict[str, Any] = {
        "createdAt": capture.created_at,
        "sourceLabel": "Drawboard cloud PDF" if cloud_document_id else Path(source_path).name,
        "sourcePath": str(source_path),
        "syncRevision": sync_revision,
        "sourceRevision": capture.source_revision,
        "colorRoleRevision": f"question-policy-v1:{capture.is_question}",
        "questionGrouping": "layout-lanes-y-overlap-v2",
        "highlightedText": capture.quote,
        "sourceContent": capture.comment or (capture.quote if text_question else ""),
        "sourceVisual": capture.annotation_kind in VISUAL_KINDS,
        "pageLayout": capture.layout_mode,
        "layoutColumn": capture.layout_column,
        "proposedCaptureRect": list(capture.proposed_capture_rect),
        "captureRect": list(capture.capture_rect),
        **_context_metadata(context),
    }
    if capture.page_width:
        metadata["pageWidth"] = capture.page_width
    if capture.page_height:
        metadata["pageHeight"] = capture.page_height
    if cloud_document_id:
        metadata["drawboardDocumentId"] = cloud_document_id
    if source_day_id:
        metadata["createdDayId"] = source_day_id
    if capture.member_fingerprints:
        metadata["inkMemberFingerprints"] = list(capture.member_fingerprints)
        metadata["inkGroupSize"] = len(capture.member_fingerprints)
    return AnnotationCreateCommand(
        resource_id=resource_id,
        kind=kind,
        origin=capture.origin,
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
    capture_overrides: Mapping[str, list[float]] | None = None,
) -> PdfCollection:
    with _COLLECTION_LOCK:
        return _collect_resource_pdf_annotations(
            connection,
            resource_id,
            source_day_id,
            capture_overrides=capture_overrides,
        )


def _collect_resource_pdf_annotations(
    connection: Connection,
    resource_id: str,
    source_day_id: str | None = None,
    *,
    capture_overrides: Mapping[str, list[float]] | None = None,
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
        extraction = _from_drawboard(cloud_extraction)
        safe_path = None
        if local_path:
            with suppress(ResourceOpenError):
                safe_path = safe_local_resource_path(local_path)
        source_stat = None
    else:
        if not local_path:
            raise PdfAnnotationError("This resource has no local PDF path.")
        try:
            safe_path = readable_local_resource_path(local_path)
        except ResourceOpenError as error:
            raise PdfAnnotationError(str(error)) from error
        source_stat = safe_path.stat()
        extraction = extract_pdf_annotations(safe_path)

    roles = drawboard_color_roles(connection, resource_id)
    color_palette = _annotation_palette(extraction.captures, roles)
    # Both connectors use the course palette and the same confirmation UI.
    if any(entry.role is None for entry in color_palette):
        if extraction.cloud_source:
            _PENDING_PALETTE = (
                cache_key,
                source_url or "",
                snapshot_started_at,
                extraction.cloud_source,
            )
        return _logged_collection(
            PdfCollection(
                resource_id=resource_id,
                path=str(extraction.path),
                extracted_count=len(extraction.captures),
                created_count=0,
                updated_count=0,
                existing_count=0,
                removed_count=0,
                ignored=extraction.ignored,
                kind_counts={},
                color_palette=color_palette,
                requires_color_roles=True,
            )
        )
    page_layouts: dict[int, PdfPageLayout] = {}
    if safe_path is not None:
        try:
            page_layouts = analyze_pdf_page_layouts(safe_path)
        except Exception:
            logger.warning(
                "PDF layout detection unavailable resource_id=%s path=%s",
                resource_id,
                safe_path,
            )
    states = workspace_repository.imported_annotation_states(connection, resource_id)
    extraction = _classify_question_annotations(
        extraction,
        states,
        roles,
        page_layouts,
        capture_overrides,
    )
    # Closed questions retain their saved screenshots. New/open captures follow
    # the PDF currently synced to disk, with immutable snapshots for old answers.
    preview_captures = [
        capture
        for capture in extraction.captures
        if capture.annotation_kind in VISUAL_KINDS
        and (capture.fingerprint not in states or states[capture.fingerprint]["status"] == "open")
    ]
    annotated_pages = {capture.page for capture in extraction.captures}
    review_pages = {
        neighbor
        for capture in preview_captures
        for neighbor in (capture.page - 1, capture.page, capture.page + 1)
        if neighbor in annotated_pages
    }
    images: dict[str, str] = {}
    pages: dict[int, str] = {}
    contexts: dict[str, PdfAnnotationContext] = {}
    cloud = extraction.cloud_source
    if safe_path is not None:
        if cloud is None:
            try:
                images, pages = render_local_annotation_images(
                    safe_path,
                    resource_id,
                    [
                        (capture.fingerprint, capture.page, capture.rect)
                        for capture in preview_captures
                    ],
                    page_numbers=review_pages,
                    crop_rects={
                        capture.fingerprint: list(capture.capture_rect)
                        for capture in preview_captures
                        if capture.capture_rect
                    },
                )
            except Exception as error:
                raise PdfAnnotationError(
                    f"Could not render embedded PDF annotations: {safe_path.name}. "
                    "Nothing was imported."
                ) from error
        else:
            # Drawboard stores vectors separately; only this renderer needs the
            # original cloud payload. Selection/grouping/persistence are shared.
            preview_inks = [
                _capture_as_ink(capture)
                for capture in preview_captures
                if capture.annotation_kind in VISUAL_KINDS
            ]
            try:
                images = (
                    render_ink_context_images(
                        safe_path,
                        resource_id,
                        preview_inks,
                        captures=cloud.captures,
                        page_inks=cloud.all_ink,
                        crop_rects={
                            capture.fingerprint: list(capture.capture_rect)
                            for capture in preview_captures
                            if capture.capture_rect
                        },
                    )
                    if preview_inks
                    else {}
                )
                pages = render_annotated_page_images(
                    safe_path,
                    resource_id,
                    review_pages,
                    captures=cloud.captures,
                    page_inks=cloud.all_ink,
                )
            except Exception:
                logger.exception("Cloud preview rendering failed resource_id=%s", resource_id)
        with suppress(PdfContextError):
            contexts = extract_pdf_annotation_contexts(
                safe_path,
                extraction.captures,
                drawboard_coordinates=cloud is not None,
            )
        if source_stat is not None:
            current_stat = safe_path.stat()
            if (source_stat.st_mtime_ns, source_stat.st_size, source_stat.st_ino) != (
                current_stat.st_mtime_ns,
                current_stat.st_size,
                current_stat.st_ino,
            ):
                raise PdfAnnotationError(
                    "The PDF changed during collection. Let syncing finish and retry."
                )
    counts = {"created": 0, "existing": 0, "updated": 0}
    changed_items = []
    kind_counts: dict[str, int] = {}
    chapter_study_days = _chapter_study_days(connection, resource_id)
    for capture in extraction.captures:
        source_version = hashlib.sha256(
            json.dumps(
                {
                    key: value
                    for key, value in asdict(capture).items()
                    if key != "legacy_fingerprint"
                },
                sort_keys=True,
            ).encode()
        ).hexdigest()
        context = contexts.get(capture.fingerprint)
        capture_day_id = _capture_study_day(
            context,
            chapter_study_days,
            source_day_id,
        )
        sync_revision = (
            f"{source_version}:"
            f"{'pdf-paragraph-context-v1' if context else 'local-plain-v1'}:"
            f"study-day-v1:{capture_day_id or '-'}:"
            f"roles:{json.dumps(roles, sort_keys=True)}:"
            f"capture:{json.dumps(capture.capture_rect)}"
        )
        command = _annotation_command(
            resource_id,
            extraction.path,
            capture,
            context,
            sync_revision,
            capture_day_id,
            cloud_document_id=cloud.document_id if cloud else None,
        )
        if command.anchor is not None:
            if capture.fingerprint in images:
                command.anchor.metadata["contextImageUrl"] = images[capture.fingerprint]
            if capture in preview_captures and capture.page in pages:
                command.anchor.metadata["annotatedPageImageUrl"] = pages[capture.page]
                _attach_page_snapshots(command, pages)
        if cloud is None:
            workspace_repository.adopt_local_pdf_identity(
                connection,
                command,
                capture.legacy_fingerprint,
                previous_source_fingerprint=capture.previous_source_fingerprint,
            )
        kind_counts[command.kind] = kind_counts.get(command.kind, 0) + 1
        outcome = workspace_repository.upsert_imported_annotation(
            connection,
            command,
            source_revision=sync_revision,
        )
        if (
            capture.is_question
            and capture.annotation_kind in VISUAL_KINDS
            and outcome != "existing"
        ):
            workspace_repository.reconcile_imported_question_frame(
                connection, resource_id, capture.fingerprint
            )
        counts[outcome] += 1
        if outcome in {"created", "updated"}:
            changed_items.append(_collection_item(command, outcome, capture_day_id))
        if capture.fingerprint in (capture_overrides or {}) and capture.capture_rect:
            _log_capture_review(connection, resource_id, capture)
    return _logged_collection(
        PdfCollection(
            resource_id=resource_id,
            path=str(extraction.path),
            extracted_count=len(extraction.captures),
            created_count=counts["created"],
            updated_count=counts["updated"],
            existing_count=counts["existing"],
            removed_count=workspace_repository.soft_delete_stale_imported_annotations(
                connection,
                resource_id,
                extraction.source_fingerprints
                if extraction.source_fingerprints is not None
                else {capture.fingerprint for capture in extraction.captures},
                origins=("drawboard_cloud", "drawboard_cloud_ink") if cloud else ("pdf_import",),
            ),
            ignored=extraction.ignored,
            color_palette=color_palette,
            kind_counts=kind_counts,
            changed_items=changed_items,
        )
    )


def _log_capture_review(
    connection: Connection,
    resource_id: str,
    capture: PdfCapture,
) -> None:
    connection.execute(
        text("""
            INSERT INTO capture_region_corrections (
              id, resource_id, source_fingerprint, page_number,
              layout_mode, layout_column, proposed_rect_json, final_rect_json,
              page_width, page_height, created_at
            ) VALUES (
              :id, :resource_id, :source_fingerprint, :page_number,
              :layout_mode, :layout_column, :proposed_rect_json, :final_rect_json,
              :page_width, :page_height, :created_at
            )
            """),
        {
            "id": str(uuid.uuid4()),
            "resource_id": resource_id,
            "source_fingerprint": capture.fingerprint,
            "page_number": capture.page,
            "layout_mode": capture.layout_mode,
            "layout_column": capture.layout_column,
            "proposed_rect_json": json.dumps(capture.proposed_capture_rect),
            "final_rect_json": json.dumps(capture.capture_rect),
            "page_width": capture.page_width,
            "page_height": capture.page_height,
            "created_at": _utc_now_iso(),
        },
    )
