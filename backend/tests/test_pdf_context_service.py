from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pymupdf
import pytest

from tracker_api.config import get_settings
from tracker_api.services.drawboard_service import DrawboardInk
from tracker_api.services.pdf_context_service import (
    extract_pdf_annotation_contexts,
)
from tracker_api.services.pdf_ink_image_service import (
    render_ink_context_images,
)


@dataclass(frozen=True)
class Capture:
    fingerprint: str
    page: int
    quote: str
    comment: str
    rect: list[float]


def _context_pdf(path: Path) -> None:
    document = pymupdf.open()
    introduction = document.new_page()
    introduction.insert_textbox(
        pymupdf.Rect(72, 80, 540, 180),
        "A previous sentence ends here. The introduction explains the setting. "
        "A following sentence adds context.",
        fontsize=10,
    )
    bandits = document.new_page()
    bandits.insert_textbox(
        pymupdf.Rect(72, 80, 540, 180),
        "Before the estimate, exploration matters. "
        "The estimated action value improves with every sample. "
        "After the estimate, uncertainty remains.",
        fontsize=10,
    )
    contextual = document.new_page()
    contextual.insert_textbox(
        pymupdf.Rect(72, 80, 540, 180),
        "A clue identifies the current bandit task. "
        "The agent can condition its policy on that clue. "
        "The next chapter generalizes this idea.",
        fontsize=10,
    )
    document.set_toc(
        [
            [1, "Introduction", 1],
            [2, "Reinforcement Learning", 1],
            [1, "I   Tabular Solution Methods", 2],
            [2, "Multi-armed Bandits", 2],
            [3, "Action-value Methods", 2],
            [3, "Associative Search (Contextual Bandits)", 3],
        ]
    )
    document.save(path)
    document.close()


def test_pdf_context_uses_outline_and_surrounding_sentences(
    tmp_path: Path,
) -> None:
    path = tmp_path / "book.pdf"
    _context_pdf(path)
    captures = [
        Capture(
            fingerprint="highlight",
            page=2,
            quote="estimated action value improves with every sample",
            comment="",
            rect=[70, 88, 350, 104],
        ),
        Capture(
            fingerprint="margin-note",
            page=3,
            quote="",
            comment="Why?",
            rect=[5, 80, 45, 90],
        ),
    ]

    contexts = extract_pdf_annotation_contexts(path, captures)

    highlight = contexts["highlight"]
    assert highlight.chapter_number == 2
    assert highlight.chapter_title == "Chapter 2 · Multi-armed Bandits"
    assert highlight.subchapter_title == "2.1 · Action-value Methods"
    assert (
        highlight.context_sentence
        == "The estimated action value improves with every sample."
    )
    assert highlight.context_before == "Before the estimate, exploration matters."
    assert highlight.context_after == "After the estimate, uncertainty remains."
    assert highlight.match_method == "exact_quote"

    note = contexts["margin-note"]
    assert note.subchapter_title == (
        "2.2 · Associative Search (Contextual Bandits)"
    )
    assert note.context_sentence == "A clue identifies the current bandit task."
    assert note.match_method == "nearest_line"


def test_red_ink_context_image_uses_full_page_width(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = tmp_path / "book.pdf"
    _context_pdf(path)
    monkeypatch.setenv(
        "TRACKER_ANNOTATION_IMAGE_DIR",
        str(tmp_path / "annotation-images"),
    )
    get_settings.cache_clear()
    ink = DrawboardInk(
        fingerprint="drawboard-document-red-ink",
        source_revision="1",
        page=2,
        color="red",
        rgb=[1.0, 0.3, 0.36],
        created_at="2026-07-02T12:00:00Z",
        rect=[70.0, 90.0, 190.0, 120.0],
        ink_vertices=[
            [
                [
                    [72.0, 100.0],
                    [100.0, 94.0, 130.0, 112.0, 160.0, 102.0],
                    [190.0, 110.0],
                ]
            ]
        ],
    )

    urls = render_ink_context_images(path, "resource-1", [ink])
    output = (
        tmp_path
        / "annotation-images"
        / "resource-1"
        / "drawboard-document-red-ink.png"
    )
    pixmap = pymupdf.Pixmap(output)

    assert urls[ink.fingerprint].endswith(
        "/resource-1/annotation-images/drawboard-document-red-ink"
    )
    assert output.read_bytes().startswith(b"\x89PNG")
    assert pixmap.width > pixmap.height
    get_settings.cache_clear()
