from __future__ import annotations

from tracker_api.services.pdf_ink_image_service import _ink_coordinate_paths


def test_flat_coordinates_are_one_stroke() -> None:
    paths = _ink_coordinate_paths([1, 2, 3, 4, 5, 6])

    assert paths == [[(1.0, 2.0), (3.0, 4.0), (5.0, 6.0)]]


def test_point_pairs_are_one_stroke() -> None:
    paths = _ink_coordinate_paths([[1, 2], [3, 4], [5, 6]])

    assert paths == [[(1.0, 2.0), (3.0, 4.0), (5.0, 6.0)]]


def test_nested_drawboard_strokes_are_not_joined() -> None:
    paths = _ink_coordinate_paths(
        [
            [[1, 2], [3, 4], [5, 6]],
            [[20, 21], [22, 23]],
        ]
    )

    assert paths == [
        [(1.0, 2.0), (3.0, 4.0), (5.0, 6.0)],
        [(20.0, 21.0), (22.0, 23.0)],
    ]


def test_nested_flat_strokes_are_not_joined() -> None:
    paths = _ink_coordinate_paths(
        [
            [1, 2, 3, 4],
            [20, 21, 22, 23],
        ]
    )

    assert paths == [
        [(1.0, 2.0), (3.0, 4.0)],
        [(20.0, 21.0), (22.0, 23.0)],
    ]
