from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

import pymupdf

from .pdf_context_service import _chapter_entries, _outline_entries


class PdfChapterError(RuntimeError):
    """Raised when a chapter-scoped PDF cannot be prepared safely."""


@dataclass(frozen=True, slots=True)
class PdfChapterRange:
    number: int
    title: str
    first_page: int
    last_page: int


def chapter_ranges(source: Path, chapter_numbers: list[int]) -> list[PdfChapterRange]:
    """Resolve complete one-based page ranges for selected logical chapters."""

    requested = set(chapter_numbers)
    if not requested:
        return []
    try:
        with pymupdf.open(source) as document:  # type: ignore[no-untyped-call]
            chapters = _chapter_entries(_outline_entries(document))
            ranges: list[PdfChapterRange] = []
            for index, chapter in enumerate(chapters):
                if chapter.number not in requested:
                    continue
                next_page = (
                    chapters[index + 1].page
                    if index + 1 < len(chapters)
                    else document.page_count + 1
                )
                ranges.append(
                    PdfChapterRange(
                        number=chapter.number,
                        title=chapter.title,
                        first_page=max(1, chapter.page),
                        last_page=min(document.page_count, max(chapter.page, next_page - 1)),
                    )
                )
    except (OSError, RuntimeError, ValueError) as error:
        raise PdfChapterError(f"Could not inspect PDF chapters in {source}.") from error

    missing = requested - {item.number for item in ranges}
    if missing:
        labels = ", ".join(str(number) for number in sorted(missing))
        raise PdfChapterError(f"PDF outline does not contain chapter(s) {labels}.")
    return ranges


def _signature(source: Path, ranges: list[PdfChapterRange]) -> str:
    stat = source.stat()
    payload = {
        "source": str(source.resolve()),
        "size": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
        "ranges": [
            [item.number, item.first_page, item.last_page]
            for item in ranges
        ],
        "version": 1,
    }
    return json.dumps(payload, separators=(",", ":"), sort_keys=True)


def _existing_signature(target: Path) -> str:
    if not target.is_file():
        return ""
    try:
        with pymupdf.open(target) as document:  # type: ignore[no-untyped-call]
            return str(document.metadata.get("keywords") or "")
    except (OSError, RuntimeError, ValueError):
        return ""


def prepare_chapter_pdf(
    source: Path,
    target: Path,
    chapter_numbers: list[int],
) -> tuple[list[PdfChapterRange], bool]:
    """Create or reuse a compact PDF containing complete selected chapters.

    Returns the resolved ranges and whether a new PDF was written.
    """

    ranges = chapter_ranges(source, chapter_numbers)
    signature = _signature(source, ranges)
    if _existing_signature(target) == signature:
        return ranges, False

    temporary = target.with_suffix(f"{target.suffix}.tmp")
    try:
        with pymupdf.open(source) as source_document:  # type: ignore[no-untyped-call]
            output = pymupdf.open()  # type: ignore[no-untyped-call]
            output_toc: list[list[object]] = []
            output_page = 1
            outline = _outline_entries(source_document)
            chapters = _chapter_entries(outline)
            chapter_by_number = {item.number: item for item in chapters}

            for page_range in ranges:
                output.insert_pdf(  # type: ignore[no-untyped-call]
                    source_document,
                    from_page=page_range.first_page - 1,
                    to_page=page_range.last_page - 1,
                    links=True,
                    annots=True,
                )
                output_toc.append(
                    [
                        1,
                        f"Chapter {page_range.number} · {page_range.title}",
                        output_page,
                    ]
                )
                chapter = chapter_by_number[page_range.number]
                for entry in outline:
                    if not (page_range.first_page <= entry.page <= page_range.last_page):
                        continue
                    if entry.index == chapter.index:
                        continue
                    relative_level = max(2, entry.level - chapter.level + 1)
                    output_toc.append(
                        [
                            relative_level,
                            entry.title,
                            output_page + entry.page - page_range.first_page,
                        ]
                    )
                output_page += page_range.last_page - page_range.first_page + 1

            metadata = dict(source_document.metadata or {})
            selected = ", ".join(str(item.number) for item in ranges)
            metadata.update(
                {
                    "title": f"{metadata.get('title') or source.stem} — chapter(s) {selected}",
                    "keywords": signature,
                }
            )
            output.set_metadata(metadata)
            if output_toc:
                output.set_toc(output_toc)
            output.save(temporary, garbage=4, deflate=True)  # type: ignore[no-untyped-call]
            output.close()  # type: ignore[no-untyped-call]
        temporary.replace(target)
        source_stat = source.stat()
        os.utime(target, ns=(source_stat.st_atime_ns, source_stat.st_mtime_ns))
    except (OSError, RuntimeError, ValueError) as error:
        temporary.unlink(missing_ok=True)
        raise PdfChapterError(
            f"Could not create chapter-scoped PDF from {source}."
        ) from error
    return ranges, True
