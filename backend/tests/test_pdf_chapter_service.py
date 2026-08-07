from __future__ import annotations

from pathlib import Path

import pymupdf

from tracker_api.services.pdf_chapter_service import prepare_chapter_pdf


def _book(path: Path) -> None:
    document = pymupdf.open()
    for page_number in range(1, 9):
        page = document.new_page()
        page.insert_text((72, 72), f"Source page {page_number}")
    document.set_toc(
        [
            [1, "Introduction", 1],
            [2, "1.1 Overview", 1],
            [1, "I Tabular Methods", 3],
            [2, "Multi-armed Bandits", 3],
            [3, "2.1 Action values", 3],
            [2, "Finite Markov Decision Processes", 6],
            [3, "3.1 Agent-environment interface", 6],
        ]
    )
    document.set_metadata({"title": "Test RL Book"})
    document.save(path)
    document.close()


def test_chapter_pdf_contains_complete_selected_ranges_and_reuses_cache(
    tmp_path: Path,
) -> None:
    source = tmp_path / "book.pdf"
    target = tmp_path / "day-chapters.pdf"
    _book(source)

    ranges, created = prepare_chapter_pdf(source, target, [2])

    assert created is True
    assert [(item.number, item.first_page, item.last_page) for item in ranges] == [
        (2, 3, 5)
    ]
    with pymupdf.open(target) as document:
        assert document.page_count == 3
        assert "Source page 3" in document[0].get_text()
        assert "Source page 5" in document[2].get_text()
        assert document.get_toc(simple=True)[0] == [
            1,
            "Chapter 2 · Multi-armed Bandits",
            1,
        ]

    cached_mtime = target.stat().st_mtime_ns
    _ranges, created_again = prepare_chapter_pdf(source, target, [2])

    assert created_again is False
    assert target.stat().st_mtime_ns == cached_mtime


def test_chapter_pdf_joins_non_contiguous_chapters_in_source_order(
    tmp_path: Path,
) -> None:
    source = tmp_path / "book.pdf"
    target = tmp_path / "selected.pdf"
    _book(source)

    ranges, _created = prepare_chapter_pdf(source, target, [3, 1])

    assert [item.number for item in ranges] == [1, 3]
    with pymupdf.open(target) as document:
        assert document.page_count == 5
        assert "Source page 1" in document[0].get_text()
        assert "Source page 8" in document[-1].get_text()
        assert [item[1] for item in document.get_toc(simple=True) if item[0] == 1] == [
            "Chapter 1 · Introduction",
            "Chapter 3 · Finite Markov Decision Processes",
        ]
