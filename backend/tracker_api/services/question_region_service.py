from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Protocol

from .pdf_layout_service import PdfPageLayout, region_layout_column

_Y_JOIN_TOLERANCE = 2.0
_GUTTER_FRAGMENT_PADDING_RATIO = 0.03


class QuestionRegion(Protocol):
    @property
    def page(self) -> int: ...

    @property
    def rect(self) -> list[float]: ...


def question_region_groups[Region: QuestionRegion](
    regions: Iterable[Region],
    page_layouts: Mapping[int, PdfPageLayout] | None = None,
) -> list[list[Region]]:
    """Connected Y intervals in a page-layout lane.

    A confidently detected two-column page has independent left and right lanes.
    Single-column/full-page layouts deliberately ignore X, preserving the rule
    that vertically overlapping handwriting belongs to one note. Spanning marks
    form their own full-width lane. Tiny gaps between PDF ink fragments are
    normalized before the same transitive interval grouping is applied. Marks
    wholly around a detected gutter inherit the nearest overlapping lane so one
    handwritten phrase crossing the gutter is not split into two screenshots.
    """
    regions = list(regions)
    groups: list[list[Region]] = []
    valid = [region for region in regions if len(region.rect) == 4]
    lanes = _logical_lanes(valid, page_layouts)
    valid = sorted(
        valid,
        key=lambda region: (
            region.page,
            lanes[id(region)],
            min(region.rect[1::2]),
        ),
    )
    lane_groups: dict[tuple[int, str], list[list[Region]]] = {}
    lane_ends: dict[tuple[int, str], float] = {}
    for region in valid:
        lane = (region.page, lanes[id(region)])
        low, high = sorted(region.rect[1::2])
        lane_result = lane_groups.setdefault(lane, [])
        if not lane_result or low > lane_ends[lane] + _Y_JOIN_TOLERANCE:
            lane_result.append([region])
            lane_ends[lane] = high
        else:
            lane_result[-1].append(region)
            lane_ends[lane] = max(lane_ends[lane], high)
    for lane in sorted(lane_groups):
        groups.extend(lane_groups[lane])
    # Text comments without geometry still import; they cannot join a Y group.
    return groups + [[region] for region in regions if len(region.rect) != 4]


def _logical_lanes[Region: QuestionRegion](
    regions: list[Region],
    page_layouts: Mapping[int, PdfPageLayout] | None,
) -> dict[int, str]:
    lanes: dict[int, str] = {}
    stable: list[Region] = []
    gutter_fragments: list[Region] = []
    for region in regions:
        layout = page_layouts.get(region.page) if page_layouts else None
        lane = region_layout_column(region.rect, layout)
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
        fallback = region_layout_column(region.rect, layout)
        candidates = [
            candidate
            for candidate in assigned
            if candidate.page == region.page
            and _y_intervals_connect(candidate.rect, region.rect)
        ]
        if candidates:
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
