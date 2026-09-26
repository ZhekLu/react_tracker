from pathlib import Path

import pymupdf

from tracker_api.services.pdf_layout_service import (
    analyze_pdf_page_layouts,
    region_layout_column,
)


def _write_lines(page: pymupdf.Page, x: float, width: float, count: int) -> None:
    for index in range(count):
        y = 60 + index * 13
        page.insert_textbox(
            pymupdf.Rect(x, y, x + width, y + 13),
            f"Line {index} with enough words",
            fontsize=7,
        )


def test_layout_detection_requires_document_text_to_support_two_columns(
    tmp_path: Path,
) -> None:
    path = tmp_path / "layouts.pdf"
    document = pymupdf.open()
    columns = document.new_page(width=600, height=800)
    _write_lines(columns, 45, 245, 35)
    _write_lines(columns, 310, 245, 35)
    full_page = document.new_page(width=600, height=800)
    _write_lines(full_page, 45, 510, 35)
    document.save(path)
    document.close()

    layouts = analyze_pdf_page_layouts(path)

    assert layouts[1].mode == "two_column"
    assert 285 <= layouts[1].gutter_midpoint <= 315
    assert layouts[2].mode == "single"


def test_two_column_page_exposes_local_full_width_text_bands(tmp_path: Path) -> None:
    path = tmp_path / "local-spanning-band.pdf"
    document = pymupdf.open()
    page = document.new_page(width=600, height=800)
    _write_lines(page, 45, 245, 35)
    _write_lines(page, 310, 245, 35)
    page.insert_textbox(
        pymupdf.Rect(45, 600, 555, 620),
        (
            "One full-width table caption covering the complete page band with "
            "enough words to reach the far edge of the available line width."
        ),
        fontsize=7,
    )
    document.save(path)
    document.close()

    layout = analyze_pdf_page_layouts(path)[1]

    assert layout.mode == "two_column"
    assert layout.spanning_bands
    assert region_layout_column([20, 590, 80, 625], layout) == "full"
    assert region_layout_column([520, 590, 580, 625], layout) == "full"
    assert region_layout_column([20, 180, 80, 220], layout) == "left"
    assert region_layout_column([520, 180, 580, 220], layout) == "right"
    assert (
        region_layout_column(
            [20, 175, 80, 210],
            layout,
            drawboard_coordinates=True,
        )
        == "full"
    )
