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
    source = pymupdf.open(path)
    page_width = source[1].rect.width
    page_height = source[1].rect.height
    source.close()
    ink = DrawboardInk(
        fingerprint="drawboard-document-red-ink",
        source_revision="1",
        page=2,
        color="red",
        rgb=[1.0, 0.3, 0.36],
        created_at="2026-07-02T12:00:00Z",
        rect=[
            70.0,
            page_height - 120.0,
            190.0,
            page_height - 90.0,
        ],
        ink_vertex_sets=(
            [
                [
                    [72.0, page_height - 100.0],
                    [
                        100.0,
                        page_height - 94.0,
                        130.0,
                        page_height - 112.0,
                        160.0,
                        page_height - 102.0,
                    ],
                    [190.0, page_height - 110.0],
                ]
            ],
        ),
        member_fingerprints=("drawboard-document-red-ink",),
    )

    urls = render_ink_context_images(path, "resource-1", [ink])
    output = (
        tmp_path
        / "annotation-images"
        / "resource-1"
        / "drawboard-document-red-ink.png"
    )
    pixmap = pymupdf.Pixmap(output)

    assert urls[ink.fingerprint].startswith(
        "/api/resources/resource-1/annotation-images/drawboard-document-red-ink?v="
    )
    assert output.read_bytes().startswith(b"\x89PNG")
    assert pixmap.width == round(page_width * 5)
    assert pixmap.width > pixmap.height
    get_settings.cache_clear()


def test_drawboard_margin_coordinates_are_flipped_for_text_context(
    tmp_path: Path,
) -> None:
    path = tmp_path / "book.pdf"
    _context_pdf(path)
    document = pymupdf.open(path)
    page_height = document[2].rect.height
    document.close()
    capture = Capture(
        fingerprint="cloud-margin-note",
        page=3,
        quote="",
        comment="Why?",
        rect=[
            5.0,
            page_height - 95.0,
            45.0,
            page_height - 80.0,
        ],
    )

    contexts = extract_pdf_annotation_contexts(
        path,
        [capture],
        drawboard_coordinates=True,
    )

    context = contexts[capture.fingerprint]
    assert context.context_sentence == "A clue identifies the current bandit task."
    assert context.match_method == "nearest_line"



def test_captures_in_the_same_pdf_paragraph_share_context_group(
    tmp_path: Path,
) -> None:
    path = tmp_path / "paragraph.pdf"
    document = pymupdf.open()
    page = document.new_page()
    paragraph = (
        "Offline evaluation requires overlap between the logging policy and "
        "the target policy. Importance weights become unstable when the "
        "logging probability is very small. Clipping reduces variance but "
        "introduces bias into the estimate."
    )
    page.insert_textbox(pymupdf.Rect(72, 100, 520, 220), paragraph, fontsize=11)
    document.save(path)
    document.close()

    captures = [
        Capture(
            fingerprint="overlap",
            page=1,
            quote="overlap between the logging policy and the target policy",
            comment="",
            rect=[72, 100, 420, 125],
        ),
        Capture(
            fingerprint="clipping",
            page=1,
            quote="Clipping reduces variance but introduces bias",
            comment="",
            rect=[72, 150, 420, 175],
        ),
    ]

    contexts = extract_pdf_annotation_contexts(path, captures)

    assert contexts["overlap"].paragraph_id
    assert contexts["overlap"].paragraph_id == contexts["clipping"].paragraph_id
    assert contexts["overlap"].paragraph_text == paragraph
    assert contexts["clipping"].paragraph_text == paragraph
    assert contexts["overlap"].paragraph_start_page == 1
    assert contexts["overlap"].paragraph_end_page == 1
    assert contexts["overlap"].paragraph_truncated is False


def test_pdf_paragraph_context_can_continue_across_a_page_break(
    tmp_path: Path,
) -> None:
    path = tmp_path / "continued-paragraph.pdf"
    document = pymupdf.open()
    first = document.new_page()
    first.insert_textbox(
        pymupdf.Rect(72, 650, 520, 790),
        "The estimator remains identifiable only while the observed data "
        "contain support for the actions selected by the target policy and",
        fontsize=11,
    )
    second = document.new_page()
    second.insert_textbox(
        pymupdf.Rect(72, 40, 520, 180),
        "this condition must hold in every state that the target policy may visit. "
        "Without it, no amount of reweighting can recover the missing outcomes.",
        fontsize=11,
    )
    document.save(path)
    document.close()

    captures = [
        Capture(
            fingerprint="page-one",
            page=1,
            quote="support for the actions selected by the target policy",
            comment="",
            rect=[72, 700, 500, 740],
        ),
        Capture(
            fingerprint="page-two",
            page=2,
            quote="this condition must hold in every state",
            comment="",
            rect=[72, 40, 500, 85],
        ),
    ]

    contexts = extract_pdf_annotation_contexts(path, captures)

    first_context = contexts["page-one"]
    second_context = contexts["page-two"]
    assert first_context.paragraph_id == second_context.paragraph_id
    assert first_context.paragraph_start_page == 1
    assert first_context.paragraph_end_page == 2
    assert "target policy and this condition" in first_context.paragraph_text


def test_long_pdf_paragraph_is_shortened_around_all_captures(
    tmp_path: Path,
) -> None:
    path = tmp_path / "long-paragraph.pdf"
    sentences = [
        f"Sentence {index} explains a separate detail of the estimator."
        for index in range(1, 17)
    ]
    paragraph = " ".join(sentences)
    document = pymupdf.open()
    page = document.new_page()
    page.insert_textbox(pymupdf.Rect(50, 50, 545, 760), paragraph, fontsize=10)
    document.save(path)
    document.close()

    captures = [
        Capture(
            fingerprint="early",
            page=1,
            quote="Sentence 3 explains a separate detail",
            comment="",
            rect=[50, 120, 500, 145],
        ),
        Capture(
            fingerprint="late",
            page=1,
            quote="Sentence 14 explains a separate detail",
            comment="",
            rect=[50, 580, 500, 605],
        ),
    ]

    contexts = extract_pdf_annotation_contexts(path, captures)

    excerpt = contexts["early"].paragraph_text
    assert contexts["early"].paragraph_id == contexts["late"].paragraph_id
    assert contexts["early"].paragraph_truncated is True
    assert "Sentence 3 explains" in excerpt
    assert "Sentence 14 explains" in excerpt
    assert len(excerpt) < len(paragraph)
