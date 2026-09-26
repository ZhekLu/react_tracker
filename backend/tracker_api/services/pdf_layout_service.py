from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pymupdf


@dataclass(frozen=True, slots=True)
class PdfPageLayout:
    page: int
    width: float
    height: float
    mode: str
    gutter_left: float
    gutter_right: float
    left_line_count: int
    right_line_count: int
    crossing_line_count: int
    spanning_bands: tuple[tuple[float, float], ...] = ()

    @property
    def gutter_midpoint(self) -> float:
        return (self.gutter_left + self.gutter_right) / 2


def _text_lines(page: Any) -> list[tuple[float, float, float, float]]:
    lines: list[tuple[float, float, float, float]] = []
    payload = page.get_text("dict")
    for block in payload.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            text_value = "".join(
                str(span.get("text") or "") for span in line.get("spans", [])
            ).strip()
            if len(text_value) < 3:
                continue
            values = line.get("bbox")
            if not isinstance(values, (list, tuple)) or len(values) != 4:
                continue
            x0, y0, x1, y1 = (float(value) for value in values)
            if y0 <= page.rect.y0 + 40 or y1 >= page.rect.y1 - 35:
                continue
            if x1 <= x0 or y1 <= y0:
                continue
            lines.append((x0, y0, x1, y1))
    return lines


def _percentile(values: list[float], fraction: float, fallback: float) -> float:
    if not values:
        return fallback
    ordered = sorted(values)
    index = round((len(ordered) - 1) * fraction)
    return ordered[index]


def _page_layout(page_number: int, page: Any) -> PdfPageLayout:
    width = float(page.rect.width)
    height = float(page.rect.height)
    midpoint = page.rect.x0 + width / 2
    tolerance = max(6.0, width * 0.013)
    lines = _text_lines(page)
    left = [
        line
        for line in lines
        if (line[0] + line[2]) / 2 < midpoint and line[2] <= midpoint + tolerance
    ]
    right = [
        line
        for line in lines
        if (line[0] + line[2]) / 2 >= midpoint and line[0] >= midpoint - tolerance
    ]
    classified = {id(line) for line in (*left, *right)}
    crossing = [line for line in lines if id(line) not in classified]

    minimum_side_lines = max(8, round(len(lines) * 0.18))
    # Use the inner envelope rather than the median: short final lines and
    # indented equations are common, but the repeated column edges remain near
    # the upper/lower quantiles respectively.
    left_edge = _percentile([line[2] for line in left], 0.8, midpoint)
    right_edge = _percentile([line[0] for line in right], 0.2, midpoint)
    gutter_width = right_edge - left_edge
    if gutter_width > width * 0.12:
        # Short lines may leave a visually huge empty band even though the
        # actual column boundary is central. Cropping at the physical centre is
        # safer than assigning part of the opposite column in that case.
        left_edge = midpoint - tolerance
        right_edge = midpoint + tolerance
        gutter_width = right_edge - left_edge
    crossing_limit = max(4, round(len(lines) * 0.18))
    two_column = (
        len(left) >= minimum_side_lines
        and len(right) >= minimum_side_lines
        and len(crossing) <= crossing_limit
        and gutter_width >= max(8.0, width * 0.014)
        and left_edge < midpoint
        and right_edge > midpoint
    )
    if not two_column:
        left_edge = midpoint
        right_edge = midpoint
    spanning_bands = tuple(
        sorted(
            (line[1], line[3])
            for line in lines
            if line[0] < left_edge - width * 0.08
            and line[2] > right_edge + width * 0.08
        )
    )
    return PdfPageLayout(
        page=page_number,
        width=width,
        height=height,
        mode="two_column" if two_column else "single",
        gutter_left=float(left_edge),
        gutter_right=float(right_edge),
        left_line_count=len(left),
        right_line_count=len(right),
        crossing_line_count=len(crossing),
        spanning_bands=spanning_bands,
    )


def analyze_pdf_page_layouts(path: Path) -> dict[int, PdfPageLayout]:
    document: Any = None
    try:
        document = pymupdf.open(path)  # type: ignore[no-untyped-call]
        return {
            page_index + 1: _page_layout(page_index + 1, page)
            for page_index, page in enumerate(document)
        }
    finally:
        if document is not None:
            document.close()


def region_layout_column(
    rect: list[float],
    layout: PdfPageLayout | None,
    *,
    drawboard_coordinates: bool = False,
) -> str:
    if layout is None or layout.mode != "two_column" or len(rect) != 4:
        return "full"
    x0, x1 = sorted((float(rect[0]), float(rect[2])))
    midpoint = layout.gutter_midpoint
    # Marks that substantially occupy both text columns describe a spanning
    # figure/table and intentionally keep a full-width screenshot.
    if (
        x0 < layout.gutter_left - layout.width * 0.08
        and x1 > layout.gutter_right + layout.width * 0.08
    ):
        return "full"
    raw_y0, raw_y1 = sorted((float(rect[1]), float(rect[3])))
    if drawboard_coordinates:
        y0, y1 = layout.height - raw_y1, layout.height - raw_y0
    else:
        y0, y1 = raw_y0, raw_y1
    if any(y0 <= band_y1 and band_y0 <= y1 for band_y0, band_y1 in layout.spanning_bands):
        # Page-level two-column detection is intentionally conservative. A
        # table, figure, or full-width paragraph can still occupy one local
        # vertical band; marks beside that band belong to the same full lane.
        return "full"
    return "left" if (x0 + x1) / 2 < midpoint else "right"


def suggested_capture_rect(
    rect: list[float],
    layout: PdfPageLayout,
    *,
    column: str,
    drawboard_coordinates: bool,
    margin: float,
) -> list[float]:
    if len(rect) != 4:
        return [0.0, 0.0, layout.width, layout.height]
    raw_y0, raw_y1 = sorted((float(rect[1]), float(rect[3])))
    if drawboard_coordinates:
        y0 = layout.height - raw_y1
        y1 = layout.height - raw_y0
    else:
        y0, y1 = raw_y0, raw_y1
    if layout.mode == "two_column" and column == "left":
        x0, x1 = 0.0, layout.gutter_midpoint
    elif layout.mode == "two_column" and column == "right":
        x0, x1 = layout.gutter_midpoint, layout.width
    else:
        x0, x1 = 0.0, layout.width
    return [
        round(max(0.0, x0), 3),
        round(max(0.0, y0 - margin), 3),
        round(min(layout.width, x1), 3),
        round(min(layout.height, y1 + margin), 3),
    ]
