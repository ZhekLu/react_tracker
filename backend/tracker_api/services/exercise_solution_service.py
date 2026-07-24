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


@dataclass(frozen=True, slots=True)
class ExercisePageSegment:
    page: int
    top: float
    bottom: float


def _task_resource_ids(connection: Connection, task_id: str) -> tuple[str, list[str]]:
    task = (
        connection.execute(
            text(
                """
            SELECT title
            FROM tasks
            WHERE id = :task_id AND deleted_at IS NULL
            """
            ),
            {"task_id": task_id},
        )
        .mappings()
        .first()
    )
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


def _exercise_page_segments(
    location: ExerciseLocation,
    next_location: ExerciseLocation | None,
    *,
    page_heights: list[float],
) -> list[ExercisePageSegment]:
    """Return the complete printed interval owned by an exercise.

    Drawboard page numbers and ``ExerciseLocation.page`` are one-based.  An
    exercise owns everything from its heading to the next printed Exercise
    heading, including continuation pages.
    """

    final_page = next_location.page if next_location is not None else len(page_heights)
    segments: list[ExercisePageSegment] = []
    for page_number in range(location.page, final_page + 1):
        top = location.rect[1] if page_number == location.page else 0.0
        bottom = page_heights[page_number - 1]
        if next_location is not None and page_number == next_location.page:
            bottom = next_location.rect[1]
        if bottom > top:
            segments.append(
                ExercisePageSegment(
                    page=page_number,
                    top=top,
                    bottom=bottom,
                )
            )
    return segments


def _segment_inks(
    inks: list[DrawboardInk],
    segment: ExercisePageSegment,
    *,
    page_height: float,
) -> list[DrawboardInk]:
    return [
        item
        for item in inks
        if item.page == segment.page
        and _intersects_vertical(
            _ink_pdf_rect(item, page_height),
            segment.top,
            segment.bottom,
        )
    ]


def _overlapping_ink_groups(
    inks: list[DrawboardInk],
    *,
    page_height: float,
    tolerance: float = 12.0,
) -> list[list[DrawboardInk]]:
    """Group marks that share a vertical band, as handwritten answers do."""

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


def _group_vertical_bounds(
    group: list[DrawboardInk],
    *,
    page_height: float,
) -> tuple[float, float]:
    rects = [_ink_pdf_rect(item, page_height) for item in group]
    return (
        min(rect[1] for rect in rects),
        max(rect[3] for rect in rects),
    )


def _solution_group_at_band(
    inks: list[DrawboardInk],
    *,
    page_height: float,
    band_top: float,
    band_bottom: float,
    tolerance: float = 14.0,
) -> list[DrawboardInk]:
    groups = _overlapping_ink_groups(
        inks,
        page_height=page_height,
    )
    touching = [
        group
        for group in groups
        if (
            _group_vertical_bounds(group, page_height=page_height)[0] <= band_bottom + tolerance
            and _group_vertical_bounds(group, page_height=page_height)[1] >= band_top - tolerance
        )
    ]
    if not touching:
        return []
    return max(
        touching,
        key=lambda group: (
            _group_vertical_bounds(group, page_height=page_height)[1]
            - _group_vertical_bounds(group, page_height=page_height)[0],
            len(group),
        ),
    )


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
        source_revision=":".join(sorted(item.source_revision for item in member_inks)),
        page=page,
        color="red",
        rgb=[1.0, 0.1, 0.2],
        created_at=min(item.created_at for item in member_inks),
        rect=[0.0, page_height - bottom, 1.0, page_height - top],
        ink_vertex_sets=(),
        member_fingerprints=tuple(
            fingerprint for item in member_inks for fingerprint in item.member_fingerprints
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
        page_heights = [float(document[index].rect.height) for index in range(document.page_count)]
        for exercise in requested:
            location = location_by_number.get(exercise)
            if location is None:
                warnings.append(f"Exercise {exercise}: header was not found in the PDF.")
                continue
            location_index = locations.index(location)
            next_location = (
                locations[location_index + 1] if location_index + 1 < len(locations) else None
            )
            segments = _exercise_page_segments(
                location,
                next_location,
                page_heights=page_heights,
            )
            first_segment = segments[0]
            first_page_height = page_heights[first_segment.page - 1]
            first_page_ink = _solution_group_at_band(
                _segment_inks(
                    all_ink,
                    first_segment,
                    page_height=first_page_height,
                ),
                page_height=first_page_height,
                band_top=location.rect[1],
                band_bottom=location.rect[3],
            )
            if not first_page_ink:
                warnings.append(f"Exercise {exercise}: no handwriting mark touches its heading.")
                continue

            selected_segments: list[tuple[ExercisePageSegment, list[DrawboardInk]]] = [
                (first_segment, first_page_ink)
            ]
            current_group = first_page_ink
            for segment in segments[1:]:
                previous_segment = selected_segments[-1][0]
                previous_height = page_heights[previous_segment.page - 1]
                _previous_top, previous_bottom = _group_vertical_bounds(
                    current_group,
                    page_height=previous_height,
                )
                if (
                    previous_segment.bottom < previous_height - 0.5
                    or previous_bottom < previous_height - 14.0
                ):
                    break
                page_height = page_heights[segment.page - 1]
                continuation = _solution_group_at_band(
                    _segment_inks(
                        all_ink,
                        segment,
                        page_height=page_height,
                    ),
                    page_height=page_height,
                    band_top=0.0,
                    band_bottom=14.0,
                )
                if not continuation:
                    break
                selected_segments.append((segment, continuation))
                current_group = continuation

            for segment, page_ink in selected_segments:
                page_height = page_heights[segment.page - 1]
                ink_top, ink_bottom = _group_vertical_bounds(
                    page_ink,
                    page_height=page_height,
                )
                crop_top = min(segment.top, ink_top) if segment.page == location.page else ink_top
                hard_bottom = (
                    segment.bottom - 6.0 if segment.bottom < page_height - 0.5 else segment.bottom
                )
                crop_bottom = min(hard_bottom, ink_bottom + 18.0)
                crop = _synthetic_crop_ink(
                    task_id=task_id,
                    exercise=exercise,
                    page=segment.page,
                    page_height=page_height,
                    top=max(0.0, crop_top),
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
                        margin=6.0,
                        scale=4.0,
                    )
                except PdfInkImageError as error:
                    warnings.append(f"Exercise {exercise}, page {segment.page}: {error}")
                    continue
                rendered_paths.append(
                    (
                        exercise,
                        segment.page,
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
