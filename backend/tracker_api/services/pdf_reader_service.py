from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import cast

import pymupdf

from .resource_open_service import ResourceOpenError, safe_local_resource_path


class PdfReaderError(RuntimeError):
    """Raised when a local PDF cannot be rendered by the lecture reader."""


@dataclass(frozen=True, slots=True)
class PdfPage:
    number: int
    title: str


@dataclass(frozen=True, slots=True)
class PdfReaderMetadata:
    path: Path
    page_count: int
    pages: list[PdfPage]


def _pdf_path(local_path: str | None) -> Path:
    if not local_path:
        raise PdfReaderError("This resource has no local PDF file.")
    try:
        path = safe_local_resource_path(local_path)
    except ResourceOpenError as error:
        raise PdfReaderError(str(error)) from error
    if path.suffix.lower() != ".pdf":
        raise PdfReaderError("The lecture reader supports PDF files only.")
    return path


def _page_title(page: pymupdf.Page, page_number: int) -> str:
    clip = pymupdf.Rect(
        0,
        0,
        page.rect.width,
        min(page.rect.height * 0.26, 240),
    )
    lines = [
        re.sub(r"\s+", " ", line).strip()
        for line in page.get_text(
            "text",
            clip=clip,
        ).splitlines()
    ]
    candidates = [
        line
        for line in lines
        if 3 <= len(line) <= 180
        and not re.fullmatch(r"(?:page\s*)?\d+", line, flags=re.IGNORECASE)
    ]
    return candidates[0] if candidates else f"Slide {page_number}"


def pdf_metadata(local_path: str | None) -> PdfReaderMetadata:
    path = _pdf_path(local_path)
    try:
        with pymupdf.open(path) as document:
            pages = [
                PdfPage(
                    number=index + 1,
                    title=_page_title(document[index], index + 1),
                )
                for index in range(document.page_count)
            ]
    except (OSError, RuntimeError, ValueError) as error:
        raise PdfReaderError(f"Could not inspect PDF: {path.name}") from error
    return PdfReaderMetadata(
        path=path,
        page_count=len(pages),
        pages=pages,
    )


def render_pdf_page(
    local_path: str | None,
    page_number: int,
) -> bytes:
    path = _pdf_path(local_path)
    try:
        with pymupdf.open(path) as document:
            if page_number < 1 or page_number > document.page_count:
                raise PdfReaderError(
                    f"Page {page_number} is outside this PDF."
                )
            page = document[page_number - 1]
            pixmap = page.get_pixmap(
                matrix=pymupdf.Matrix(2.2, 2.2),
                alpha=False,
                colorspace=pymupdf.csRGB,
            )
            return cast(bytes, pixmap.tobytes("png"))
    except PdfReaderError:
        raise
    except (OSError, RuntimeError, ValueError) as error:
        raise PdfReaderError(
            f"Could not render page {page_number} from {path.name}."
        ) from error
