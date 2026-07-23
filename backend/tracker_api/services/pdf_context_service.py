from __future__ import annotations

import hashlib
import re
import unicodedata
from collections import defaultdict
from collections.abc import Iterable, Sequence
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
TERMINAL_PUNCTUATION = re.compile(r"[.!?][\"'\u2019\u201d\])}]*$")
PAGE_NUMBER_ONLY = re.compile(r"^\s*(?:page\s+)?\d+\s*$", re.IGNORECASE)
MAX_PARAGRAPH_CONTEXT_CHARACTERS = 1800
MAX_PARAGRAPH_CONTEXT_SENTENCES = 12
PARAGRAPH_SENTENCE_MARGIN = 1


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
class PdfTextBlock:
    page: int
    index: int
    rect: tuple[float, float, float, float]
    text: str


@dataclass(frozen=True, slots=True)
class PdfParagraph:
    id: str
    blocks: tuple[PdfTextBlock, ...]
    text: str
    start_page: int
    end_page: int


@dataclass(frozen=True, slots=True)
class PdfAnnotationContext:
    chapter_number: int | None
    chapter_title: str
    context_after: str
    context_before: str
    context_sentence: str
    match_method: str
    subchapter_title: str
    paragraph_id: str = ""
    paragraph_text: str = ""
    paragraph_start_page: int | None = None
    paragraph_end_page: int | None = None
    paragraph_truncated: bool = False
    page_width: float | None = None
    page_height: float | None = None
    page_count: int | None = None


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


def _text_blocks(page: Any, page_number: int) -> list[PdfTextBlock]:
    blocks: list[PdfTextBlock] = []
    page_height = float(page.rect.height)
    for index, raw in enumerate(page.get_text("blocks", sort=True)):
        if len(raw) < 5:
            continue
        block_type = int(raw[6]) if len(raw) > 6 else 0
        if block_type != 0:
            continue
        x0, y0, x1, y1, raw_text = raw[:5]
        text_value = _normalized_text(str(raw_text))
        if not text_value:
            continue
        if PAGE_NUMBER_ONLY.fullmatch(text_value) and (
            float(y0) < page_height * 0.08 or float(y1) > page_height * 0.92
        ):
            continue
        blocks.append(
            PdfTextBlock(
                page=page_number,
                index=index,
                rect=(float(x0), float(y0), float(x1), float(y1)),
                text=text_value,
            )
        )
    return blocks


def _starts_like_continuation(text_value: str) -> bool:
    stripped = text_value.lstrip()
    if not stripped:
        return False
    first = stripped[0]
    return first.islower() or first in ",;:)]}\u201d\u2019"


def _ends_like_continuation(text_value: str) -> bool:
    stripped = text_value.rstrip()
    return bool(stripped) and (
        stripped.endswith(("-", "\u2013", "\u2014"))
        or TERMINAL_PUNCTUATION.search(stripped) is None
    )


def _merge_across_page_break(
    left: PdfTextBlock,
    right: PdfTextBlock,
    *,
    left_page_height: float,
    right_page_height: float,
) -> bool:
    if left.page + 1 != right.page:
        return False
    near_bottom = left.rect[3] >= left_page_height * 0.68
    near_top = right.rect[1] <= right_page_height * 0.34
    if not near_bottom or not near_top:
        return False
    return _starts_like_continuation(right.text) or _ends_like_continuation(left.text)


def _paragraph_id(blocks: Sequence[PdfTextBlock], text_value: str) -> str:
    first = blocks[0]
    last = blocks[-1]
    digest = hashlib.sha1(
        (
            f"{first.page}:{first.index}:{last.page}:{last.index}:"
            f"{_normalized_text(text_value).casefold()}"
        ).encode(),
        usedforsecurity=False,
    ).hexdigest()[:20]
    return f"pdf-paragraph-{digest}"


def _paragraphs(document: Any) -> tuple[list[PdfParagraph], dict[int, list[PdfParagraph]]]:
    blocks_by_page: dict[int, list[PdfTextBlock]] = {}
    page_heights: dict[int, float] = {}
    for page_index in range(document.page_count):
        page_number = page_index + 1
        page = document[page_index]
        page_heights[page_number] = float(page.rect.height)
        blocks_by_page[page_number] = _text_blocks(page, page_number)

    groups: list[list[PdfTextBlock]] = []
    for page_number in range(1, document.page_count + 1):
        for block in blocks_by_page.get(page_number, []):
            if groups:
                previous = groups[-1][-1]
                previous_page_blocks = blocks_by_page.get(previous.page, [])
                current_page_blocks = blocks_by_page.get(block.page, [])
                is_last_previous = (
                    bool(previous_page_blocks)
                    and previous is previous_page_blocks[-1]
                )
                is_first_current = (
                    bool(current_page_blocks)
                    and block is current_page_blocks[0]
                )
                if (
                    is_last_previous
                    and is_first_current
                    and _merge_across_page_break(
                        previous,
                        block,
                        left_page_height=page_heights[previous.page],
                        right_page_height=page_heights[block.page],
                    )
                ):
                    groups[-1].append(block)
                    continue
            groups.append([block])

    paragraphs: list[PdfParagraph] = []
    by_page: dict[int, list[PdfParagraph]] = defaultdict(list)
    for block_group in groups:
        paragraph_text = _normalized_text(" ".join(block.text for block in block_group))
        paragraph = PdfParagraph(
            id=_paragraph_id(block_group, paragraph_text),
            blocks=tuple(block_group),
            text=paragraph_text,
            start_page=block_group[0].page,
            end_page=block_group[-1].page,
        )
        paragraphs.append(paragraph)
        for page_number in range(paragraph.start_page, paragraph.end_page + 1):
            by_page[page_number].append(paragraph)
    return paragraphs, by_page


def _capture_pdf_rect(
    page: Any,
    capture: ContextCapture,
    *,
    drawboard_coordinates: bool,
) -> list[float]:
    return (
        drawboard_rect_to_pdf(capture.rect, page.rect.height)
        if drawboard_coordinates
        else capture.rect
    )


def _vertical_distance(rect: Sequence[float], block: PdfTextBlock) -> float:
    if len(rect) != 4:
        return float("inf")
    center = (float(rect[1]) + float(rect[3])) / 2
    block_center = (block.rect[1] + block.rect[3]) / 2
    return abs(center - block_center)


def _vertical_overlap(rect: Sequence[float], block: PdfTextBlock) -> float:
    if len(rect) != 4:
        return 0.0
    top = max(float(rect[1]), block.rect[1])
    bottom = min(float(rect[3]), block.rect[3])
    return max(0.0, bottom - top)


def _paragraph_for_capture(
    page: Any,
    capture: ContextCapture,
    candidates: Sequence[PdfParagraph],
    *,
    drawboard_coordinates: bool,
) -> PdfParagraph | None:
    if not candidates:
        return None
    normalized_quote = _normalized_text(capture.quote).casefold()
    quote_tokens = _tokens(capture.quote)
    rect = _capture_pdf_rect(
        page,
        capture,
        drawboard_coordinates=drawboard_coordinates,
    )
    scored: list[tuple[float, PdfParagraph]] = []
    for paragraph in candidates:
        page_blocks = [block for block in paragraph.blocks if block.page == capture.page]
        if not page_blocks:
            continue
        normalized_paragraph = paragraph.text.casefold()
        exact = 1.0 if normalized_quote and normalized_quote in normalized_paragraph else 0.0
        overlap = (
            len(quote_tokens & _tokens(paragraph.text)) / len(quote_tokens)
            if quote_tokens
            else 0.0
        )
        geometry_overlap = max(_vertical_overlap(rect, block) for block in page_blocks)
        distance = min(_vertical_distance(rect, block) for block in page_blocks)
        geometry_score = geometry_overlap * 0.1 + (1.0 / (1.0 + distance))
        scored.append((exact * 100 + overlap * 10 + geometry_score, paragraph))
    if not scored:
        return None
    score, paragraph = max(scored, key=lambda item: item[0])
    if normalized_quote and score < 3.5:
        return None
    return paragraph


def _capture_sentence_indexes_in_paragraph(
    document: Any,
    paragraph: PdfParagraph,
    capture: ContextCapture,
    *,
    drawboard_coordinates: bool,
) -> list[int]:
    sentences = _sentences(paragraph.text)
    exact = _exact_sentence_indexes(sentences, capture.quote)
    if exact:
        return exact
    page = document[capture.page - 1]
    rect = _capture_pdf_rect(page, capture, drawboard_coordinates=drawboard_coordinates)
    hint = capture.quote or _nearest_line_hint(page, rect)
    index = _best_sentence_index(sentences, hint)
    return [index] if index is not None else []


def _merge_windows(windows: list[tuple[int, int]]) -> list[tuple[int, int]]:
    if not windows:
        return []
    ordered = sorted(windows)
    merged = [ordered[0]]
    for start, end in ordered[1:]:
        previous_start, previous_end = merged[-1]
        if start <= previous_end + 1:
            merged[-1] = (previous_start, max(previous_end, end))
        else:
            merged.append((start, end))
    return merged


def _paragraph_excerpt(
    document: Any,
    paragraph: PdfParagraph,
    captures: Sequence[ContextCapture],
    *,
    drawboard_coordinates: bool,
) -> tuple[str, bool]:
    sentences = _sentences(paragraph.text)
    if (
        len(paragraph.text) <= MAX_PARAGRAPH_CONTEXT_CHARACTERS
        and len(sentences) <= MAX_PARAGRAPH_CONTEXT_SENTENCES
    ):
        return paragraph.text, False
    if not sentences:
        return paragraph.text[:MAX_PARAGRAPH_CONTEXT_CHARACTERS].rstrip(), True

    indexes = {
        index
        for capture in captures
        for index in _capture_sentence_indexes_in_paragraph(
            document,
            paragraph,
            capture,
            drawboard_coordinates=drawboard_coordinates,
        )
    }
    if not indexes:
        indexes = {0}
    windows = _merge_windows(
        [
            (
                max(0, index - PARAGRAPH_SENTENCE_MARGIN),
                min(len(sentences) - 1, index + PARAGRAPH_SENTENCE_MARGIN),
            )
            for index in sorted(indexes)
        ]
    )
    chunks = [" ".join(sentences[start : end + 1]) for start, end in windows]
    excerpt = " … ".join(chunks)
    if len(excerpt) > MAX_PARAGRAPH_CONTEXT_CHARACTERS:
        excerpt = excerpt[:MAX_PARAGRAPH_CONTEXT_CHARACTERS].rsplit(" ", 1)[0] + " …"
    return excerpt, True


def extract_pdf_annotation_contexts(
    path: Path,
    captures: Iterable[ContextCapture],
    *,
    drawboard_coordinates: bool = False,
) -> dict[str, PdfAnnotationContext]:
    pdf_path = path.expanduser().resolve()
    try:
        document: Any = pymupdf.open(  # type: ignore[no-untyped-call]
            pdf_path
        )
    except Exception as error:
        raise PdfContextError(f"Could not read PDF context: {pdf_path}") from error
    contexts: dict[str, PdfAnnotationContext] = {}
    capture_list = list(captures)
    try:
        outline = _outline_entries(document)
        chapters = _chapter_entries(outline)
        _all_paragraphs, paragraphs_by_page = _paragraphs(document)
        paragraph_by_capture: dict[str, PdfParagraph] = {}
        captures_by_paragraph: dict[str, list[ContextCapture]] = defaultdict(list)

        for capture in capture_list:
            if capture.page < 1 or capture.page > document.page_count:
                continue
            page = document[capture.page - 1]
            paragraph = _paragraph_for_capture(
                page,
                capture,
                paragraphs_by_page.get(capture.page, []),
                drawboard_coordinates=drawboard_coordinates,
            )
            if paragraph is not None:
                paragraph_by_capture[capture.fingerprint] = paragraph
                captures_by_paragraph[paragraph.id].append(capture)

        paragraph_context: dict[str, tuple[str, bool]] = {
            paragraph.id: _paragraph_excerpt(
                document,
                paragraph,
                captures_by_paragraph[paragraph.id],
                drawboard_coordinates=drawboard_coordinates,
            )
            for paragraph in set(paragraph_by_capture.values())
        }

        for capture in capture_list:
            if capture.page < 1 or capture.page > document.page_count:
                continue
            chapter = _active_chapter(chapters, capture.page)
            page = document[capture.page - 1]
            before, sentence, after, match_method = _sentence_context(
                page,
                capture,
                drawboard_coordinates=drawboard_coordinates,
            )
            paragraph = paragraph_by_capture.get(capture.fingerprint)
            paragraph_text = ""
            paragraph_truncated = False
            if paragraph is not None:
                paragraph_text, paragraph_truncated = paragraph_context[paragraph.id]
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
                paragraph_id=paragraph.id if paragraph else "",
                paragraph_text=paragraph_text,
                paragraph_start_page=(paragraph.start_page if paragraph else None),
                paragraph_end_page=(paragraph.end_page if paragraph else None),
                paragraph_truncated=paragraph_truncated,
                page_width=float(page.rect.width),
                page_height=float(page.rect.height),
                page_count=int(document.page_count),
            )
    finally:
        cast(Any, document).close()
    return contexts
