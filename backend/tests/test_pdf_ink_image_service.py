from __future__ import annotations

from pathlib import Path

import pymupdf
import pytest

from tracker_api.config import get_settings
from tracker_api.services.drawboard_service import (
    DrawboardCapture,
    DrawboardInk,
    group_red_ink_annotations,
)
from tracker_api.services.pdf_ink_image_service import (
    InkBezier,
    InkLine,
    _ink_coordinate_paths,
    _ink_outline_paths,
    render_ink_context_images,
)


def _ink(
    fingerprint: str,
    rect: list[float],
    *,
    color: str = "red",
    rgb: list[float] | None = None,
) -> DrawboardInk:
    x0, y0, x1, y1 = rect
    return DrawboardInk(
        fingerprint=fingerprint,
        source_revision="1",
        page=1,
        color=color,
        rgb=rgb or [1.0, 0.1, 0.2],
        created_at="2026-07-10T10:00:00Z",
        rect=rect,
        ink_vertex_sets=([[x0, y0], [x1, y1]],),
        member_fingerprints=(fingerprint,),
    )


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


def test_drawboard_filled_outline_preserves_bezier_command_order() -> None:
    paths = _ink_outline_paths(
        [
            [
                [333.18, 484.58],
                [334.08, 480.64, 333.44, 483.25, 333.64, 481.93],
                [335.0, 479.0],
            ]
        ]
    )

    assert len(paths) == 1
    assert paths[0].start == (333.18, 484.58)
    assert paths[0].segments == (
        InkBezier(
            control_1=(333.44, 483.25),
            control_2=(333.64, 481.93),
            end=(334.08, 480.64),
        ),
        InkLine(end=(335.0, 479.0)),
    )


def test_vertical_guides_prevent_transitive_question_merges() -> None:
    first_guide = _ink("guide-1", [4.0, 10.0, 7.0, 60.0])
    second_guide = _ink("guide-2", [4.0, 65.0, 7.0, 115.0])
    bridge = _ink("bridge", [20.0, 50.0, 60.0, 70.0])
    second_text = _ink("second-text", [20.0, 72.0, 70.0, 92.0])

    groups = group_red_ink_annotations(
        [first_guide, bridge, second_guide, second_text],
        tolerance=6.0,
    )

    assert len(groups) == 2
    members = [set(group.member_fingerprints) for group in groups]
    assert {"guide-1", "bridge"} in members
    assert {"guide-2", "second-text"} in members


def test_handwriting_image_contains_nearby_ink_and_highlights(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_path = tmp_path / "source.pdf"
    document = pymupdf.open()
    document.new_page(width=200, height=200)
    document.save(source_path)
    document.close()

    monkeypatch.setenv(
        "TRACKER_ANNOTATION_IMAGE_DIR",
        str(tmp_path / "annotation-images"),
    )
    get_settings.cache_clear()
    target = _ink("target", [10.0, 70.0, 40.0, 95.0])
    blue_ink = _ink(
        "blue-ink",
        [50.0, 72.0, 80.0, 94.0],
        color="blue",
        rgb=[0.1, 0.25, 0.95],
    )
    highlight = DrawboardCapture(
        fingerprint="highlight",
        source_revision="1",
        page=1,
        annotation_kind="TextHighlight",
        color="yellow",
        rgb=[1.0, 0.82, 0.1],
        quote="nearby highlight",
        comment="",
        is_question=False,
        created_at="2026-07-10T10:00:00Z",
        rect=[90.0, 70.0, 150.0, 95.0],
    )

    render_ink_context_images(
        source_path,
        "resource-1",
        [target],
        captures=[highlight],
        page_inks=[target, blue_ink],
        margin=12,
        scale=2,
        stroke_width=2,
    )
    output = (
        tmp_path
        / "annotation-images"
        / "resource-1"
        / "target.png"
    )
    pixmap = pymupdf.Pixmap(output)
    pixels = [
        tuple(pixmap.samples[index : index + pixmap.n])
        for index in range(0, len(pixmap.samples), pixmap.n)
    ]

    assert any(red > 180 and green < 150 for red, green, _blue in pixels)
    assert any(blue > 180 and red < 150 for red, _green, blue in pixels)
    assert any(
        red > 210 and green > 190 and blue < 245
        for red, green, blue in pixels
    )
    get_settings.cache_clear()
