from dataclasses import dataclass

from tracker_api.services.question_region_service import question_region_groups


@dataclass
class Region:
    name: str
    page: int
    rect: list[float]


def test_exact_transitive_y_overlap_is_independent_of_x_order_and_page():
    regions = [
        Region("left", 1, [0, 10, 2, 30]),
        Region("right", 1, [500, 60, 510, 80]),
        Region("highlight-bridge", 1, [100, 30, 150, 60]),
        Region("tiny-gap", 1, [0, 80.01, 2, 90]),
        Region("other-page", 2, [0, 10, 2, 30]),
    ]
    for ordered in (regions, list(reversed(regions))):
        assert [{region.name for region in group} for group in question_region_groups(ordered)] == [
            {"left", "right", "highlight-bridge"},
            {"tiny-gap"},
            {"other-page"},
        ]


def test_text_without_geometry_is_kept_as_an_independent_capture():
    missing = Region("comment", 1, [])
    valid = Region("ink", 1, [0, 10, 2, 30])
    assert question_region_groups([missing, valid]) == [[valid], [missing]]
