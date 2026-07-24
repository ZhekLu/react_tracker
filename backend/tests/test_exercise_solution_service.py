from __future__ import annotations

from tracker_api.services.drawboard_service import DrawboardInk
from tracker_api.services.exercise_solution_service import (
    ExerciseLocation,
    ExercisePageSegment,
    _exercise_page_segments,
    _segment_inks,
    _solution_group_at_band,
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


def test_exercise_segments_span_continuation_pages_until_next_heading() -> None:
    segments = _exercise_page_segments(
        ExerciseLocation("5.10", 131, (72.0, 590.0, 140.0, 606.0)),
        ExerciseLocation("5.11", 133, (72.0, 423.0, 140.0, 439.0)),
        page_heights=[700.0] * 140,
    )

    assert segments == [
        ExercisePageSegment(page=131, top=590.0, bottom=700.0),
        ExercisePageSegment(page=132, top=0.0, bottom=700.0),
        ExercisePageSegment(page=133, top=0.0, bottom=423.0),
    ]


def test_segment_inks_keeps_every_intersecting_mark_on_page() -> None:
    def ink(fingerprint: str, page: int, bottom_up_y: float) -> DrawboardInk:
        return DrawboardInk(
            fingerprint=fingerprint,
            source_revision=fingerprint,
            page=page,
            color="red",
            rgb=[1.0, 0.0, 0.0],
            created_at="2026-01-01T00:00:00Z",
            rect=[0.1, bottom_up_y, 0.9, bottom_up_y + 20.0],
            ink_vertex_sets=(),
            member_fingerprints=(fingerprint,),
        )

    # Drawboard rectangles use bottom-up coordinates.  On a 700pt page these
    # marks render at y=80..100, y=240..260, and y=580..600 respectively.
    inks = [
        ink("first", 132, 600.0),
        ink("second", 132, 440.0),
        ink("outside", 132, 100.0),
        ink("other-page", 131, 600.0),
    ]

    selected = _segment_inks(
        inks,
        ExercisePageSegment(page=132, top=50.0, bottom=300.0),
        page_height=700.0,
    )

    assert [item.fingerprint for item in selected] == ["first", "second"]


def test_solution_group_follows_connected_handwriting_touching_heading() -> None:
    def ink(
        fingerprint: str,
        bottom_up_top: float,
        bottom_up_bottom: float,
    ) -> DrawboardInk:
        return DrawboardInk(
            fingerprint=fingerprint,
            source_revision=fingerprint,
            page=1,
            color="red",
            rgb=[1.0, 0.0, 0.0],
            created_at="2026-01-01T00:00:00Z",
            rect=[0.1, bottom_up_top, 0.9, bottom_up_bottom],
            ink_vertex_sets=(),
            member_fingerprints=(fingerprint,),
        )

    selected = _solution_group_at_band(
        [
            # PDF y=120..145 and y=150..180: one connected answer band.
            ink("answer-a", 555.0, 580.0),
            ink("answer-b", 520.0, 550.0),
            # A later reading note must not be pulled into the exercise.
            ink("later-note", 100.0, 180.0),
        ],
        page_height=700.0,
        band_top=100.0,
        band_bottom=125.0,
    )

    assert [item.fingerprint for item in selected] == ["answer-a", "answer-b"]
