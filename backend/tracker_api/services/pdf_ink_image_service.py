from __future__ import annotations

import hashlib
import json
import logging
import math
import re
import tempfile
from collections.abc import Iterable, Mapping
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, TypeGuard

import pymupdf

from ..config import get_settings
from .drawboard_service import DrawboardCapture, DrawboardInk

SAFE_ID = re.compile(r"^[a-zA-Z0-9_-]+$")
INK_RENDERER_VERSION = "ink-render-v9"
INK_VECTOR_EMBOLDEN_WIDTH = 0.22
PDF_BLEND_MODES = {
    "darken": "Darken",
    "lighten": "Lighten",
    "multiply": "Multiply",
    "normal": "Normal",
    "overlay": "Overlay",
    "screen": "Screen",
}

logger = logging.getLogger("uvicorn.error")


class PdfInkImageError(RuntimeError):
    """Raised when a handwritten annotation image cannot be rendered."""


def annotation_image_path(resource_id: str, image_id: str) -> Path:
    if not SAFE_ID.fullmatch(resource_id) or not SAFE_ID.fullmatch(image_id):
        raise PdfInkImageError("Invalid annotation image identifier.")
    return get_settings().annotation_image_dir / resource_id / f"{image_id}.png"


def annotation_image_url(
    resource_id: str,
    image_id: str,
    *,
    source_revision: str | None = None,
) -> str:
    base = f"/api/resources/{resource_id}/annotation-images/{image_id}"
    if not source_revision:
        return base
    version = hashlib.sha1(
        f"{INK_RENDERER_VERSION}:{source_revision}".encode(),
        usedforsecurity=False,
    ).hexdigest()[:12]
    return f"{base}?v={version}"


def drawboard_rect_to_pdf(
    rect: list[float],
    page_height: float,
) -> list[float]:
    if len(rect) != 4:
        return rect
    return [
        rect[0],
        page_height - rect[3],
        rect[2],
        page_height - rect[1],
    ]


def _is_number(value: object) -> TypeGuard[int | float]:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _point(value: object) -> tuple[float, float] | None:
    if isinstance(value, dict):
        x = value.get("x")
        y = value.get("y")
        if _is_number(x) and _is_number(y):
            return float(x), float(y)
        return None
    if (
        isinstance(value, (list, tuple))
        and len(value) >= 2
        and _is_number(value[0])
        and _is_number(value[1])
        and len(value) <= 3
    ):
        return float(value[0]), float(value[1])
    return None


def _ink_coordinate_paths(value: object) -> list[list[tuple[float, float]]]:
    """Return independent Drawboard ink paths without joining pen lifts.

    Drawboard ink data may be a flat coordinate list, a list of point pairs,
    or a nested list containing several independent pen strokes. Flattening
    the whole structure and drawing one polyline creates artificial connector
    lines between letters and words. This parser preserves every leaf path.
    """

    if not isinstance(value, (list, tuple)) or not value:
        return []

    if all(_is_number(item) for item in value):
        numbers = [float(item) for item in value]
        if len(numbers) < 4:
            return []
        return [[(numbers[index], numbers[index + 1]) for index in range(0, len(numbers) - 1, 2)]]

    points = [_point(item) for item in value]
    if points and all(point is not None for point in points):
        path = [point for point in points if point is not None]
        return [path] if len(path) >= 2 else []

    paths: list[list[tuple[float, float]]] = []
    for item in value:
        paths.extend(_ink_coordinate_paths(item))
    return paths


def _ink_paths(
    ink_vertices: list[Any],
    page_height: float,
) -> list[list[pymupdf.Point]]:
    return [
        [
            pymupdf.Point(x, page_height - y)  # type: ignore[no-untyped-call]
            for x, y in path
        ]
        for path in _ink_coordinate_paths(ink_vertices)
        if len(path) >= 2
    ]


@dataclass(frozen=True, slots=True)
class InkLine:
    end: tuple[float, float]


@dataclass(frozen=True, slots=True)
class InkBezier:
    control_1: tuple[float, float]
    control_2: tuple[float, float]
    end: tuple[float, float]


@dataclass(frozen=True, slots=True)
class InkOutline:
    start: tuple[float, float]
    segments: tuple[InkLine | InkBezier, ...]


def _distance(
    first: tuple[float, float],
    second: tuple[float, float],
) -> float:
    return math.hypot(second[0] - first[0], second[1] - first[1])


def _numeric_points(value: object) -> list[tuple[float, float]] | None:
    if (
        not isinstance(value, (list, tuple))
        or not value
        or len(value) % 2 != 0
        or not all(_is_number(number) for number in value)
    ):
        return None
    numbers = [float(number) for number in value]
    return [(numbers[index], numbers[index + 1]) for index in range(0, len(numbers), 2)]


def _decode_drawboard_segment(
    value: object,
    current: tuple[float, float],
) -> tuple[list[InkLine | InkBezier], tuple[float, float], bool] | None:
    points = _numeric_points(value)
    if not points:
        return None

    line_cost = 0.0
    line_cursor = current
    for point in points:
        line_cost += _distance(line_cursor, point)
        line_cursor = point

    if len(points) % 3 != 0:
        return [InkLine(point) for point in points], points[-1], False

    beziers: list[InkLine | InkBezier] = []
    bezier_cost = 0.0
    bezier_cursor = current
    for index in range(0, len(points), 3):
        end, control_1, control_2 = points[index : index + 3]
        bezier_cost += _distance(bezier_cursor, control_1)
        bezier_cost += _distance(control_1, control_2)
        bezier_cost += _distance(control_2, end)
        beziers.append(
            InkBezier(
                control_1=control_1,
                control_2=control_2,
                end=end,
            )
        )
        bezier_cursor = end

    # Drawboard uses the same flattened numeric representation for both
    # polyline runs and cubic curves. The intended interpretation is the one
    # that preserves the shorter continuous pen path.
    if bezier_cost < line_cost:
        return beziers, bezier_cursor, True
    return [InkLine(point) for point in points], points[-1], False


def _ink_outline_paths(value: object) -> list[InkOutline]:
    """Decode the filled paths used by Drawboard's own SVG renderer.

    Drawboard stores each cubic segment as ``end, control 1, control 2``.
    Its web viewer reorders that payload into the SVG command
    ``C control1 control2 end`` and closes the resulting outline. Keeping that
    geometry intact avoids the jagged, doubled handwriting produced by
    treating all of those values as ordinary polyline points.
    """

    if not isinstance(value, (list, tuple)) or not value:
        return []

    start = _point(value[0])
    if start is not None and len(value) >= 2:
        segments: list[InkLine | InkBezier] = []
        has_bezier = False
        has_compound_lines = False
        valid = True
        current = start
        for item in value[1:]:
            decoded = _decode_drawboard_segment(item, current)
            if decoded is None:
                valid = False
                break
            item_segments, current, item_has_bezier = decoded
            segments.extend(item_segments)
            has_bezier = has_bezier or item_has_bezier
            has_compound_lines = has_compound_lines or len(item_segments) > 1
        if valid and segments and (has_bezier or has_compound_lines):
            return [InkOutline(start=start, segments=tuple(segments))]

    paths: list[InkOutline] = []
    for item in value:
        paths.extend(_ink_outline_paths(item))
    return paths


def _pdf_point(point: tuple[float, float], page_height: float) -> pymupdf.Point:
    return pymupdf.Point(  # type: ignore[no-untyped-call]
        point[0],
        page_height - point[1],
    )


def _render_drawboard_outlines(
    page: Any,
    ink_vertices: object,
    *,
    page_height: float,
    color: tuple[float, ...],
    opacity: float,
    blend_mode: str,
) -> bool:
    outlines = _ink_outline_paths(ink_vertices)
    if not outlines:
        return False

    fill_opacity, stroke_opacity = _blend_opacities(
        page,
        fill_opacity=opacity,
        stroke_opacity=opacity,
        blend_mode=blend_mode,
    )
    shape = page.new_shape()
    for outline in outlines:
        current = _pdf_point(outline.start, page_height)
        start = current
        for segment in outline.segments:
            if isinstance(segment, InkLine):
                end = _pdf_point(segment.end, page_height)
                shape.draw_line(current, end)
            else:
                end = _pdf_point(segment.end, page_height)
                shape.draw_bezier(
                    current,
                    _pdf_point(segment.control_1, page_height),
                    _pdf_point(segment.control_2, page_height),
                    end,
                )
            current = end
        if current != start:
            shape.draw_line(current, start)
    shape.finish(
        width=INK_VECTOR_EMBOLDEN_WIDTH,
        color=color,
        fill=color,
        lineCap=1,
        lineJoin=1,
        even_odd=True,
        closePath=False,
        fill_opacity=fill_opacity,
        stroke_opacity=stroke_opacity,
    )
    shape.commit(overlay=True)
    return True


def _capture_rects(
    capture: DrawboardCapture,
    page_height: float,
) -> list[pymupdf.Rect]:
    raw_rects: Iterable[Iterable[float]] = capture.rects or (capture.rect,)
    result: list[pymupdf.Rect] = []
    for rect in raw_rects:
        values = list(rect)
        if len(values) != 4:
            continue
        result.append(
            pymupdf.Rect(  # type: ignore[no-untyped-call]
                drawboard_rect_to_pdf(values, page_height)
            )
        )
    return result


def _render_capture(
    page: Any,
    capture: DrawboardCapture,
    *,
    page_height: float,
    clip: pymupdf.Rect | None = None,
) -> None:
    if len(capture.rgb) < 3:
        return
    color = tuple(capture.rgb[:3])
    for capture_rect in _capture_rects(capture, page_height):
        if clip is not None and not capture_rect.intersects(clip):  # type: ignore[no-untyped-call]
            continue
        if capture.annotation_kind == "TextUnderline":
            page.draw_line(
                capture_rect.bottom_left,
                capture_rect.bottom_right,
                color=color,
                width=1.1,
                overlay=True,
            )
        elif capture.annotation_kind == "TextHighlight":
            fill_opacity, _stroke_opacity = _blend_opacities(
                page,
                fill_opacity=capture.opacity,
                stroke_opacity=1.0,
                blend_mode=capture.blend_mode,
            )
            page.draw_rect(
                capture_rect,
                color=None,
                fill=color,
                fill_opacity=fill_opacity,
                overlay=True,
            )
        else:
            page.draw_rect(
                capture_rect,
                color=color,
                width=0.8,
                overlay=True,
            )


def _blend_opacities(
    page: Any,
    *,
    fill_opacity: float,
    stroke_opacity: float,
    blend_mode: str,
) -> tuple[float, float]:
    """Register a PDF blend mode and return draw-compatible opacities.

    PyMuPDF exposes alpha ExtGStates but does not currently attach the blend
    mode passed to its private helper. Adding ``/BM`` to that same resource
    preserves Drawboard's Multiply highlights so dark text remains visible.
    """

    normalized = PDF_BLEND_MODES.get(blend_mode.casefold())
    clamped_fill = max(0.0, min(fill_opacity, 1.0))
    clamped_stroke = max(0.0, min(stroke_opacity, 1.0))
    if normalized in (None, "Normal"):
        return clamped_fill, clamped_stroke

    # Fully opaque values do not otherwise allocate an ExtGState. These values
    # are visually equivalent while giving the blend mode a resource to attach
    # to for either a filled highlight or a freehand highlighter path.
    effective_fill = min(clamped_fill, 0.999)
    effective_stroke = min(clamped_stroke, 0.999)
    state_name = page._set_opacity(CA=effective_stroke, ca=effective_fill)
    if not state_name:
        return effective_fill, effective_stroke
    resource_kind, resource_value = page.parent.xref_get_key(
        page.xref,
        "Resources",
    )
    if resource_kind != "xref":
        return effective_fill, effective_stroke
    resource_xref = int(resource_value.split()[0])
    page.parent.xref_set_key(
        resource_xref,
        f"ExtGState/{state_name}/Type",
        "/ExtGState",
    )
    page.parent.xref_set_key(
        resource_xref,
        f"ExtGState/{state_name}/BM",
        f"/{normalized}",
    )
    return effective_fill, effective_stroke


def _save_snapshot(pixmap: Any, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        dir=output_path.parent, suffix=".png", delete=False
    ) as temporary:
        temporary_path = Path(temporary.name)
    try:
        pixmap.save(temporary_path)
        temporary_path.replace(output_path)
    finally:
        temporary_path.unlink(missing_ok=True)


def _render_ink(
    source_document: Any,
    ink: DrawboardInk,
    output_path: Path,
    *,
    captures: Iterable[DrawboardCapture],
    page_inks: Iterable[DrawboardInk],
    margin: float,
    scale: float,
    stroke_width: float,
    crop_rect: list[float] | None = None,
) -> None:
    if ink.page < 1 or ink.page > source_document.page_count:
        raise PdfInkImageError(f"Ink page is outside the PDF: {ink.page}")
    source_page = source_document[ink.page - 1]
    overlay_document = pymupdf.open()  # type: ignore[no-untyped-call]
    try:
        overlay_page = overlay_document.new_page(
            width=source_page.rect.width,
            height=source_page.rect.height,
        )
        overlay_page.show_pdf_page(overlay_page.rect, source_document, ink.page - 1)
        pdf_rect = drawboard_rect_to_pdf(ink.rect, source_page.rect.height)
        if len(pdf_rect) == 4 and not all(math.isfinite(value) for value in pdf_rect):
            raise PdfInkImageError(f"Ink has non-finite crop coordinates: {ink.fingerprint}")
        raw_y0 = min(pdf_rect[1], pdf_rect[3]) if len(pdf_rect) == 4 else 0.0
        raw_y1 = max(pdf_rect[1], pdf_rect[3]) if len(pdf_rect) == 4 else source_page.rect.height
        y0 = max(source_page.rect.y0, raw_y0 - margin)
        y1 = min(source_page.rect.y1, raw_y1 + margin)
        clip = (
            pymupdf.Rect(crop_rect) & source_page.rect  # type: ignore[no-untyped-call]
            if crop_rect and len(crop_rect) == 4
            else pymupdf.Rect(  # type: ignore[no-untyped-call]
                source_page.rect.x0, y0, source_page.rect.x1, y1
            )
        )
        if clip.is_empty or not clip.is_valid or clip.width * scale < 1 or clip.height * scale < 1:
            raise PdfInkImageError(
                "Ink crop is outside the matching PDF page: "
                f"{ink.fingerprint} page={ink.page} rect={ink.rect}"
            )

        for capture in captures:
            if capture.page != ink.page:
                continue
            _render_capture(
                overlay_page,
                capture,
                page_height=source_page.rect.height,
                clip=clip,
            )

        visible_inks = [
            item
            for item in page_inks
            if item.page == ink.page
            and len(item.rect) == 4
            and pymupdf.Rect(  # type: ignore[no-untyped-call]
                drawboard_rect_to_pdf(item.rect, source_page.rect.height)
            ).intersects(clip)
        ]
        for visible_ink in visible_inks or [ink]:
            for ink_vertices in visible_ink.ink_vertex_sets:
                if _render_drawboard_outlines(
                    overlay_page,
                    ink_vertices,
                    page_height=source_page.rect.height,
                    color=tuple(visible_ink.rgb),
                    opacity=visible_ink.opacity,
                    blend_mode=visible_ink.blend_mode,
                ):
                    continue
                _fill_opacity, stroke_opacity = _blend_opacities(
                    overlay_page,
                    fill_opacity=1.0,
                    stroke_opacity=visible_ink.opacity,
                    blend_mode=visible_ink.blend_mode,
                )
                for points in _ink_paths(ink_vertices, source_page.rect.height):
                    overlay_page.draw_polyline(
                        points,
                        color=tuple(visible_ink.rgb),
                        width=stroke_width,
                        lineCap=1,
                        lineJoin=1,
                        stroke_opacity=stroke_opacity,
                        overlay=True,
                    )
        try:
            pixmap = overlay_page.get_pixmap(
                matrix=pymupdf.Matrix(scale, scale),  # type: ignore[no-untyped-call]
                clip=clip,
                alpha=False,
                colorspace=pymupdf.csRGB,
            )
            if pixmap.width < 1 or pixmap.height < 1:
                raise PdfInkImageError(f"Ink crop rendered an empty image: {ink.fingerprint}")
            output_path.parent.mkdir(parents=True, exist_ok=True)
            _save_snapshot(pixmap, output_path)
        except PdfInkImageError:
            raise
        except Exception as error:
            raise PdfInkImageError(
                f"Could not render handwriting crop {ink.fingerprint} on page {ink.page}: {error}"
            ) from error
    finally:
        overlay_document.close()  # type: ignore[no-untyped-call]


def _render_annotated_page(
    source_document: Any,
    page_number: int,
    output_path: Path,
    *,
    captures: Iterable[DrawboardCapture],
    page_inks: Iterable[DrawboardInk],
    scale: float,
    stroke_width: float,
) -> None:
    if page_number < 1 or page_number > source_document.page_count:
        raise PdfInkImageError(f"Annotation page is outside the PDF: {page_number}")
    source_page = source_document[page_number - 1]
    overlay_document = pymupdf.open()  # type: ignore[no-untyped-call]
    try:
        overlay_page = overlay_document.new_page(
            width=source_page.rect.width,
            height=source_page.rect.height,
        )
        overlay_page.show_pdf_page(
            overlay_page.rect,
            source_document,
            page_number - 1,
        )
        for capture in captures:
            if capture.page != page_number:
                continue
            _render_capture(
                overlay_page,
                capture,
                page_height=source_page.rect.height,
            )
        for ink in page_inks:
            if ink.page != page_number:
                continue
            for ink_vertices in ink.ink_vertex_sets:
                if _render_drawboard_outlines(
                    overlay_page,
                    ink_vertices,
                    page_height=source_page.rect.height,
                    color=tuple(ink.rgb),
                    opacity=ink.opacity,
                    blend_mode=ink.blend_mode,
                ):
                    continue
                _fill_opacity, stroke_opacity = _blend_opacities(
                    overlay_page,
                    fill_opacity=1.0,
                    stroke_opacity=ink.opacity,
                    blend_mode=ink.blend_mode,
                )
                for points in _ink_paths(ink_vertices, source_page.rect.height):
                    overlay_page.draw_polyline(
                        points,
                        color=tuple(ink.rgb),
                        width=stroke_width,
                        lineCap=1,
                        lineJoin=1,
                        stroke_opacity=stroke_opacity,
                        overlay=True,
                    )
        pixmap = overlay_page.get_pixmap(
            matrix=pymupdf.Matrix(scale, scale),  # type: ignore[no-untyped-call]
            alpha=False,
            colorspace=pymupdf.csRGB,
        )
        output_path.parent.mkdir(parents=True, exist_ok=True)
        _save_snapshot(pixmap, output_path)
    finally:
        overlay_document.close()  # type: ignore[no-untyped-call]


def _snapshot_id(source_path: Path, image_id: str, payload: object) -> str:
    stat = source_path.stat()
    revision = hashlib.sha256(
        json.dumps(
            [
                INK_RENDERER_VERSION,
                str(source_path.resolve()),
                stat.st_mtime_ns,
                stat.st_size,
                payload,
            ],
            sort_keys=True,
        ).encode()
    ).hexdigest()[:24]
    return f"{image_id}-snapshot-{revision}"


def render_annotated_page_images(
    source_path: Path,
    resource_id: str,
    pages: Iterable[int],
    *,
    captures: Iterable[DrawboardCapture] = (),
    page_inks: Iterable[DrawboardInk] = (),
    scale: float = 3.0,
    stroke_width: float = 0.65,
) -> dict[int, str]:
    """Reuse immutable snapshots; never overwrite a saved question's image."""
    capture_list = list(captures)
    ink_list = list(page_inks)
    urls: dict[int, str] = {}
    source_document: Any = None
    try:
        for page_number in sorted(set(pages)):
            page_captures = sorted(
                (item for item in capture_list if item.page == page_number),
                key=lambda item: item.fingerprint,
            )
            page_ink_items = sorted(
                (item for item in ink_list if item.page == page_number),
                key=lambda item: item.fingerprint,
            )
            if not page_captures and not page_ink_items:
                continue
            image_id = _snapshot_id(
                source_path,
                f"drawboard-page-{page_number}",
                [
                    scale,
                    stroke_width,
                    [asdict(item) for item in page_captures],
                    [asdict(item) for item in page_ink_items],
                ],
            )
            output_path = annotation_image_path(resource_id, image_id)
            if not output_path.is_file():
                if source_document is None:
                    source_document = pymupdf.open(source_path)  # type: ignore[no-untyped-call]
                _render_annotated_page(
                    source_document,
                    page_number,
                    output_path,
                    captures=page_captures,
                    page_inks=page_ink_items,
                    scale=scale,
                    stroke_width=stroke_width,
                )
            urls[page_number] = annotation_image_url(resource_id, image_id)
    finally:
        if source_document is not None:
            source_document.close()
    return urls


def render_local_annotation_images(
    source_path: Path,
    resource_id: str,
    captures: Iterable[tuple[str, int, list[float]]],
    *,
    page_numbers: Iterable[int] = (),
    crop_rects: Mapping[str, list[float]] | None = None,
) -> tuple[dict[str, str], dict[int, str]]:
    """Snapshot embedded PDF appearances, without cloud overlays or OCR."""

    crops: dict[str, str] = {}
    pages: dict[int, str] = {}
    items = list(captures)
    snapshot_pages = set(page_numbers) | {item[1] for item in items}
    if not snapshot_pages:
        return crops, pages
    with pymupdf.open(source_path) as document:  # type: ignore[no-untyped-call]
        for page_number in sorted(snapshot_pages):
            page = document[page_number - 1]
            image_id = _snapshot_id(source_path, f"pdf-page-{page_number}", ["native-v1"])
            output = annotation_image_path(resource_id, image_id)
            if not output.is_file():
                pixmap = page.get_pixmap(
                    matrix=pymupdf.Matrix(2, 2),  # type: ignore[no-untyped-call]
                    alpha=False,
                    annots=True,
                )
                output.parent.mkdir(parents=True, exist_ok=True)
                _save_snapshot(pixmap, output)
            pages[page_number] = annotation_image_url(resource_id, image_id)
        for fingerprint, page_number, rect in items:
            page = document[page_number - 1]
            bounds = pymupdf.Rect(rect) * page.rotation_matrix  # type: ignore[no-untyped-call]
            configured_crop = (crop_rects or {}).get(fingerprint)
            clip = (
                pymupdf.Rect(configured_crop) & page.rect  # type: ignore[no-untyped-call]
                if configured_crop and len(configured_crop) == 4
                else pymupdf.Rect(  # type: ignore[no-untyped-call]
                    page.rect.x0,
                    bounds.y0 - 36,
                    page.rect.x1,
                    bounds.y1 + 36,
                )
                & page.rect
            )
            if clip.is_empty or clip.is_infinite:
                raise PdfInkImageError(f"Invalid local annotation bounds on page {page_number}.")
            image_id = _snapshot_id(
                source_path,
                fingerprint,
                ["native-v2", page_number, rect, configured_crop],
            )
            output = annotation_image_path(resource_id, image_id)
            if not output.is_file():
                pixmap = page.get_pixmap(
                    matrix=pymupdf.Matrix(3, 3),  # type: ignore[no-untyped-call]
                    clip=clip,
                    alpha=False,
                    annots=True,
                )
                output.parent.mkdir(parents=True, exist_ok=True)
                _save_snapshot(pixmap, output)
            crops[fingerprint] = annotation_image_url(resource_id, image_id)
    return crops, pages


def render_ink_context_images(
    source_path: Path,
    resource_id: str,
    inks: Iterable[DrawboardInk],
    *,
    captures: Iterable[DrawboardCapture] = (),
    page_inks: Iterable[DrawboardInk] = (),
    margin: float = 12.0,
    scale: float = 5.0,
    stroke_width: float = 0.65,
    crop_rects: Mapping[str, list[float]] | None = None,
) -> dict[str, str]:
    urls: dict[str, str] = {}
    capture_list = list(captures)
    page_ink_list = list(page_inks)
    source_document: Any = None
    try:
        for ink in inks:
            # Both coordinate systems reverse Y, so overlap can be tested in
            # Drawboard coordinates without opening or rasterizing the PDF.
            def in_crop(item: DrawboardCapture | DrawboardInk, ink: DrawboardInk = ink) -> bool:
                return item.page == ink.page and (
                    len(item.rect) != 4
                    or len(ink.rect) != 4
                    or (
                        item.rect[1] <= ink.rect[3] + margin
                        and item.rect[3] >= ink.rect[1] - margin
                    )
                )

            visible_captures = sorted(filter(in_crop, capture_list), key=lambda i: i.fingerprint)
            visible_inks = sorted(filter(in_crop, page_ink_list), key=lambda i: i.fingerprint)
            image_id = _snapshot_id(
                source_path,
                ink.fingerprint,
                [
                    margin,
                    scale,
                    stroke_width,
                    asdict(ink),
                    [asdict(item) for item in visible_captures],
                    [asdict(item) for item in visible_inks],
                    (crop_rects or {}).get(ink.fingerprint),
                ],
            )
            output_path = annotation_image_path(resource_id, image_id)
            try:
                if not output_path.is_file():
                    if source_document is None:
                        source_document = pymupdf.open(source_path)  # type: ignore[no-untyped-call]
                    _render_ink(
                        source_document,
                        ink,
                        output_path,
                        captures=visible_captures,
                        page_inks=visible_inks,
                        margin=margin,
                        scale=scale,
                        stroke_width=stroke_width,
                        crop_rect=(crop_rects or {}).get(ink.fingerprint),
                    )
            except PdfInkImageError as error:
                logger.warning(
                    "Skipping invalid handwriting crop resource_id=%s "
                    "fingerprint=%s page=%s error=%s",
                    resource_id,
                    ink.fingerprint,
                    ink.page,
                    error,
                )
                continue
            urls[ink.fingerprint] = annotation_image_url(resource_id, image_id)
    finally:
        if source_document is not None:
            source_document.close()
    return urls
