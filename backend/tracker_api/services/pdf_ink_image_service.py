from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypeGuard

import pymupdf

from ..config import get_settings
from .drawboard_service import DrawboardCapture, DrawboardInk

SAFE_ID = re.compile(r"^[a-zA-Z0-9_-]+$")
INK_RENDERER_VERSION = "ink-render-v4"


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
        return [
            [
                (numbers[index], numbers[index + 1])
                for index in range(0, len(numbers) - 1, 2)
            ]
        ]

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
        valid = True
        for item in value[1:]:
            point = _point(item)
            if point is not None:
                segments.append(InkLine(point))
                continue
            if (
                isinstance(item, (list, tuple))
                and len(item) >= 6
                and len(item) % 6 == 0
                and all(_is_number(number) for number in item)
            ):
                numbers = [float(number) for number in item]
                segments.extend(
                    InkBezier(
                        control_1=(numbers[index + 2], numbers[index + 3]),
                        control_2=(numbers[index + 4], numbers[index + 5]),
                        end=(numbers[index], numbers[index + 1]),
                    )
                    for index in range(0, len(numbers), 6)
                )
                has_bezier = True
                continue
            valid = False
            break
        if valid and segments and has_bezier:
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
) -> bool:
    outlines = _ink_outline_paths(ink_vertices)
    if not outlines:
        return False

    for outline in outlines:
        shape = page.new_shape()
        current = _pdf_point(outline.start, page_height)
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
        shape.finish(
            color=None,
            fill=color,
            closePath=True,
            fill_opacity=max(0.0, min(opacity, 1.0)),
        )
        shape.commit(overlay=True)
    return True


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
        y0 = max(0.0, (pdf_rect[1] if pdf_rect else 0.0) - margin)
        y1 = min(
            source_page.rect.height,
            (pdf_rect[3] if pdf_rect else source_page.rect.height) + margin,
        )
        clip = pymupdf.Rect(  # type: ignore[no-untyped-call]
            0, y0, source_page.rect.width, y1
        )

        for capture in captures:
            if capture.page != ink.page or len(capture.rect) != 4:
                continue
            capture_rect = pymupdf.Rect(  # type: ignore[no-untyped-call]
                drawboard_rect_to_pdf(capture.rect, source_page.rect.height)
            )
            if (
                not capture_rect.intersects(clip)  # type: ignore[no-untyped-call]
                or len(capture.rgb) < 3
            ):
                continue
            color = tuple(capture.rgb[:3])
            if capture.annotation_kind == "TextUnderline":
                overlay_page.draw_line(
                    capture_rect.bottom_left,
                    capture_rect.bottom_right,
                    color=color,
                    width=1.1,
                    overlay=True,
                )
            elif capture.annotation_kind == "TextHighlight":
                overlay_page.draw_rect(
                    capture_rect,
                    color=None,
                    fill=color,
                    fill_opacity=capture.opacity,
                    overlay=True,
                )
            else:
                overlay_page.draw_rect(
                    capture_rect,
                    color=color,
                    width=0.8,
                    overlay=True,
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
                ):
                    continue
                for points in _ink_paths(ink_vertices, source_page.rect.height):
                    overlay_page.draw_polyline(
                        points,
                        color=tuple(visible_ink.rgb),
                        width=stroke_width,
                        lineCap=1,
                        lineJoin=1,
                        overlay=True,
                    )
        pixmap = overlay_page.get_pixmap(
            matrix=pymupdf.Matrix(scale, scale),  # type: ignore[no-untyped-call]
            clip=clip,
            alpha=False,
            colorspace=pymupdf.csRGB,
        )
        output_path.parent.mkdir(parents=True, exist_ok=True)
        pixmap.save(output_path)  # type: ignore[no-untyped-call]
    finally:
        overlay_document.close()  # type: ignore[no-untyped-call]


def render_ink_context_images(
    source_path: Path,
    resource_id: str,
    inks: Iterable[DrawboardInk],
    *,
    captures: Iterable[DrawboardCapture] = (),
    page_inks: Iterable[DrawboardInk] = (),
    margin: float = 54.0,
    scale: float = 5.0,
    stroke_width: float = 0.65,
) -> dict[str, str]:
    try:
        source_document: Any = pymupdf.open(  # type: ignore[no-untyped-call]
            source_path
        )
    except Exception as error:
        raise PdfInkImageError(
            f"Could not open PDF for handwriting images: {source_path}"
        ) from error
    urls: dict[str, str] = {}
    capture_list = list(captures)
    page_ink_list = list(page_inks)
    try:
        for ink in inks:
            image_id = ink.fingerprint
            output_path = annotation_image_path(resource_id, image_id)
            _render_ink(
                source_document,
                ink,
                output_path,
                captures=capture_list,
                page_inks=page_ink_list,
                margin=margin,
                scale=scale,
                stroke_width=stroke_width,
            )
            urls[ink.fingerprint] = annotation_image_url(
                resource_id,
                image_id,
                source_revision=hashlib.sha1(
                    ":".join(
                        [
                            ink.source_revision,
                            *sorted(
                                item.source_revision
                                for item in capture_list
                                if item.page == ink.page
                            ),
                            *sorted(
                                item.source_revision
                                for item in page_ink_list
                                if item.page == ink.page
                            ),
                        ]
                    ).encode(),
                    usedforsecurity=False,
                ).hexdigest(),
            )
    finally:
        source_document.close()
    return urls
