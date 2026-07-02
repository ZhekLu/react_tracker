from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol, cast

import pymupdf

from .pdf_ink_image_service import drawboard_rect_to_pdf

PART_TITLE = re.compile(r"^[IVXLC]+\s+\S")
SENTENCE_BREAK = re.compile(
    r"(?<=[.!?])\s+(?=(?:[A-Z0-9“\"'(\[]|Exercise\s|Figure\s))"
)
WORD_TOKEN = re.compile(r"[a-z0-9]+")


class PdfContextError(RuntimeError):
    """Raised when a local PDF cannot provide annotation context."""


class ContextCapture(Protocol):
    @property
    def fingerprint(self) -> str: ...

    @property
    def page(self) -> int: ...

    @property
    def quote(self) -> str: ...

    @property
    def comment(self) -> str: ...

    @property
    def rect(self) -> list[float]: ...


@dataclass(frozen=True, slots=True)
class OutlineEntry:
    index: int
    level: int
    title: str
    page: int


@dataclass(frozen=True, slots=True)
class ChapterEntry:
    index: int
    level: int
    number: int
    page: int
    title: str


@dataclass(frozen=True, slots=True)
class PdfAnnotationContext:
    chapter_number: int | None
    chapter_title: str
    context_after: str
    context_before: str
    context_sentence: str
    match_method: str
    subchapter_title: str


def _normalized_text(value: str) -> str:
    replacements = {
        "↵": "ff",
        "ﬁ": "fi",
        "ﬂ": "fl",
        "\u2013": "-",
        "\u2014": "-",
        "\u2212": "-",
        "\u00ad": "",
    }
    normalized = unicodedata.normalize("NFKC", value or "")
    for source, target in replacements.items():
        normalized = normalized.replace(source, target)
    normalized = re.sub(r"\s*-\s*", "-", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def _outline_entries(document: Any) -> list[OutlineEntry]:
    entries: list[OutlineEntry] = []
    for index, raw in enumerate(document.get_toc(simple=True)):
        if len(raw) < 3:
            continue
        level, title, page = raw[:3]
        entries.append(
            OutlineEntry(
                index=index,
                level=int(level),
                title=_normalized_text(str(title)),
                page=int(page),
            )
        )
    return entries


def _chapter_entries(outline: list[OutlineEntry]) -> list[ChapterEntry]:
    chapters: list[ChapterEntry] = []
    inside_part = False
    next_number = 1
    for entry in outline:
        if entry.level == 1 and entry.title == "Introduction":
            chapters.append(
                ChapterEntry(
                    index=entry.index,
                    level=entry.level,
                    number=next_number,
                    page=entry.page,
                    title=entry.title,
                )
            )
            next_number += 1
            inside_part = False
            continue
        if entry.level == 1:
            inside_part = PART_TITLE.match(entry.title) is not None
            continue
        if inside_part and entry.level == 2:
            chapters.append(
                ChapterEntry(
                    index=entry.index,
                    level=entry.level,
                    number=next_number,
                    page=entry.page,
                    title=entry.title,
                )
            )
            next_number += 1
    return chapters


def _active_chapter(
    chapters: list[ChapterEntry],
    page: int,
) -> ChapterEntry | None:
    active = [chapter for chapter in chapters if chapter.page <= page]
    return active[-1] if active else None


def _subchapter_title(
    outline: list[OutlineEntry],
    chapters: list[ChapterEntry],
    chapter: ChapterEntry | None,
    page: int,
) -> str:
    if chapter is None:
        return ""
    chapter_position = chapters.index(chapter)
    next_index = (
        chapters[chapter_position + 1].index
        if chapter_position + 1 < len(chapters)
        else len(outline)
    )
    candidates = [
        entry
        for entry in outline
        if chapter.index < entry.index < next_index
        and entry.level > chapter.level
        and entry.page <= page
    ]
    if not candidates:
        return ""
    selected = candidates[-1]
    primary_sections = [
        entry
        for entry in outline
        if chapter.index < entry.index <= selected.index
        and entry.level == chapter.level + 1
    ]
    if selected.level == chapter.level + 1:
        return f"{chapter.number}.{len(primary_sections)} · {selected.title}"
    return selected.title


def _sentences(page_text: str) -> list[str]:
    text = _normalized_text(page_text)
    return [
        sentence.strip()
        for sentence in SENTENCE_BREAK.split(text)
        if sentence.strip()
    ]


def _tokens(value: str) -> set[str]:
    return {
        token
        for token in WORD_TOKEN.findall(_normalized_text(value).casefold())
        if len(token) > 2
    }


def _best_sentence_index(sentences: list[str], hint: str) -> int | None:
    hint_tokens = _tokens(hint)
    if not hint_tokens:
        return None
    scored = [
        (
            len(hint_tokens & _tokens(sentence)) / len(hint_tokens),
            index,
        )
        for index, sentence in enumerate(sentences)
    ]
    score, index = max(scored, default=(0.0, -1))
    return index if score >= 0.35 else None


def _exact_sentence_indexes(
    sentences: list[str],
    quote: str,
) -> list[int]:
    normalized_quote = _normalized_text(quote).casefold()
    if not normalized_quote:
        return []
    page_text = " ".join(sentences)
    start = page_text.casefold().find(normalized_quote)
    if start < 0:
        return []
    end = start + len(normalized_quote)
    indexes: list[int] = []
    cursor = 0
    for index, sentence in enumerate(sentences):
        sentence_start = cursor
        sentence_end = cursor + len(sentence)
        if sentence_start < end and sentence_end > start:
            indexes.append(index)
        cursor = sentence_end + 1
    return indexes


def _nearest_line_hint(page: Any, rect: list[float]) -> str:
    if len(rect) != 4:
        return ""
    target_y = (rect[1] + rect[3]) / 2
    lines: dict[tuple[int, int], list[tuple[float, float, str]]] = {}
    for raw_word in page.get_text("words", sort=True):
        if len(raw_word) < 8:
            continue
        x0, y0, _x1, y1, text_value, block, line, _word = raw_word[:8]
        lines.setdefault((int(block), int(line)), []).append(
            (float(x0), (float(y0) + float(y1)) / 2, str(text_value))
        )
    if not lines:
        return ""
    _key, words = min(
        lines.items(),
        key=lambda item: abs(
            sum(word[1] for word in item[1]) / len(item[1]) - target_y
        ),
    )
    line_text = " ".join(
        word[2] for word in sorted(words, key=lambda word: word[0])
    )
    return re.split(r"(?<=[.!?])\s+", line_text, maxsplit=1)[0]


def _sentence_context(
    page: Any,
    capture: ContextCapture,
    *,
    drawboard_coordinates: bool,
) -> tuple[str, str, str, str]:
    sentences = _sentences(page.get_text("text", sort=True))
    if not sentences:
        return "", "", "", "unavailable"
    exact_indexes = _exact_sentence_indexes(sentences, capture.quote)
    if exact_indexes:
        first = exact_indexes[0]
        last = exact_indexes[-1]
        return (
            sentences[first - 1] if first > 0 else "",
            " ".join(sentences[first : last + 1]),
            sentences[last + 1] if last + 1 < len(sentences) else "",
            "exact_quote",
        )
    rect = (
        drawboard_rect_to_pdf(capture.rect, page.rect.height)
        if drawboard_coordinates
        else capture.rect
    )
    hint = capture.quote or _nearest_line_hint(page, rect)
    index = _best_sentence_index(sentences, hint)
    if index is None:
        return "", "", "", "unavailable"
    return (
        sentences[index - 1] if index > 0 else "",
        sentences[index],
        sentences[index + 1] if index + 1 < len(sentences) else "",
        "fuzzy_quote" if capture.quote else "nearest_line",
    )


def extract_pdf_annotation_contexts(
    path: Path,
    captures: Iterable[ContextCapture],
    *,
    drawboard_coordinates: bool = False,
) -> dict[str, PdfAnnotationContext]:
    pdf_path = path.expanduser().resolve()
    try:
        document: Any = pymupdf.open(pdf_path)  # type: ignore[no-untyped-call]
    except Exception as error:
        raise PdfContextError(f"Could not read PDF context: {pdf_path}") from error
    contexts: dict[str, PdfAnnotationContext] = {}
    try:
        outline = _outline_entries(document)
        chapters = _chapter_entries(outline)
        for capture in captures:
            if capture.page < 1 or capture.page > document.page_count:
                continue
            chapter = _active_chapter(chapters, capture.page)
            page = document[capture.page - 1]
            before, sentence, after, match_method = _sentence_context(
                page,
                capture,
                drawboard_coordinates=drawboard_coordinates,
            )
            contexts[capture.fingerprint] = PdfAnnotationContext(
                chapter_number=chapter.number if chapter else None,
                chapter_title=(
                    f"Chapter {chapter.number} · {chapter.title}"
                    if chapter
                    else ""
                ),
                context_after=after,
                context_before=before,
                context_sentence=sentence,
                match_method=match_method,
                subchapter_title=_subchapter_title(
                    outline,
                    chapters,
                    chapter,
                    capture.page,
                ),
            )
    finally:
        cast(Any, document).close()
    return contexts
