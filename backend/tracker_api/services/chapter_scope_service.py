from __future__ import annotations

import re

DASHES = re.compile(r"[\u2010\u2011\u2012\u2013\u2014\u2212]")
SECTION_NUMBER = re.compile(r"(?<![\d.])(\d{1,3})\.\d+(?![\d.])")
CHAPTER_REFERENCE = re.compile(
    r"\bchapters?\s+(\d{1,3})(?:\s*-\s*(\d{1,3}))?",
    re.IGNORECASE,
)
CHAPTER_TITLE = re.compile(r"\bchapter\s+(\d{1,3})\b", re.IGNORECASE)
LEADING_SECTION = re.compile(r"^\s*(\d{1,3})(?:\.\d+)+\b")
CHAPTER_LABEL = re.compile(r"\bchapter\s+(\d{1,3})\b", re.IGNORECASE)


def referenced_chapter_numbers(task_title: str) -> list[int]:
    """Return chapter-level scope explicitly mentioned by a task title.

    Section references are intentionally collapsed to their leading chapter.
    For example, ``Sections 4.1-4.3`` becomes ``[4]`` while
    ``Sections 3.1-3.6 and 4.1-4.4`` becomes ``[3, 4]``. Bare slide/page
    ranges are ignored because they do not use dotted section notation.
    """

    normalized = DASHES.sub("-", task_title or "")
    chapters = {int(match.group(1)) for match in SECTION_NUMBER.finditer(normalized)}

    for match in CHAPTER_REFERENCE.finditer(normalized):
        start = int(match.group(1))
        end = int(match.group(2) or start)
        lower, upper = sorted((start, end))
        # A malformed task should not expand into hundreds of chapter groups.
        if upper - lower <= 50:
            chapters.update(range(lower, upper + 1))
        else:
            chapters.update({lower, upper})

    # This catches a singular "Chapter 4" even when it is followed by a
    # separately worded section clause.
    chapters.update(int(match.group(1)) for match in CHAPTER_TITLE.finditer(normalized))
    return sorted(chapters)


def annotation_chapter_number(
    *,
    chapter_number: object = None,
    chapter_title: object = None,
    chapter_label: object = None,
    subchapter_title: object = None,
    section_title: object = None,
) -> int | None:
    """Resolve a chapter number from imported annotation context metadata."""

    if isinstance(chapter_number, bool):
        chapter_number = None
    if isinstance(chapter_number, (int, float)):
        return int(chapter_number)
    if isinstance(chapter_number, str) and chapter_number.strip().isdigit():
        return int(chapter_number.strip())

    for value in (chapter_title, chapter_label, subchapter_title, section_title):
        if not isinstance(value, str):
            continue
        match = CHAPTER_LABEL.search(value) or LEADING_SECTION.search(value)
        if match:
            return int(match.group(1))
    return None
