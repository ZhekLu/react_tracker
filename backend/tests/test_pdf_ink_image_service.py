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
    _blend_opacities,
    _ink_coordinate_paths,
    _ink_outline_paths,
    _render_drawboard_outlines,
    render_annotated_page_images,
    render_ink_context_images,
)


def test_drawboard_multiply_highlight_registers_pdf_blend_mode() -> None:
    document = pymupdf.open()
    page = document.new_page(width=100, height=100)

    fill_opacity, stroke_opacity = _blend_opacities(
        page,
        fill_opacity=1.0,
        stroke_opacity=1.0,
        blend_mode="Multiply",
    )
    page.draw_rect(
        pymupdf.Rect(10, 10, 90, 30),
        color=None,
        fill=(1.0, 0.2, 0.3),
        fill_opacity=fill_opacity,
        stroke_opacity=stroke_opacity,
    )

    resource_kind, resource_value = document.xref_get_key(
        page.xref,
        "Resources",
    )
    assert resource_kind == "xref"
    resource_xref = int(resource_value.split()[0])
    assert "/BM/Multiply" in document.xref_object(
        resource_xref,
        compressed=True,
    )
    document.close()


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
                [
                    334.08,
                    480.64,
                    333.44,
                    483.25,
                    333.64,
                    481.93,
                    334.76,
                    479.85,
                    334.2,
                    480.3,
                    334.34,
                    479.87,
                    335.0,
                    479.91,
                    334.84,
                    479.85,
                    334.93,
                    479.86,
                    335.28,
                    480.77,
                    335.25,
                    480.08,
                    335.25,
                    480.51,
                ],
                [335.31, 481.09, 335.34, 481.48, 335.37, 481.91],
                [335.36, 487.0, 335.47, 483.59, 335.55, 485.33],
                [335.31, 487.52, 335.26, 488.05],
            ]
        ]
    )

    assert len(paths) == 1
    assert paths[0].start == (333.18, 484.58)
    assert paths[0].segments[:4] == (
        InkBezier(
            control_1=(333.44, 483.25),
            control_2=(333.64, 481.93),
            end=(334.08, 480.64),
        ),
        InkBezier(
            control_1=(334.2, 480.3),
            control_2=(334.34, 479.87),
            end=(334.76, 479.85),
        ),
        InkBezier(
            control_1=(334.84, 479.85),
            control_2=(334.93, 479.86),
            end=(335.0, 479.91),
        ),
        InkBezier(
            control_1=(335.25, 480.08),
            control_2=(335.25, 480.51),
            end=(335.28, 480.77),
        ),
    )
    assert paths[0].segments[4:] == (
        InkLine(end=(335.31, 481.09)),
        InkLine(end=(335.34, 481.48)),
        InkLine(end=(335.37, 481.91)),
        InkBezier(
            control_1=(335.47, 483.59),
            control_2=(335.55, 485.33),
            end=(335.36, 487.0),
        ),
        InkLine(end=(335.31, 487.52)),
        InkLine(end=(335.26, 488.05)),
    )


def test_compound_ink_outline_keeps_an_enclosed_hole() -> None:
    document = pymupdf.open()
    page = document.new_page(width=100, height=100)
    rendered = _render_drawboard_outlines(
        page,
        [
            [[20, 20], [80, 20, 80, 80, 20, 80, 20, 20]],
            [[35, 35], [65, 35, 65, 65, 35, 65, 35, 35]],
        ],
        page_height=100,
        color=(0.8, 0.0, 0.0),
        opacity=1.0,
        blend_mode="Normal",
    )

    assert rendered is True
    pixmap = page.get_pixmap(alpha=False, colorspace=pymupdf.csRGB)

    def pixel(x: int, y: int) -> tuple[int, int, int]:
        start = (y * pixmap.width + x) * pixmap.n
        return tuple(pixmap.samples[start : start + 3])  # type: ignore[return-value]

    assert pixel(25, 50)[0] > pixel(25, 50)[1] + 100
    assert all(channel > 245 for channel in pixel(50, 50))
    document.close()


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


def test_contained_guide_groups_become_one_screenshot() -> None:
    outer_guide = _ink("guide-outer", [0.0, 0.0, 2.0, 100.0])
    outer_text = _ink("outer-text", [1.0, 0.0, 100.0, 100.0])
    inner_guide = _ink("guide-inner", [20.0, 20.0, 22.0, 80.0])
    inner_text = _ink("inner-text", [21.0, 20.0, 90.0, 80.0])

    groups = group_red_ink_annotations(
        [outer_guide, outer_text, inner_guide, inner_text]
    )

    assert len(groups) == 1
    assert set(groups[0].member_fingerprints) == {
        "guide-outer",
        "outer-text",
        "guide-inner",
        "inner-text",
    }


def test_overlapping_vertical_crop_bands_become_one_screenshot() -> None:
    left_guide = _ink("guide-left", [5.0, 20.0, 8.0, 120.0])
    left_note = _ink("note-left", [10.0, 28.0, 120.0, 108.0])
    right_guide = _ink("guide-right", [280.0, 24.0, 283.0, 116.0])
    right_note = _ink("note-right", [300.0, 30.0, 420.0, 110.0])

    groups = group_red_ink_annotations(
        [left_guide, left_note, right_guide, right_note]
    )

    assert len(groups) == 1
    assert set(groups[0].member_fingerprints) == {
        "guide-left",
        "note-left",
        "guide-right",
        "note-right",
    }


def test_slightly_overlapping_guides_are_one_intentional_question() -> None:
    first_guide = _ink("guide-first", [5.0, 20.0, 8.0, 120.0])
    first_note = _ink("note-first", [12.0, 30.0, 180.0, 105.0])
    second_guide = _ink("guide-second", [5.0, 112.0, 8.0, 210.0])
    second_note = _ink("note-second", [12.0, 125.0, 190.0, 195.0])

    groups = group_red_ink_annotations(
        [first_guide, first_note, second_guide, second_note]
    )

    assert len(groups) == 1
    assert set(groups[0].member_fingerprints) == {
        "guide-first",
        "note-first",
        "guide-second",
        "note-second",
    }


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


def test_complete_annotated_page_preserves_highlight_and_ink(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_path = tmp_path / "source.pdf"
    document = pymupdf.open()
    page = document.new_page(width=200, height=200)
    page.insert_text((20, 100), "Readable source text", fontsize=14)
    document.save(source_path)
    document.close()

    monkeypatch.setenv(
        "TRACKER_ANNOTATION_IMAGE_DIR",
        str(tmp_path / "annotation-images"),
    )
    get_settings.cache_clear()
    red_ink = _ink("red-ink", [15.0, 60.0, 95.0, 82.0])
    highlight = DrawboardCapture(
        fingerprint="highlight",
        source_revision="capture-1",
        page=1,
        annotation_kind="TextHighlight",
        color="yellow",
        rgb=[1.0, 0.82, 0.1],
        quote="Readable source text",
        comment="",
        is_question=False,
        created_at="2026-07-10T10:00:00Z",
        rect=[18.0, 92.0, 155.0, 112.0],
    )

    urls = render_annotated_page_images(
        source_path,
        "resource-1",
        [1],
        captures=[highlight],
        page_inks=[red_ink],
        scale=2,
        stroke_width=2,
    )

    assert 1 in urls
    output = (
        tmp_path
        / "annotation-images"
        / "resource-1"
        / "drawboard-page-1.png"
    )
    assert output.is_file()
    pixmap = pymupdf.Pixmap(output)
    pixels = [
        tuple(pixmap.samples[index : index + pixmap.n])
        for index in range(0, len(pixmap.samples), pixmap.n)
    ]
    assert any(red > 180 and green < 150 for red, green, _blue in pixels)
    assert any(
        red > 210 and green > 190 and blue < 245
        for red, green, blue in pixels
    )
    get_settings.cache_clear()


def test_multiline_highlight_does_not_fill_between_its_quads(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source_path = tmp_path / "source.pdf"
    document = pymupdf.open()
    document.new_page(width=100, height=100)
    document.save(source_path)
    document.close()

    monkeypatch.setenv(
        "TRACKER_ANNOTATION_IMAGE_DIR",
        str(tmp_path / "annotation-images"),
    )
    get_settings.cache_clear()
    highlight = DrawboardCapture(
        fingerprint="two-fragments",
        source_revision="capture-2",
        page=1,
        annotation_kind="TextHighlight",
        color="blue",
        rgb=[0.2, 0.5, 1.0],
        quote="two fragments",
        comment="",
        is_question=False,
        created_at="2026-07-10T10:00:00Z",
        rect=[10.0, 70.0, 90.0, 80.0],
        opacity=0.5,
        rects=((10.0, 70.0, 30.0, 80.0), (70.0, 70.0, 90.0, 80.0)),
    )

    render_annotated_page_images(
        source_path,
        "resource-1",
        [1],
        captures=[highlight],
        scale=2,
    )
    output = (
        tmp_path
        / "annotation-images"
        / "resource-1"
        / "drawboard-page-1.png"
    )
    pixmap = pymupdf.Pixmap(output)

    def pixel(x: int, y: int) -> tuple[int, int, int]:
        start = (y * pixmap.width + x) * pixmap.n
        return tuple(pixmap.samples[start : start + 3])  # type: ignore[return-value]

    assert pixel(40, 50)[2] > pixel(40, 50)[0]
    assert all(channel > 245 for channel in pixel(100, 50))
    get_settings.cache_clear()
