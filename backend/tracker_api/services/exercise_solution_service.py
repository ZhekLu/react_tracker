from __future__ import annotations

import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pymupdf
from sqlalchemy import text
from sqlalchemy.engine import Connection

from ..config import get_settings
from ..repositories import workspace_repository
from .drawboard_service import (
    DrawboardInk,
    extract_drawboard_annotations,
    is_drawboard_cloud_url,
)
from .pdf_ink_image_service import (
    PdfInkImageError,
    annotation_image_path,
    drawboard_rect_to_pdf,
    render_ink_context_images,
)
from .prompt_attachment_service import ATTACHMENT_LOCK
from .resource_open_service import ResourceOpenError, safe_local_resource_path

EXERCISE_NUMBER = re.compile(r"\b(\d+\.\d+)\b")
EXERCISE_HEADER = re.compile(r"\bExercise\s+(\d+\.\d+)\b", re.IGNORECASE)


class ExerciseSolutionError(RuntimeError):
    """Raised when a task cannot produce handwritten exercise screenshots."""


@dataclass(frozen=True, slots=True)
class ExerciseScreenshot:
    exercise: str
    name: str
    page: int
    path: str


@dataclass(frozen=True, slots=True)
class ExerciseScreenshotBundle:
    directory: str
    exercises: list[str]
    screenshots: list[ExerciseScreenshot]
    warnings: list[str]


@dataclass(frozen=True, slots=True)
class ExerciseLocation:
    number: str
    page: int
    rect: tuple[float, float, float, float]


def _task_resource_ids(connection: Connection, task_id: str) -> tuple[str, list[str]]:
    task = connection.execute(
        text(
            """
            SELECT title
            FROM tasks
            WHERE id = :task_id AND deleted_at IS NULL
            """
        ),
        {"task_id": task_id},
    ).mappings().first()
    if task is None:
        raise ExerciseSolutionError("Task does not exist.")
    resource_ids = [
        str(row["resource_id"])
        for row in connection.execute(
            text(
                """
                SELECT tr.resource_id
                FROM task_resources tr
                JOIN resources r ON r.id = tr.resource_id
                WHERE tr.task_id = :task_id
                  AND r.deleted_at IS NULL
                ORDER BY tr.order_index
                """
            ),
            {"task_id": task_id},
        ).mappings()
    ]
    return str(task["title"]), resource_ids


def exercise_numbers(task_title: str) -> list[str]:
    if "exercise" not in task_title.casefold():
        return []
    return list(dict.fromkeys(EXERCISE_NUMBER.findall(task_title)))


def _exercise_locations(document: Any) -> list[ExerciseLocation]:
    locations: list[ExerciseLocation] = []
    for page_index in range(document.page_count):
        page = document[page_index]
        page_text = page.get_text("text", sort=True)
        numbers = list(dict.fromkeys(EXERCISE_HEADER.findall(page_text)))
        for number in numbers:
            matches = page.search_for(f"Exercise {number}")
            if not matches:
                continue
            rect = matches[0]
            locations.append(
                ExerciseLocation(
                    number=number,
                    page=page_index + 1,
                    rect=(rect.x0, rect.y0, rect.x1, rect.y1),
                )
            )
    return sorted(locations, key=lambda item: (item.page, item.rect[1]))


def _ink_pdf_rect(ink: DrawboardInk, page_height: float) -> list[float]:
    return drawboard_rect_to_pdf(ink.rect, page_height)


def _intersects_vertical(rect: list[float], top: float, bottom: float) -> bool:
    return len(rect) == 4 and min(rect[3], bottom) > max(rect[1], top)


def _overlapping_ink_groups(
    inks: list[DrawboardInk],
    *,
    page_height: float,
    tolerance: float = 12.0,
) -> list[list[DrawboardInk]]:
    remaining = sorted(
        inks,
        key=lambda item: _ink_pdf_rect(item, page_height)[1],
    )
    groups: list[list[DrawboardInk]] = []
    while remaining:
        seed = remaining.pop(0)
        seed_rect = _ink_pdf_rect(seed, page_height)
        band = (seed_rect[1], seed_rect[3])
        group = [seed]
        changed = True
        while changed:
            changed = False
            pending: list[DrawboardInk] = []
            for candidate in remaining:
                rect = _ink_pdf_rect(candidate, page_height)
                if rect[1] <= band[1] + tolerance and rect[3] >= band[0] - tolerance:
                    group.append(candidate)
                    band = (min(band[0], rect[1]), max(band[1], rect[3]))
                    changed = True
                else:
                    pending.append(candidate)
            remaining = pending
        groups.append(group)
    return groups


def _best_solution_group(
    inks: list[DrawboardInk],
    *,
    page_height: float,
    segment_top: float,
    segment_bottom: float,
    continuation_page: bool,
) -> list[DrawboardInk]:
    eligible = [
        item
        for item in inks
        if _intersects_vertical(
            _ink_pdf_rect(item, page_height),
            segment_top,
            segment_bottom,
        )
    ]
    groups = _overlapping_ink_groups(
        eligible,
        page_height=page_height,
    )
    if not groups:
        return []

    def group_score(group: list[DrawboardInk]) -> tuple[float, float]:
        rects = [_ink_pdf_rect(item, page_height) for item in group]
        top = min(rect[1] for rect in rects)
        bottom = max(rect[3] for rect in rects)
        distance = max(0.0, top - segment_top)
        span = bottom - top
        # The solution normally starts beside or just below the Exercise
        # heading. Prefer that nearby band; within it, prefer the largest
        # vertically connected handwriting group.
        return (-distance + min(span, 180.0) * 0.35, span)

    nearby_limit = segment_top + (220.0 if continuation_page else 280.0)
    nearby = [
        group
        for group in groups
        if min(
            _ink_pdf_rect(item, page_height)[1]
            for item in group
        )
        <= nearby_limit
    ]
    return max(nearby or groups, key=group_score)


def _synthetic_crop_ink(
    *,
    task_id: str,
    exercise: str,
    page: int,
    page_height: float,
    top: float,
    bottom: float,
    member_inks: list[DrawboardInk],
) -> DrawboardInk:
    safe_exercise = exercise.replace(".", "-")
    return DrawboardInk(
        fingerprint=f"exercise-{task_id}-{safe_exercise}-p{page}",
        source_revision=":".join(
            sorted(item.source_revision for item in member_inks)
        ),
        page=page,
        color="red",
        rgb=[1.0, 0.1, 0.2],
        created_at=min(item.created_at for item in member_inks),
        rect=[0.0, page_height - bottom, 1.0, page_height - top],
        ink_vertex_sets=(),
        member_fingerprints=tuple(
            fingerprint
            for item in member_inks
            for fingerprint in item.member_fingerprints
        ),
    )


def prepare_exercise_solution_screenshots(
    connection: Connection,
    task_id: str,
) -> ExerciseScreenshotBundle:
    """Render all handwritten solutions linked to exercise numbers in a task."""

    task_title, resource_ids = _task_resource_ids(connection, task_id)
    requested = exercise_numbers(task_title)
    if not requested:
        raise ExerciseSolutionError(
            "The task title does not contain exercise numbers such as 5.3 or 5.10."
        )

    source_path: Path | None = None
    extraction = None
    resource_title = ""
    for resource_id in resource_ids:
        local_path, source_url = workspace_repository.resource_open_target(
            connection,
            resource_id,
        )
        if not local_path or not is_drawboard_cloud_url(source_url):
            continue
        try:
            candidate = safe_local_resource_path(local_path)
        except ResourceOpenError:
            continue
        assert source_url is not None
        extraction = extract_drawboard_annotations(source_url)
        source_path = candidate
        resource_title = str(
            connection.execute(
                text("SELECT title FROM resources WHERE id = :resource_id"),
                {"resource_id": resource_id},
            ).scalar_one()
        )
        break
    if source_path is None or extraction is None:
        raise ExerciseSolutionError(
            "No linked resource has both a local PDF and a Drawboard cloud URL."
        )

    try:
        document: Any = pymupdf.open(source_path)  # type: ignore[no-untyped-call]
    except Exception as error:
        raise ExerciseSolutionError(f"Could not read {source_path}.") from error
    warnings: list[str] = []
    screenshots: list[ExerciseScreenshot] = []
    rendered_paths: list[tuple[str, int, Path]] = []
    try:
        locations = _exercise_locations(document)
        location_by_number = {item.number: item for item in locations}
        all_ink = list(extraction.all_ink)
        for exercise in requested:
            location = location_by_number.get(exercise)
            if location is None:
                warnings.append(f"Exercise {exercise}: header was not found in the PDF.")
                continue
            location_index = locations.index(location)
            next_location = (
                locations[location_index + 1]
                if location_index + 1 < len(locations)
                else None
            )
            selected_group: tuple[int, float, float, list[DrawboardInk]] | None = None
            # A solution is deliberately written beside its exercise. Do not
            # borrow unrelated reading notes from later pages merely because
            # the next printed Exercise heading is several pages away.
            for page_number in [location.page]:
                page = document[page_number - 1]
                top = location.rect[1] if page_number == location.page else 0.0
                bottom = (
                    next_location.rect[1]
                    if next_location is not None and page_number == next_location.page
                    else float(page.rect.height)
                )
                page_ink = _best_solution_group(
                    [
                        item
                        for item in all_ink
                        if item.page == page_number
                    ],
                    page_height=float(page.rect.height),
                    segment_top=top,
                    segment_bottom=bottom,
                    continuation_page=False,
                )
                if not page_ink:
                    continue
                selected_group = (page_number, top, bottom, page_ink)
                break

            if selected_group is None:
                warnings.append(
                    f"Exercise {exercise}: no handwriting was found before the next exercise."
                )
                continue

            page_number, top, bottom, page_ink = selected_group
            page = document[page_number - 1]
            ink_rects = [
                _ink_pdf_rect(item, float(page.rect.height))
                for item in page_ink
            ]
            group_top = min(rect[1] for rect in ink_rects)
            group_bottom = max(rect[3] for rect in ink_rects)
            crop_top = (
                min(top, group_top)
                if page_number == location.page
                else group_top
            )
            crop_bottom = min(bottom, group_bottom + 18.0)
            crop = _synthetic_crop_ink(
                task_id=task_id,
                exercise=exercise,
                page=page_number,
                page_height=float(page.rect.height),
                top=max(0.0, crop_top - 5.0),
                bottom=crop_bottom,
                member_inks=page_ink,
            )
            try:
                render_ink_context_images(
                    source_path,
                    extraction.document_id,
                    [crop],
                    captures=extraction.captures,
                    page_inks=extraction.all_ink,
                    margin=16.0,
                    scale=4.0,
                )
            except PdfInkImageError as error:
                warnings.append(f"Exercise {exercise}: {error}")
                continue
            rendered_paths.append(
                (
                    exercise,
                    page_number,
                    annotation_image_path(
                        extraction.document_id,
                        crop.fingerprint,
                    ),
                )
            )
    finally:
        document.close()

    destination = get_settings().chatgpt_attachment_dir.expanduser().resolve()
    with ATTACHMENT_LOCK:
        destination.mkdir(parents=True, exist_ok=True)
        for child in destination.iterdir():
            if child.is_dir() and not child.is_symlink():
                shutil.rmtree(child)
            else:
                child.unlink()
        for exercise, page_number, source in rendered_paths:
            name = f"exercise-{exercise.replace('.', '-')}-p{page_number}.png"
            target = destination / name
            shutil.copy2(source, target)
            screenshots.append(
                ExerciseScreenshot(
                    exercise=exercise,
                    name=name,
                    page=page_number,
                    path=str(target),
                )
            )
        manifest = [
            "# Handwritten exercise solutions",
            "",
            f"Task: {task_title}",
            f"Source: {resource_title}",
            "",
            *[
                f"- `{item.name}` — Exercise {item.exercise}, PDF page {item.page}"
                for item in screenshots
            ],
        ]
        if warnings:
            manifest.extend(["", "## Warnings", "", *[f"- {item}" for item in warnings]])
        (destination / "README.md").write_text(
            "\n".join(manifest).rstrip() + "\n",
            encoding="utf-8",
        )

    return ExerciseScreenshotBundle(
        directory=str(destination),
        exercises=requested,
        screenshots=screenshots,
        warnings=warnings,
    )
