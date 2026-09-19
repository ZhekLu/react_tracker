from __future__ import annotations

from collections.abc import Iterable
from typing import Protocol


class QuestionRegion(Protocol):
    @property
    def page(self) -> int: ...

    @property
    def rect(self) -> list[float]: ...


def question_region_groups[Region: QuestionRegion](regions: Iterable[Region]) -> list[list[Region]]:
    """Connected Y intervals on one page, regardless of X, colour or mark type.

    Touching intervals share a coordinate. Any positive gap stays separate;
    paragraph context and crop padding never change question membership.
    """
    regions = list(regions)
    groups: list[list[Region]] = []
    end = float("-inf")
    page: int | None = None
    valid = sorted(
        (region for region in regions if len(region.rect) == 4),
        key=lambda region: (region.page, min(region.rect[1::2])),
    )
    for region in valid:
        low, high = sorted(region.rect[1::2])
        if region.page != page or low > end:
            groups.append([region])
            end = high
            page = region.page
        else:
            groups[-1].append(region)
            end = max(end, high)
    # Text comments without geometry still import; they cannot join a Y group.
    return groups + [[region] for region in regions if len(region.rect) != 4]
