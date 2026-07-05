from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import pymupdf

from ..config import get_settings
from .drawboard_service import DrawboardInk

SAFE_ID = re.compile(r"^[a-zA-Z0-9_-]+$")
INK_RENDERER_VERSION = "ink-render-v2"


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
        f"{INK_RENDERER_VERSION}:{source_revision}".encode("utf-8"),
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


def _is_number(value: object) -> bool:
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
            pymupdf.Point(x, page_height - y)
            for x, y in path
        ]
        for path in _ink_coordinate_paths(ink_vertices)
        if len(path) >= 2
    ]


def _render_ink(
    source_document: Any,
    ink: DrawboardInk,
    output_path: Path,
    *,
    margin: float,
    scale: float,
    stroke_width: float,
) -> None:
    if ink.page < 1 or ink.page > source_document.page_count:
        raise PdfInkImageError(f"Ink page is outside the PDF: {ink.page}")
    source_page = source_document[ink.page - 1]
    overlay_document = pymupdf.open()
    try:
        overlay_page = overlay_document.new_page(
            width=source_page.rect.width,
            height=source_page.rect.height,
        )
        overlay_page.show_pdf_page(overlay_page.rect, source_document, ink.page - 1)
        for ink_vertices in ink.ink_vertex_sets:
            for points in _ink_paths(ink_vertices, source_page.rect.height):
                overlay_page.draw_polyline(
                    points,
                    color=tuple(ink.rgb),
                    width=stroke_width,
                    lineCap=1,
                    lineJoin=1,
                    overlay=True,
                )
        pdf_rect = drawboard_rect_to_pdf(ink.rect, source_page.rect.height)
        y0 = max(0.0, (pdf_rect[1] if pdf_rect else 0.0) - margin)
        y1 = min(
            source_page.rect.height,
            (pdf_rect[3] if pdf_rect else source_page.rect.height) + margin,
        )
        clip = pymupdf.Rect(
            0,
            y0,
            source_page.rect.width,
            y1,
        )
        pixmap = overlay_page.get_pixmap(
            matrix=pymupdf.Matrix(scale, scale),
            clip=clip,
            alpha=False,
            colorspace=pymupdf.csRGB,
        )
        output_path.parent.mkdir(parents=True, exist_ok=True)
        pixmap.save(output_path)
    finally:
        overlay_document.close()


def render_ink_context_images(
    source_path: Path,
    resource_id: str,
    inks: Iterable[DrawboardInk],
    *,
    margin: float = 54.0,
    scale: float = 4.0,
    stroke_width: float = 0.65,
) -> dict[str, str]:
    try:
        source_document: Any = pymupdf.open(source_path)
    except Exception as error:
        raise PdfInkImageError(
            f"Could not open PDF for handwriting images: {source_path}"
        ) from error
    urls: dict[str, str] = {}
    try:
        for ink in inks:
            image_id = ink.fingerprint
            output_path = annotation_image_path(resource_id, image_id)
            _render_ink(
                source_document,
                ink,
                output_path,
                margin=margin,
                scale=scale,
                stroke_width=stroke_width,
            )
            urls[ink.fingerprint] = annotation_image_url(
                resource_id,
                image_id,
                source_revision=ink.source_revision,
            )
    finally:
        source_document.close()
    return urls
