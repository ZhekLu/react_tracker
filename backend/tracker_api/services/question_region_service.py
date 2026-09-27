from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Protocol

from .pdf_layout_service import PdfPageLayout, region_layout_column

_Y_JOIN_TOLERANCE = 2.0
_GUTTER_FRAGMENT_PADDING_RATIO = 0.03
VERTICAL_GUIDE_MIN_HEIGHT = 36.0
VERTICAL_GUIDE_ASPECT_RATIO = 3.0


class QuestionRegion(Protocol):
    @property
    def page(self) -> int: ...

    @property
    def rect(self) -> list[float]: ...


def question_region_groups[Region: QuestionRegion](
    regions: Iterable[Region],
    page_layouts: Mapping[int, PdfPageLayout] | None = None,
    *,
    drawboard_coordinates: bool = False,
) -> list[list[Region]]:
    """Connected Y intervals constrained by page-layout lanes.

    A confidently detected two-column page has independent left and right lanes.
    Single-column/full-page layouts deliberately ignore X, preserving the rule
    that vertically overlapping handwriting belongs to one note. Spanning marks
    bridge overlapping left/right marks because they prove that the annotated
    content itself spans the page; left and right marks never bridge directly.
    Tiny gaps between PDF ink fragments are normalized before the same transitive
    interval grouping is applied. Marks wholly around a detected gutter inherit
    the nearest overlapping lane so one handwritten phrase crossing the gutter
    is not split into two screenshots.
    """
    regions = list(regions)
    valid = [region for region in regions if len(region.rect) == 4]
    lanes = _logical_lanes(
        valid,
        page_layouts,
        drawboard_coordinates=drawboard_coordinates,
    )
    ordered = sorted(
        valid,
        key=lambda region: (
            region.page,
            lanes[id(region)],
            min(region.rect[1::2]),
            min(region.rect[::2]),
        ),
    )

    parents = list(range(len(ordered)))

    def find(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def union(first: int, second: int) -> None:
        first_root = find(first)
        second_root = find(second)
        if first_root != second_root:
            parents[second_root] = first_root

    for first_index, first in enumerate(ordered):
        for second_index in range(first_index + 1, len(ordered)):
            second = ordered[second_index]
            if second.page != first.page:
                continue
            first_lane = lanes[id(first)]
            second_lane = lanes[id(second)]
            if (
                (first_lane == second_lane or "full" in {first_lane, second_lane})
                and _y_intervals_connect(first.rect, second.rect)
            ):
                union(first_index, second_index)

    groups_by_root: dict[int, list[Region]] = {}
    for index, region in enumerate(ordered):
        groups_by_root.setdefault(find(index), []).append(region)
    groups = list(groups_by_root.values())
    # Text comments without geometry still import; they cannot join a Y group.
    return groups + [[region] for region in regions if len(region.rect) != 4]


def _logical_lanes[Region: QuestionRegion](
    regions: list[Region],
    page_layouts: Mapping[int, PdfPageLayout] | None,
    *,
    drawboard_coordinates: bool = False,
) -> dict[int, str]:
    lanes: dict[int, str] = {}
    stable: list[Region] = []
    gutter_fragments: list[Region] = []
    for region in regions:
        layout = page_layouts.get(region.page) if page_layouts else None
        lane = region_layout_column(
            region.rect,
            layout,
            drawboard_coordinates=drawboard_coordinates,
        )
        if _is_gutter_fragment(region.rect, layout):
            gutter_fragments.append(region)
        else:
            stable.append(region)
            lanes[id(region)] = lane

    assigned: list[Region] = list(stable)
    for region in sorted(
        gutter_fragments,
        key=lambda item: (item.page, min(item.rect[1::2]), min(item.rect[::2])),
    ):
        layout = page_layouts.get(region.page) if page_layouts else None
        fallback = region_layout_column(
            region.rect,
            layout,
            drawboard_coordinates=drawboard_coordinates,
        )
        candidates = [
            candidate
            for candidate in assigned
            if candidate.page == region.page
            and _y_intervals_connect(candidate.rect, region.rect)
        ]
        # A long margin bracket is an intentional group spine. Around a narrow
        # gutter it can overlap text on both sides, so nearest-neighbour
        # assignment is unstable and may steal the bracket for the wrong
        # column. Its own centre is the reliable side signal. Small words and
        # stroke fragments still inherit the nearest overlapping note below.
        if is_vertical_guide_rect(region.rect):
            lanes[id(region)] = fallback
        elif candidates:
            nearest = min(
                candidates,
                key=lambda candidate: (
                    _horizontal_gap(candidate.rect, region.rect),
                    0 if lanes[id(candidate)] == fallback else 1,
                ),
            )
            lanes[id(region)] = lanes[id(nearest)]
        else:
            lanes[id(region)] = fallback
        assigned.append(region)
    return lanes


def _is_gutter_fragment(rect: list[float], layout: PdfPageLayout | None) -> bool:
    if layout is None or layout.mode != "two_column" or len(rect) != 4:
        return False
    x0, x1 = sorted((float(rect[0]), float(rect[2])))
    padding = layout.width * _GUTTER_FRAGMENT_PADDING_RATIO
    return x0 >= layout.gutter_left - padding and x1 <= layout.gutter_right + padding


def is_vertical_guide_rect(rect: list[float]) -> bool:
    """Return whether a rectangle is shaped like a deliberate margin guide."""
    if len(rect) != 4:
        return False
    width = abs(float(rect[2]) - float(rect[0]))
    height = abs(float(rect[3]) - float(rect[1]))
    return (
        height >= VERTICAL_GUIDE_MIN_HEIGHT
        and height >= max(width, 1.0) * VERTICAL_GUIDE_ASPECT_RATIO
    )


def _y_intervals_connect(first: list[float], second: list[float]) -> bool:
    first_low, first_high = sorted((float(first[1]), float(first[3])))
    second_low, second_high = sorted((float(second[1]), float(second[3])))
    return (
        first_low <= second_high + _Y_JOIN_TOLERANCE
        and second_low <= first_high + _Y_JOIN_TOLERANCE
    )


def _horizontal_gap(first: list[float], second: list[float]) -> float:
    first_low, first_high = sorted((float(first[0]), float(first[2])))
    second_low, second_high = sorted((float(second[0]), float(second[2])))
    return max(first_low - second_high, second_low - first_high, 0.0)
