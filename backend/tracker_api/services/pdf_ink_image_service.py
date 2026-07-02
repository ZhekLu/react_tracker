from __future__ import annotations

import re
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import pymupdf

from ..config import get_settings
from .drawboard_service import DrawboardInk

SAFE_ID = re.compile(r"^[a-zA-Z0-9_-]+$")


class PdfInkImageError(RuntimeError):
    """Raised when a handwritten annotation image cannot be rendered."""


def annotation_image_path(resource_id: str, image_id: str) -> Path:
    if not SAFE_ID.fullmatch(resource_id) or not SAFE_ID.fullmatch(image_id):
        raise PdfInkImageError("Invalid annotation image identifier.")
    return get_settings().annotation_image_dir / resource_id / f"{image_id}.png"


def annotation_image_url(resource_id: str, image_id: str) -> str:
    return f"/api/resources/{resource_id}/annotation-images/{image_id}"


def _flatten_numbers(value: object) -> list[float]:
    if isinstance(value, (int, float)):
        return [float(value)]
    if isinstance(value, list):
        numbers: list[float] = []
        for item in value:
            numbers.extend(_flatten_numbers(item))
        return numbers
    return []


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


def _ink_points(
    ink_vertices: list[Any],
    page_height: float,
) -> list[pymupdf.Point]:
    numbers = _flatten_numbers(ink_vertices)
    return [
        pymupdf.Point(  # type: ignore[no-untyped-call]
            numbers[index],
            page_height - numbers[index + 1],
        )
        for index in range(0, len(numbers) - 1, 2)
    ]


def _render_ink(
    source_document: Any,
    ink: DrawboardInk,
    output_path: Path,
    *,
    margin: float,
    scale: float,
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
        points = _ink_points(ink.ink_vertices, source_page.rect.height)
        if len(points) >= 2:
            overlay_page.draw_polyline(
                points,
                color=tuple(ink.rgb),
                width=1.6,
                overlay=True,
            )
        pdf_rect = drawboard_rect_to_pdf(ink.rect, source_page.rect.height)
        y0 = max(0.0, (pdf_rect[1] if pdf_rect else 0.0) - margin)
        y1 = min(
            source_page.rect.height,
            (pdf_rect[3] if pdf_rect else source_page.rect.height) + margin,
        )
        clip = pymupdf.Rect(  # type: ignore[no-untyped-call]
            0,
            y0,
            source_page.rect.width,
            y1,
        )
        pixmap = overlay_page.get_pixmap(
            matrix=pymupdf.Matrix(scale, scale),  # type: ignore[no-untyped-call]
            clip=clip,
            alpha=False,
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
    margin: float = 72.0,
    scale: float = 1.5,
) -> dict[str, str]:
    try:
        source_document: Any = pymupdf.open(source_path)  # type: ignore[no-untyped-call]
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
            )
            urls[ink.fingerprint] = annotation_image_url(resource_id, image_id)
    finally:
        source_document.close()
    return urls
