from __future__ import annotations

from pathlib import Path

import pymupdf

from tracker_api.services.drawboard_service import DrawboardInk
from tracker_api.services import exercise_solution_service
from tracker_api.services.exercise_solution_service import (
    ExerciseLocation,
    StoredExerciseImage,
    _stored_exercise_image,
    _plan_exercise_captures,
    chapter_exercises_for_task,
    exercise_chapters,
    exercise_numbers,
)


def test_exercise_numbers_follow_task_order_and_remove_duplicates() -> None:
    assert exercise_numbers("Solve Exercises 5.3, 5.5, 5.6, and 5.10; revisit 5.5") == [
        "5.3",
        "5.5",
        "5.6",
        "5.10",
    ]


def test_non_exercise_decimal_numbers_are_not_treated_as_exercises() -> None:
    assert exercise_numbers("Read Sections 5.1-5.4") == []


def test_exercise_chapters_expand_task_numbers_to_unique_book_chapters() -> None:
    assert exercise_chapters(
        "Solve Exercises 5.3, 5.5, 5.10, and optional Exercise 6.2"
    ) == ["5", "6"]


def test_chapter_exercise_index_includes_unannotated_pdf_exercises(
    monkeypatch,
    tmp_path: Path,
) -> None:
    source = tmp_path / "book.pdf"
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 90), "Exercise 6.1 First exercise")
    page.insert_text((72, 150), "Exercise 6.2 Second exercise")
    page.insert_text((72, 210), "Exercise 7.1 Different chapter")
    document.save(source)
    document.close()

    monkeypatch.setattr(
        exercise_solution_service,
        "_task_resource_ids",
        lambda connection, task_id: ("Solve Exercises 6.1 and 6.2", ["book"]),
    )
    monkeypatch.setattr(
        exercise_solution_service.workspace_repository,
        "resource_open_target",
        lambda connection, resource_id: (str(source), None),
    )
    monkeypatch.setattr(
        exercise_solution_service,
        "safe_local_resource_path",
        lambda local_path: Path(local_path),
    )

    assert chapter_exercises_for_task(object(), "task") == ["6.1", "6.2"]


def _ink(
    fingerprint: str,
    *,
    page: int,
    pdf_top: float,
    pdf_bottom: float,
    page_height: float = 700.0,
) -> DrawboardInk:
    return DrawboardInk(
        fingerprint=fingerprint,
        source_revision=fingerprint,
        page=page,
        color="red",
        rgb=[1.0, 0.0, 0.0],
        created_at="2026-01-01T00:00:00Z",
        rect=[0.1, page_height - pdf_bottom, 0.9, page_height - pdf_top],
        ink_vertex_sets=(),
        member_fingerprints=(fingerprint,),
    )


def test_notation_group_labels_every_exercise_inside_one_vertical_mark() -> None:
    locations = [
        ExerciseLocation("5.6", 1, (72.0, 100.0, 140.0, 116.0)),
        ExerciseLocation("5.7", 1, (72.0, 210.0, 140.0, 226.0)),
        ExerciseLocation("5.8", 1, (72.0, 330.0, 140.0, 346.0)),
    ]
    plans = _plan_exercise_captures(
        [
            _ink("margin-line", page=1, pdf_top=88.0, pdf_bottom=410.0),
            _ink("answer-5.6", page=1, pdf_top=118.0, pdf_bottom=146.0),
            _ink("answer-5.8", page=1, pdf_top=352.0, pdf_bottom=395.0),
        ],
        locations,
        page_heights=[700.0],
    )

    assert len(plans) == 1
    assert plans[0].exercises == ("5.6", "5.7", "5.8")
    assert plans[0].groups[0].top == 88.0
    assert plans[0].groups[0].bottom == 410.0


def test_separate_notation_groups_do_not_duplicate_exercise_screenshots() -> None:
    locations = [
        ExerciseLocation("5.1", 1, (72.0, 100.0, 140.0, 116.0)),
        ExerciseLocation("5.2", 1, (72.0, 210.0, 140.0, 226.0)),
        ExerciseLocation("5.6", 1, (72.0, 430.0, 140.0, 446.0)),
    ]
    plans = _plan_exercise_captures(
        [
            _ink("group-one", page=1, pdf_top=88.0, pdf_bottom=260.0),
            _ink("group-one-answer", page=1, pdf_top=225.0, pdf_bottom=250.0),
            _ink("group-two", page=1, pdf_top=418.0, pdf_bottom=500.0),
        ],
        locations,
        page_heights=[700.0],
    )

    assert [plan.exercises for plan in plans] == [("5.1", "5.2"), ("5.6",)]


def test_notation_group_continues_only_when_ink_reaches_next_page_top() -> None:
    locations = [
        ExerciseLocation("5.10", 1, (72.0, 590.0, 140.0, 606.0)),
    ]
    plans = _plan_exercise_captures(
        [
            _ink("page-one-line", page=1, pdf_top=580.0, pdf_bottom=700.0),
            _ink("page-two-line", page=2, pdf_top=0.0, pdf_bottom=160.0),
        ],
        locations,
        page_heights=[700.0, 700.0],
    )

    assert len(plans) == 1
    assert plans[0].exercises == ("5.10",)
    assert [group.page for group in plans[0].groups] == [1, 2]


def test_exercise_source_uses_group_geometry_not_equation_references() -> None:
    location = ExerciseLocation("6.6", 148, (42.0, 241.0, 95.0, 252.0))
    selected = _stored_exercise_image(
        [
            StoredExerciseImage(
                "unrelated-equation-reference",
                20,
                648.0,
                (40.0, 360.0, 450.0, 420.0),
            ),
            StoredExerciseImage(
                "exercise-6-3-through-6-6-group",
                392,
                648.0,
                (35.0, 351.0, 493.0, 581.0),
            ),
        ],
        location,
    )

    assert selected is not None
    assert selected.image_id == "exercise-6-3-through-6-6-group"
