from tracker_api.services.chapter_scope_service import (
    annotation_chapter_number,
    referenced_chapter_numbers,
)


def test_task_section_references_collapse_to_chapter_scope() -> None:
    assert referenced_chapter_numbers("Read Sections 4.1-4.3") == [4]
    assert referenced_chapter_numbers(
        "Read Sections 3.1-3.6 and 4.1-4.4"
    ) == [3, 4]
    assert referenced_chapter_numbers(
        "Read Sections 5.1-5.5 and 6.1-6.7"
    ) == [5, 6]


def test_explicit_chapter_ranges_are_supported_but_slide_ranges_are_ignored() -> None:
    assert referenced_chapter_numbers("Review Chapters 7-9") == [7, 8, 9]
    assert referenced_chapter_numbers("Review slides 14-19") == []


def test_annotation_chapter_number_uses_structured_metadata_then_labels() -> None:
    assert annotation_chapter_number(chapter_number=4) == 4
    assert annotation_chapter_number(chapter_number="5") == 5
    assert annotation_chapter_number(chapter_title="Chapter 6 · Planning") == 6
    assert annotation_chapter_number(chapter_label="Chapter 6") == 6
    assert annotation_chapter_number(subchapter_title="7.2 · Eligibility traces") == 7
    assert annotation_chapter_number(section_title="8.3 Off-policy methods") == 8
    assert annotation_chapter_number(chapter_title="Appendix") is None
