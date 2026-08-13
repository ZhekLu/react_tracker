from __future__ import annotations

import re
import shutil
from dataclasses import dataclass
from functools import lru_cache
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
    available_exercises: list[str]
    exercises: list[str]
    screenshots: list[ExerciseScreenshot]
    warnings: list[str]


@dataclass(frozen=True, slots=True)
class ExerciseStatementImage:
    content: bytes
    exercise: str
    page: int


@dataclass(frozen=True, slots=True)
class ExerciseLocation:
    number: str
    page: int
    rect: tuple[float, float, float, float]


@dataclass(frozen=True, slots=True)
class ExerciseNotationGroup:
    page: int
    top: float
    bottom: float
    exercises: tuple[str, ...]
    inks: tuple[DrawboardInk, ...]


@dataclass(frozen=True, slots=True)
class ExerciseCapturePlan:
    exercises: tuple[str, ...]
    groups: tuple[ExerciseNotationGroup, ...]


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


def exercise_chapters(task_title: str) -> list[str]:
    return list(
        dict.fromkeys(number.partition(".")[0] for number in exercise_numbers(task_title))
    )


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


@lru_cache(maxsize=16)
def _cached_exercise_locations(
    source_path: str,
    modified_ns: int,
) -> tuple[ExerciseLocation, ...]:
    """Scan a book once per server process and PDF revision.

    Exercise QA asks for many statements from the same chapter in quick
    succession.  Searching every page again for every arrow press made that
    workflow needlessly slow; the file mtime keeps this cache safe when the
    annotated cloud copy is refreshed.
    """

    del modified_ns
    try:
        document: Any = pymupdf.open(source_path)  # type: ignore[no-untyped-call]
    except Exception as error:
        raise ExerciseSolutionError(f"Could not read {source_path}.") from error
    try:
        return tuple(_exercise_locations(document))
    finally:
        document.close()


def render_exercise_statement(
    connection: Connection,
    task_id: str,
    exercise: str,
) -> ExerciseStatementImage:
    """Render the full-width exercise statement when no annotation crop exists."""

    task_title, resource_ids = _task_resource_ids(connection, task_id)
    chapter = exercise.partition(".")[0]
    if chapter not in exercise_chapters(task_title):
        raise ExerciseSolutionError(
            f"Exercise {exercise} is outside this task's book chapter."
        )
    source_path: Path | None = None
    for resource_id in resource_ids:
        local_path, _ = workspace_repository.resource_open_target(
            connection,
            resource_id,
        )
        if not local_path:
            continue
        try:
            candidate = safe_local_resource_path(local_path)
        except ResourceOpenError:
            continue
        if candidate.suffix.casefold() == ".pdf":
            source_path = candidate
            break
    if source_path is None:
        raise ExerciseSolutionError("No linked local PDF can locate this exercise.")

    locations = _cached_exercise_locations(
        str(source_path),
        source_path.stat().st_mtime_ns,
    )
    location = next((item for item in locations if item.number == exercise), None)
    if location is None:
        raise ExerciseSolutionError(f"Exercise {exercise} was not found in the PDF.")
    try:
        document: Any = pymupdf.open(source_path)  # type: ignore[no-untyped-call]
    except Exception as error:
        raise ExerciseSolutionError(f"Could not read {source_path}.") from error
    try:
        page = document[location.page - 1]
        following = next(
            (
                item
                for item in locations
                if item.page == location.page and item.rect[1] > location.rect[1]
            ),
            None,
        )
        top = max(0.0, location.rect[1] - 18.0)
        bottom = min(
            float(page.rect.height),
            (following.rect[1] - 12.0) if following else (location.rect[3] + 260.0),
        )
        if bottom <= top + 48.0:
            bottom = min(float(page.rect.height), top + 260.0)
        clip = pymupdf.Rect(0.0, top, float(page.rect.width), bottom)
        pixmap = page.get_pixmap(matrix=pymupdf.Matrix(3.0, 3.0), clip=clip, alpha=False)
        return ExerciseStatementImage(
            content=pixmap.tobytes("png"),
            exercise=exercise,
            page=location.page,
        )
    finally:
        document.close()


def _ink_pdf_rect(ink: DrawboardInk, page_height: float) -> list[float]:
    return drawboard_rect_to_pdf(ink.rect, page_height)


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


def _exercise_numbers_in_group(
    locations: list[ExerciseLocation],
    *,
    page: int,
    top: float,
    bottom: float,
    tolerance: float = 14.0,
) -> tuple[str, ...]:
    return tuple(
        location.number
        for location in locations
        if location.page == page
        and location.rect[1] <= bottom + tolerance
        and location.rect[3] >= top - tolerance
    )


def _notation_groups_on_page(
    inks: list[DrawboardInk],
    locations: list[ExerciseLocation],
    *,
    page: int,
    page_height: float,
) -> list[ExerciseNotationGroup]:
    result: list[ExerciseNotationGroup] = []
    page_inks = [item for item in inks if item.page == page]
    for group in _overlapping_ink_groups(page_inks, page_height=page_height):
        top, bottom = _group_vertical_bounds(group, page_height=page_height)
        result.append(
            ExerciseNotationGroup(
                page=page,
                top=top,
                bottom=bottom,
                exercises=_exercise_numbers_in_group(
                    locations,
                    page=page,
                    top=top,
                    bottom=bottom,
                ),
                inks=tuple(group),
            )
        )
    return sorted(result, key=lambda item: item.top)


def _merge_groups_sharing_exercises(
    groups: list[ExerciseNotationGroup],
    *,
    exercise_order: dict[str, int],
) -> list[ExerciseNotationGroup]:
    """Merge separated marks that belong to the same printed exercise band."""

    remaining = [group for group in groups if group.exercises]
    merged: list[ExerciseNotationGroup] = []
    while remaining:
        seed = remaining.pop(0)
        exercises = set(seed.exercises)
        inks = list(seed.inks)
        top = seed.top
        bottom = seed.bottom
        changed = True
        while changed:
            changed = False
            pending: list[ExerciseNotationGroup] = []
            for candidate in remaining:
                if exercises.intersection(candidate.exercises):
                    exercises.update(candidate.exercises)
                    inks.extend(candidate.inks)
                    top = min(top, candidate.top)
                    bottom = max(bottom, candidate.bottom)
                    changed = True
                else:
                    pending.append(candidate)
            remaining = pending
        merged.append(
            ExerciseNotationGroup(
                page=seed.page,
                top=top,
                bottom=bottom,
                exercises=tuple(
                    sorted(exercises, key=lambda item: exercise_order[item])
                ),
                inks=tuple(inks),
            )
        )
    return sorted(merged, key=lambda item: item.top)


def _ink_group_key(group: ExerciseNotationGroup) -> frozenset[str]:
    return frozenset(item.fingerprint for item in group.inks)


def _plan_exercise_captures(
    inks: list[DrawboardInk],
    locations: list[ExerciseLocation],
    *,
    page_heights: list[float],
) -> list[ExerciseCapturePlan]:
    """Plan one capture per notation group, then label exercises inside it."""

    exercise_order = {
        location.number: index for index, location in enumerate(locations)
    }
    raw_by_page = {
        page: _notation_groups_on_page(
            inks,
            locations,
            page=page,
            page_height=page_heights[page - 1],
        )
        for page in range(1, len(page_heights) + 1)
    }
    exercise_groups_by_page = {
        page: _merge_groups_sharing_exercises(
            groups,
            exercise_order=exercise_order,
        )
        for page, groups in raw_by_page.items()
    }
    candidates = sorted(
        (
            group
            for groups in exercise_groups_by_page.values()
            for group in groups
        ),
        key=lambda item: (item.page, item.top),
    )
    consumed_inks: set[str] = set()
    covered_exercises: set[str] = set()
    plans: list[ExerciseCapturePlan] = []

    for candidate in candidates:
        candidate_key = _ink_group_key(candidate)
        if candidate_key.intersection(consumed_inks):
            continue
        if set(candidate.exercises).issubset(covered_exercises):
            continue

        selected = [candidate]
        consumed_inks.update(candidate_key)
        current = candidate
        while (
            current.bottom >= page_heights[current.page - 1] - 14.0
            and current.page < len(page_heights)
        ):
            next_page = current.page + 1
            top_groups = [
                group
                for group in raw_by_page[next_page]
                if group.top <= 14.0
                and not _ink_group_key(group).intersection(consumed_inks)
            ]
            if not top_groups:
                break
            continuation = max(
                top_groups,
                key=lambda item: (item.bottom - item.top, len(item.inks)),
            )
            merged_continuation = next(
                (
                    group
                    for group in exercise_groups_by_page[next_page]
                    if _ink_group_key(group).intersection(
                        _ink_group_key(continuation)
                    )
                ),
                continuation,
            )
            selected.append(merged_continuation)
            consumed_inks.update(_ink_group_key(merged_continuation))
            current = merged_continuation

        exercises = tuple(
            sorted(
                {
                    exercise
                    for group in selected
                    for exercise in group.exercises
                },
                key=lambda item: exercise_order[item],
            )
        )
        if not exercises:
            continue
        covered_exercises.update(exercises)
        plans.append(
            ExerciseCapturePlan(
                exercises=exercises,
                groups=tuple(selected),
            )
        )
    return plans


def _exercise_group_label(exercises: tuple[str, ...]) -> str:
    return f" {chr(0x2013)} ".join(exercises)


def _exercise_group_slug(exercises: tuple[str, ...]) -> str:
    return "-to-".join(item.replace(".", "-") for item in exercises)


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
    safe_exercise = re.sub(r"[^A-Za-z0-9-]+", "-", exercise).strip("-")
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
    """Render every handwritten exercise solution in the task's book chapter."""

    task_title, resource_ids = _task_resource_ids(connection, task_id)
    requested_chapters = exercise_chapters(task_title)
    if not requested_chapters:
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
    rendered_paths: list[tuple[tuple[str, ...], int, Path]] = []
    detected_exercises: list[str] = []
    available_exercises: list[str] = []
    try:
        locations = _exercise_locations(document)
        chapter_locations = [
            location
            for location in locations
            if location.number.partition(".")[0] in requested_chapters
        ]
        if not chapter_locations:
            chapter_labels = ", ".join(requested_chapters)
            raise ExerciseSolutionError(
                f"No exercise headings were found for chapter {chapter_labels}."
            )
        available_exercises = list(
            dict.fromkeys(location.number for location in chapter_locations)
        )
        all_ink = list(extraction.all_ink)
        page_heights = [float(document[index].rect.height) for index in range(document.page_count)]
        plans = _plan_exercise_captures(
            all_ink,
            chapter_locations,
            page_heights=page_heights,
        )
        for plan in plans:
            detected_exercises.extend(plan.exercises)
            exercise_label = _exercise_group_label(plan.exercises)
            for group in plan.groups:
                page_height = page_heights[group.page - 1]
                group_locations = [
                    location
                    for location in chapter_locations
                    if location.page == group.page
                    and location.number in group.exercises
                ]
                crop_top = min(
                    group.top,
                    *[location.rect[1] for location in group_locations],
                )
                crop_bottom = min(
                    page_height,
                    max(
                        group.bottom,
                        *[location.rect[3] for location in group_locations],
                    )
                    + 18.0,
                )
                crop = _synthetic_crop_ink(
                    task_id=task_id,
                    exercise=exercise_label,
                    page=group.page,
                    page_height=page_height,
                    top=max(0.0, crop_top),
                    bottom=crop_bottom,
                    member_inks=list(group.inks),
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
                    warnings.append(
                        f"Exercises {exercise_label}, page {group.page}: {error}"
                    )
                    continue
                rendered_paths.append(
                    (
                        plan.exercises,
                        group.page,
                        annotation_image_path(
                            extraction.document_id,
                            crop.fingerprint,
                        ),
                    )
                )
    finally:
        document.close()

    if not rendered_paths:
        chapter_labels = ", ".join(requested_chapters)
        warnings.append(
            "No handwriting connected to an exercise heading was found in "
            f"chapter {chapter_labels}."
        )

    destination = get_settings().chatgpt_attachment_dir.expanduser().resolve()
    with ATTACHMENT_LOCK:
        destination.mkdir(parents=True, exist_ok=True)
        for child in destination.iterdir():
            if child.is_dir() and not child.is_symlink():
                shutil.rmtree(child)
            else:
                child.unlink()
        for exercises, page_number, source in rendered_paths:
            exercise_label = _exercise_group_label(exercises)
            name = (
                f"exercise-{_exercise_group_slug(exercises)}"
                f"-p{page_number}.png"
            )
            target = destination / name
            shutil.copy2(source, target)
            screenshots.append(
                ExerciseScreenshot(
                    exercise=exercise_label,
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
            f"Chapter: {', '.join(requested_chapters)}",
            "",
            *[
                f"- `{item.name}` — Exercises {item.exercise}, PDF page {item.page}"
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
        available_exercises=available_exercises,
        exercises=list(dict.fromkeys(detected_exercises)),
        screenshots=screenshots,
        warnings=warnings,
    )
