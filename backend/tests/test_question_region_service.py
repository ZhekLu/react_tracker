from dataclasses import dataclass

from tracker_api.services.pdf_layout_service import PdfPageLayout
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
        Region("separate", 1, [0, 83, 2, 90]),
        Region("other-page", 2, [0, 10, 2, 30]),
    ]
    for ordered in (regions, list(reversed(regions))):
        assert [{region.name for region in group} for group in question_region_groups(ordered)] == [
            {"left", "right", "highlight-bridge"},
            {"separate"},
            {"other-page"},
        ]


def test_text_without_geometry_is_kept_as_an_independent_capture():
    missing = Region("comment", 1, [])
    valid = Region("ink", 1, [0, 10, 2, 30])
    assert question_region_groups([missing, valid]) == [[valid], [missing]]


def test_two_column_layout_partitions_then_reuses_y_overlap_grouping():
    layout = PdfPageLayout(
        page=1,
        width=600,
        height=800,
        mode="two_column",
        gutter_left=290,
        gutter_right=310,
        left_line_count=40,
        right_line_count=42,
        crossing_line_count=1,
    )
    regions = [
        Region("left-a", 1, [20, 100, 180, 180]),
        Region("left-bridge", 1, [40, 175, 220, 240]),
        Region("right", 1, [380, 120, 570, 210]),
    ]

    groups = question_region_groups(regions, {1: layout})

    assert [{region.name for region in group} for group in groups] == [
        {"left-a", "left-bridge"},
        {"right"},
    ]


def test_tiny_fragment_gaps_do_not_create_duplicate_screenshots():
    regions = [
        Region("dot", 1, [596, 476.9, 597, 477.8]),
        Region("handwriting", 1, [540, 478.5, 603, 516]),
    ]

    assert question_region_groups(regions) == [regions]


def test_gutter_fragments_follow_nearest_overlapping_column_note():
    layout = PdfPageLayout(
        page=1,
        width=612,
        height=792,
        mode="two_column",
        gutter_left=286,
        gutter_right=307,
        left_line_count=97,
        right_line_count=105,
        crossing_line_count=7,
    )
    regions = [
        Region("left-note", 1, [3, 330, 280, 460]),
        Region("gutter-word-a", 1, [275, 345, 293, 353]),
        Region("gutter-word-b", 1, [298, 343, 319, 352]),
        Region("right-note", 1, [430, 500, 580, 560]),
    ]

    groups = question_region_groups(regions, {1: layout})

    assert [{region.name for region in group} for group in groups] == [
        {"left-note", "gutter-word-a", "gutter-word-b"},
        {"right-note"},
    ]


def test_uncertain_single_column_layout_keeps_cross_page_width_note_together():
    layout = PdfPageLayout(
        page=1,
        width=600,
        height=800,
        mode="single",
        gutter_left=300,
        gutter_right=300,
        left_line_count=3,
        right_line_count=2,
        crossing_line_count=20,
    )
    left = Region("left", 1, [20, 100, 180, 180])
    right = Region("right", 1, [380, 120, 570, 210])

    assert question_region_groups([left, right], {1: layout}) == [[left, right]]
