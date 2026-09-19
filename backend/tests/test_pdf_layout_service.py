from pathlib import Path

import pymupdf

from tracker_api.services.pdf_layout_service import analyze_pdf_page_layouts


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
