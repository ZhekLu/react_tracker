from __future__ import annotations

from tracker_api.services.exercise_solution_service import exercise_numbers


def test_exercise_numbers_follow_task_order_and_remove_duplicates() -> None:
    assert exercise_numbers(
        "Solve Exercises 5.3, 5.5, 5.6, and 5.10; revisit 5.5"
    ) == ["5.3", "5.5", "5.6", "5.10"]


def test_non_exercise_decimal_numbers_are_not_treated_as_exercises() -> None:
    assert exercise_numbers("Read Sections 5.1-5.4") == []
