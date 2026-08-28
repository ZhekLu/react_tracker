from __future__ import annotations

import stat
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import text

from tracker_api.config import get_settings
from tracker_api.database import get_engine, transaction
from tracker_api.services import drawboard_service, pdf_annotation_service
from tracker_api.services.drawboard_service import (
    DrawboardCapture,
    DrawboardExtraction,
    DrawboardInk,
    _annotation_color,
    _annotation_rects,
    drawboard_deep_link,
    extract_drawboard_annotations,
    is_drawboard_cloud_url,
)
from tracker_api.services.pdf_annotation_service import (
    _chapter_study_days,
    _merge_ink_groups_by_paragraph,
    collect_resource_pdf_annotations,
)
from tracker_api.services.pdf_context_service import PdfAnnotationContext
from tracker_api.services.resource_open_service import open_resource
from tracker_api.services.study_plan_service import sync_study_plan

SHARE_URL = (
    "https://pdf.drawboard.com/documents/links/"
    "8759d0a6458b42499fc13babc9e3f81d/consume"
)
DOCUMENT_ID = "9a15ffc69d824f14a52dff1b7ea35163"


@pytest.fixture(autouse=True)
def isolated_settings(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[None]:
    helper_config = tmp_path / "toggl_config.json"
    helper_config.write_text(
        f'{{"open_allowed_roots": ["{tmp_path}"]}}',
        encoding="utf-8",
    )
    monkeypatch.setenv("TRACKER_DATABASE_PATH", str(tmp_path / "tracker.db"))
    monkeypatch.setenv("TRACKER_HELPER_CONFIG_PATH", str(helper_config))
    monkeypatch.setenv(
        "TRACKER_DRAWBOARD_STATE_PATH",
        str(tmp_path / "drawboard_state.json"),
    )
    monkeypatch.setenv(
        "TRACKER_ANNOTATION_IMAGE_DIR",
        str(tmp_path / "annotation-images"),
    )
    get_settings.cache_clear()
    get_engine.cache_clear()
    yield
    if get_engine.cache_info().currsize:
        get_engine().dispose()
    get_engine.cache_clear()
    get_settings.cache_clear()


def test_drawboard_url_and_native_deep_link() -> None:
    assert is_drawboard_cloud_url(SHARE_URL)
    assert (
        drawboard_deep_link(DOCUMENT_ID)
        == f"com.drawboard.drawboardpdf://open/documents/{DOCUMENT_ID}"
    )
    assert not is_drawboard_cloud_url("https://example.com/book.pdf")


def test_drawboard_dark_red_pen_is_still_a_question_color() -> None:
    color, rgb = _annotation_color({"fillColor": "D9AF0001"})

    assert color == "red"
    assert rgb == pytest.approx([175 / 255, 0, 1 / 255])


def test_drawboard_grey_pen_is_not_a_question_color() -> None:
    color, _rgb = _annotation_color({"fillColor": "D9575761"})

    assert color == "custom"


def test_multiline_drawboard_highlight_preserves_each_quad() -> None:
    rects = _annotation_rects(
        {
            "vertices": [
                424.73,
                184.06,
                381.23,
                184.06,
                381.23,
                193.13,
                424.73,
                193.13,
                111.74,
                172.11,
                43.46,
                172.11,
                43.46,
                181.17,
                111.74,
                181.17,
            ]
        }
    )

    assert rects == (
        (381.23, 184.06, 424.73, 193.13),
        (43.46, 172.11, 111.74, 181.17),
    )


def test_cloud_extraction_pages_batches_and_reuses_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    consume_count = 0

    def fake_request(
        url: str,
        *,
        method: str = "GET",
        payload: dict[str, Any] | None = None,
        access_token: str | None = None,
    ) -> dict[str, Any]:
        nonlocal consume_count
        if "/documents/links/" in url:
            consume_count += 1
            assert method == "POST"
            return {
                "documentId": DOCUMENT_ID,
                "secret": "anonymous-secret",
                "userId": "anonymous-user",
            }
        if url.endswith("/token/anonymous"):
            assert method == "POST"
            return {"accessToken": "access-token"}
        if url.endswith(f"/documents/{DOCUMENT_ID}"):
            assert access_token == "access-token"
            return {
                "document": {
                    "pages": {
                        "page-b": {"index": 1, "resourcePageNo": 12},
                        "page-a": {"index": 0, "resourcePageNo": 11},
                    }
                }
            }
        if url.endswith("/data/annotations/fetch-batch"):
            assert access_token == "access-token"
            if payload == {}:
                return {
                    "annotations": [
                        {
                            "id": "root-highlight",
                            "revision": 2,
                            "annotation": {
                                "annotationId": "highlight-1",
                                "content": "What advantages?",
                                "created": "2026-07-01T10:00:00Z",
                                "fillColor": "80FFE557",
                                "pageId": "page-b",
                                "type": "TextHighlight",
                                "vertices": [10, 20, 30, 20, 30, 25, 10, 25],
                            },
                        },
                        {
                            "id": "root-insert",
                            "revision": 4,
                            "annotation": {
                                "annotationId": "insert-1",
                                "content": "Why?",
                                "pageId": "page-a",
                                "strokeColor": "FFFF0000",
                                "type": "TextInsert",
                                "vertices": [4, 8, 5, 9],
                            },
                        },
                        {
                            "id": "root-ink",
                            "revision": 1,
                            "annotation": {
                                "annotationId": "ink-1",
                                "pageId": "page-a",
                                "type": "Ink",
                                "vertices": [1, 2, 3, 4],
                            },
                        },
                    ],
                    "resumeOnPageId": "page-b",
                }
            assert payload == {"resumeOnPageId": "page-b"}
            return {
                "annotations": [
                    {
                        "id": "root-underline",
                        "revision": 3,
                        "annotation": {
                            "annotationId": "underline-1",
                            "content": "Coverage assumption",
                            "pageId": "page-b",
                            "strokeColor": "FF00FFFF",
                            "type": "TextUnderline",
                            "vertices": [2, 7, 9, 7],
                        },
                    },
                    {
                        "id": "root-rectangle",
                        "revision": 1,
                        "annotation": {
                            "annotationId": "rectangle-1",
                            "pageId": "page-b",
                            "type": "Rectangle",
                        },
                    },
                ],
                "resumeOnPageId": None,
            }
        raise AssertionError(f"Unexpected Drawboard request: {method} {url}")

    monkeypatch.setattr(drawboard_service, "_request_json", fake_request)
    first = extract_drawboard_annotations(SHARE_URL)
    second = extract_drawboard_annotations(SHARE_URL)

    assert consume_count == 1
    assert [capture.page for capture in first.captures] == [11, 12, 12]
    assert first.captures[0].comment == "Why?"
    assert first.captures[0].is_question is True
    colors = {
        capture.annotation_kind: capture.color
        for capture in first.captures
    }
    assert colors["TextHighlight"] == "yellow"
    assert colors["TextUnderline"] == "cyan"
    highlight = next(
        capture
        for capture in first.captures
        if capture.annotation_kind == "TextHighlight"
    )
    assert highlight.opacity == pytest.approx(128 / 255)
    assert highlight.is_question is False
    assert first.ignored == {"Ink": 1, "Rectangle": 1}
    assert second.captures == first.captures
    state_path = get_settings().drawboard_state_path
    assert stat.S_IMODE(state_path.stat().st_mode) == 0o600


def _seed_cloud_resource(tmp_path: Path) -> str:
    pdf_path = tmp_path / "book.pdf"
    pdf_path.write_bytes(b"%PDF-1.4")
    plan_path = tmp_path / "plan.md"
    plan_path.write_text(
        f"""
+++
format = "study-plan/v1"
id = "drawboard_collection"
title = "Drawboard Collection"
mode = "full"

[resources.book]
title = "RL Book"
path = "{pdf_path}"
url = "{SHARE_URL}"
kind = "book"
+++

# Drawboard Collection

### Day 1: 2026-07-01 - Read {{#day-01}}

#### Reading

- [ ] Read the book. {{#read-book resources=book}}

Stop when: the chapter is read. {{#day01-stop}}
""".lstrip(),
        encoding="utf-8",
    )
    sync_study_plan(plan_path)
    with transaction() as connection:
        resource_id = connection.execute(
            text(
                """
                SELECT entity_id
                FROM source_bindings
                WHERE entity_type = 'resource'
                  AND source_key = 'drawboard_collection:book'
                """
            )
        ).scalar_one()
    return str(resource_id)


def _cloud_extraction(
    content: str,
    revision: str,
    *,
    page: int = 11,
) -> DrawboardExtraction:
    return DrawboardExtraction(
        source_url=SHARE_URL,
        document_id=DOCUMENT_ID,
        captures=[
            DrawboardCapture(
                fingerprint=f"drawboard-{DOCUMENT_ID}-insert-1",
                source_revision=revision,
                page=page,
                annotation_kind="TextInsert",
                color="red",
                rgb=[1.0, 0.0, 0.0],
                quote="",
                comment=content,
                is_question=True,
                created_at="2026-07-01T10:00:00Z",
                rect=[4.0, 8.0, 5.0, 9.0],
            )
        ],
        red_ink=[],
        ignored={"Ink": 2},
    )


def test_cloud_collection_is_idempotent_and_refreshes_source_edits(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resource_id = _seed_cloud_resource(tmp_path)
    current = _cloud_extraction("Why?", "1")
    monkeypatch.setattr(
        pdf_annotation_service,
        "extract_drawboard_annotations",
        lambda _source_url: current,
    )
    with transaction() as connection:
        pdf_annotation_service.save_drawboard_color_roles(
            connection,
            resource_id,
            {"#FF0000": "question"},
        )
    with transaction() as connection:
        first = collect_resource_pdf_annotations(connection, resource_id)
        first_identity = connection.execute(
            text(
                """
                SELECT a.id, qi.readable_label
                FROM annotations a
                JOIN annotation_question_identities aqi ON aqi.annotation_id = a.id
                JOIN question_identities qi ON qi.id = aqi.question_identity_id
                WHERE a.resource_id = :resource_id
                """
            ),
            {"resource_id": resource_id},
        ).mappings().one()
    with transaction() as connection:
        second = collect_resource_pdf_annotations(connection, resource_id)

    # Drawboard annotation identity is independent of the current PDF page.
    # Inserting a page before the annotation must move, not duplicate, it.
    current = _cloud_extraction("Why exactly?", "2", page=12)
    with transaction() as connection:
        third = collect_resource_pdf_annotations(connection, resource_id)
        row = connection.execute(
            text(
                """
                SELECT a.id, a.kind, a.status, d.plain_text, aa.page_number,
                       aa.selector_json, qi.readable_label
                FROM annotations a
                JOIN documents d ON d.id = a.body_document_id
                JOIN annotation_anchors aa ON aa.annotation_id = a.id
                JOIN annotation_question_identities aqi ON aqi.annotation_id = a.id
                JOIN question_identities qi ON qi.id = aqi.question_identity_id
                WHERE a.resource_id = :resource_id
                """
            ),
            {"resource_id": resource_id},
        ).mappings().one()
    current = DrawboardExtraction(
        source_url=SHARE_URL,
        document_id=DOCUMENT_ID,
        captures=[],
        red_ink=[],
        ignored={},
    )
    with transaction() as connection:
        removed = collect_resource_pdf_annotations(connection, resource_id)
        active_after_removal = connection.execute(
            text(
                """
                SELECT COUNT(*)
                FROM annotations
                WHERE resource_id = :resource_id AND deleted_at IS NULL
                """
            ),
            {"resource_id": resource_id},
        ).scalar_one()
    current = _cloud_extraction("Why exactly?", "2", page=12)
    with transaction() as connection:
        revived = collect_resource_pdf_annotations(connection, resource_id)
        active_count = connection.execute(
            text(
                """
                SELECT COUNT(*)
                FROM annotations
                WHERE resource_id = :resource_id AND deleted_at IS NULL
                """
            ),
            {"resource_id": resource_id},
        ).scalar_one()

    assert first.created_count == 1
    assert first.updated_count == 0
    assert len(first.changed_items) == 1
    assert first.changed_items[0].outcome == "created"
    assert first.changed_items[0].kind == "question"
    assert first.changed_items[0].page == 11
    assert "Why?" in first.changed_items[0].text
    assert second.existing_count == 1
    assert second.changed_items == []
    assert third.updated_count == 1
    assert [item.outcome for item in third.changed_items] == ["updated"]
    assert third.created_count == 0
    assert third.ignored_count == 2
    assert row["kind"] == "question"
    assert row["status"] == "open"
    assert row["plain_text"] == "Why exactly?"
    assert row["page_number"] == 12
    assert row["id"] == first_identity["id"]
    assert row["readable_label"] == first_identity["readable_label"]
    assert '"sourceRevision":"2"' in row["selector_json"]
    # Drawboard is a mutable source, but the tracker is the durable question
    # record. Removing or recolouring a source mark must never erase a question
    # (or its identity, status, notes, answers, and follow-ups) from the tracker.
    assert removed.removed_count == 0
    assert active_after_removal == 1
    assert revived.existing_count == 1
    assert active_count == 1


def test_missing_regular_drawboard_highlight_is_still_soft_deleted(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resource_id = _seed_cloud_resource(tmp_path)
    current = DrawboardExtraction(
        source_url=SHARE_URL,
        document_id=DOCUMENT_ID,
        captures=[
            DrawboardCapture(
                fingerprint=f"drawboard-{DOCUMENT_ID}-ordinary-highlight",
                source_revision="1",
                page=11,
                annotation_kind="TextHighlight",
                color="yellow",
                rgb=[1.0, 0.8, 0.1],
                quote="Ordinary reference highlight",
                comment="",
                is_question=False,
                created_at="2026-07-01T10:00:00Z",
                rect=[4.0, 8.0, 25.0, 12.0],
            )
        ],
        red_ink=[],
        ignored={},
    )
    monkeypatch.setattr(
        pdf_annotation_service,
        "extract_drawboard_annotations",
        lambda _source_url: current,
    )
    with transaction() as connection:
        pdf_annotation_service.save_drawboard_color_roles(
            connection,
            resource_id,
            {"#FFCC1A": "regular"},
        )
        created = collect_resource_pdf_annotations(connection, resource_id)

    current = DrawboardExtraction(
        source_url=SHARE_URL,
        document_id=DOCUMENT_ID,
        captures=[],
        red_ink=[],
        ignored={},
    )
    with transaction() as connection:
        removed = collect_resource_pdf_annotations(connection, resource_id)
        active_count = connection.execute(
            text(
                """
                SELECT COUNT(*)
                FROM annotations
                WHERE resource_id = :resource_id AND deleted_at IS NULL
                """
            ),
            {"resource_id": resource_id},
        ).scalar_one()

    assert created.created_count == 1
    assert removed.removed_count == 1
    assert active_count == 0


def test_cloud_collection_keeps_question_kind_after_color_role_changes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resource_id = _seed_cloud_resource(tmp_path)
    extraction = DrawboardExtraction(
        source_url=SHARE_URL,
        document_id=DOCUMENT_ID,
        captures=[
            DrawboardCapture(
                fingerprint=f"drawboard-{DOCUMENT_ID}-green-highlight",
                source_revision="1",
                page=11,
                annotation_kind="TextHighlight",
                color="custom",
                rgb=[0.2, 0.8, 0.3],
                quote="Can this converge?",
                comment="",
                is_question=True,
                created_at="2026-07-01T10:00:00Z",
                rect=[4.0, 8.0, 25.0, 12.0],
            )
        ],
        red_ink=[],
        ignored={},
    )
    monkeypatch.setattr(
        pdf_annotation_service,
        "extract_drawboard_annotations",
        lambda _source_url: extraction,
    )

    with transaction() as connection:
        prompted = collect_resource_pdf_annotations(connection, resource_id)
        annotation_count = connection.execute(
            text("SELECT COUNT(*) FROM annotations")
        ).scalar_one()

    assert prompted.requires_color_roles is True
    assert prompted.created_count == 0
    assert prompted.color_palette[0].key == "#33CC4C"
    assert prompted.color_palette[0].role is None
    assert annotation_count == 0

    with transaction() as connection:
        pdf_annotation_service.save_drawboard_color_roles(
            connection,
            resource_id,
            {"#33CC4C": "question"},
        )
        created = collect_resource_pdf_annotations(connection, resource_id)
        first = connection.execute(
            text(
                """
                SELECT a.kind, a.status, qi.readable_label
                FROM annotations a
                JOIN annotation_question_identities aqi
                  ON aqi.annotation_id = a.id
                JOIN question_identities qi ON qi.id = aqi.question_identity_id
                """
            )
        ).mappings().one()

    with transaction() as connection:
        pdf_annotation_service.save_drawboard_color_roles(
            connection,
            resource_id,
            {"#33CC4C": "regular"},
        )
        updated = collect_resource_pdf_annotations(connection, resource_id)
        final = connection.execute(
            text(
                """
                SELECT a.kind, a.status, qi.readable_label
                FROM annotations a
                JOIN annotation_question_identities aqi
                  ON aqi.annotation_id = a.id
                JOIN question_identities qi ON qi.id = aqi.question_identity_id
                """
            )
        ).mappings().one()

    assert created.created_count == 1
    assert first["kind"] == "question"
    assert first["status"] == "open"
    assert updated.updated_count == 1
    assert final["kind"] == "question"
    assert final["status"] == "open"
    assert final["readable_label"] == first["readable_label"]


def test_question_kind_repair_restores_brown_successor_and_group_identity(
    tmp_path: Path,
) -> None:
    resource_id = _seed_cloud_resource(tmp_path)
    predecessor_id = "deleted-question-capture"
    successor_id = "current-brown-capture"
    identity_id = "stable-question-identity"
    timestamp = "2026-08-28T10:00:00+00:00"
    context_group = "pdf-paragraph-question-history"
    with transaction() as connection:
        course_id = str(
            connection.execute(
                text("SELECT course_id FROM resources WHERE id = :id"),
                {"id": resource_id},
            ).scalar_one()
        )
        connection.execute(
            text(
                """
                UPDATE resources
                SET metadata_json = json_set(
                  COALESCE(metadata_json, '{}'), '$.plan_resource_id', 'rl-book'
                )
                WHERE id = :id
                """
            ),
            {"id": resource_id},
        )
        connection.execute(
            text(
                """
                INSERT INTO annotations (
                  id, resource_id, kind, status, priority, origin,
                  created_at, updated_at, deleted_at, revision
                ) VALUES
                  (:predecessor, :resource, 'question', 'answered', 'normal',
                   'drawboard_cloud', :now, :now, :now, 1),
                  (:successor, :resource, 'highlight', 'answered', 'normal',
                   'drawboard_cloud', :now, :now, NULL, 1)
                """
            ),
            {
                "predecessor": predecessor_id,
                "successor": successor_id,
                "resource": resource_id,
                "now": timestamp,
            },
        )
        selector = (
            '{"chapterNumber":7,"contextGroupId":"'
            + context_group
            + '","colorRoleRevision":"drawboard-color-role-v2:'
            '#B49791:regular:regular"}'
        )
        for annotation_id in (predecessor_id, successor_id):
            connection.execute(
                text(
                    """
                    INSERT INTO annotation_anchors (
                      annotation_id, anchor_type, page_number, selector_json,
                      created_at, updated_at
                    ) VALUES (
                      :annotation_id, 'pdf_text', 172, :selector_json, :now, :now
                    )
                    """
                ),
                {
                    "annotation_id": annotation_id,
                    "selector_json": selector,
                    "now": timestamp,
                },
            )
        connection.execute(
            text(
                """
                INSERT INTO question_identities (
                  id, course_id, resource_id, resource_code, scope_code,
                  ordinal, readable_label, created_at
                ) VALUES (
                  :id, :course_id, :resource_id, 'b', '07', 99,
                  'Q-b-07-099', :now
                )
                """
            ),
            {
                "id": identity_id,
                "course_id": course_id,
                "resource_id": resource_id,
                "now": timestamp,
            },
        )
        connection.execute(
            text(
                """
                INSERT INTO annotation_question_identities (
                  annotation_id, question_identity_id, created_at
                ) VALUES (:annotation_id, :identity_id, :now)
                """
            ),
            {
                "annotation_id": predecessor_id,
                "identity_id": identity_id,
                "now": timestamp,
            },
        )

    migration_path = (
        Path(__file__).parents[1]
        / "tracker_api/migrations/0021_question_kind_identity_invariant.sql"
    )
    raw_connection = get_engine().raw_connection()
    try:
        raw_connection.executescript(migration_path.read_text(encoding="utf-8"))
        raw_connection.commit()
    finally:
        raw_connection.close()

    with transaction() as connection:
        repaired = connection.execute(
            text(
                """
                SELECT a.kind, a.status, qi.readable_label
                FROM annotations a
                JOIN annotation_question_identities aqi
                  ON aqi.annotation_id = a.id
                JOIN question_identities qi ON qi.id = aqi.question_identity_id
                WHERE a.id = :id
                """
            ),
            {"id": successor_id},
        ).mappings().one()

    assert repaired["kind"] == "question"
    assert repaired["status"] == "answered"
    assert repaired["readable_label"] == "Q-b-07-099"


def test_recoloring_an_answered_question_preserves_question_history(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resource_id = _seed_cloud_resource(tmp_path)
    extraction = DrawboardExtraction(
        source_url=SHARE_URL,
        document_id=DOCUMENT_ID,
        captures=[
            DrawboardCapture(
                fingerprint=f"drawboard-{DOCUMENT_ID}-resolved-highlight",
                source_revision="1",
                page=11,
                annotation_kind="TextHighlight",
                color="custom",
                rgb=[0.6, 0.2, 0.1],
                quote="Why does this work?",
                comment="",
                is_question=True,
                created_at="2026-07-01T10:00:00Z",
                rect=[4.0, 8.0, 25.0, 12.0],
            )
        ],
        red_ink=[],
        ignored={},
    )
    monkeypatch.setattr(
        pdf_annotation_service,
        "extract_drawboard_annotations",
        lambda _source_url: extraction,
    )

    with transaction() as connection:
        pdf_annotation_service.save_drawboard_color_roles(
            connection,
            resource_id,
            {"#99331A": "question"},
        )
        collect_resource_pdf_annotations(connection, resource_id)
        connection.execute(
            text(
                """
                UPDATE annotations
                SET status = 'answered', answered_at = '2026-08-28T10:00:00+00:00'
                WHERE resource_id = :resource_id
                """
            ),
            {"resource_id": resource_id},
        )

    with transaction() as connection:
        pdf_annotation_service.save_drawboard_color_roles(
            connection,
            resource_id,
            {"#99331A": "regular"},
        )
        collect_resource_pdf_annotations(connection, resource_id)
        row = connection.execute(
            text(
                """
                SELECT kind, status
                FROM annotations
                WHERE resource_id = :resource_id
                """
            ),
            {"resource_id": resource_id},
        ).mappings().one()

    assert row["kind"] == "question"
    assert row["status"] == "answered"


def test_red_highlight_inside_handwriting_group_is_not_a_second_question(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resource_id = _seed_cloud_resource(tmp_path)
    highlight = DrawboardCapture(
        fingerprint=f"drawboard-{DOCUMENT_ID}-red-highlight",
        source_revision="highlight-1",
        page=11,
        annotation_kind="TextHighlight",
        color="red",
        rgb=[1.0, 0.0, 0.0],
        quote="This line belongs to the handwritten question",
        comment="",
        is_question=True,
        created_at="2026-07-01T10:00:00Z",
        rect=[80.0, 40.0, 260.0, 55.0],
    )
    ink = DrawboardInk(
        fingerprint=f"drawboard-{DOCUMENT_ID}-red-ink",
        source_revision="ink-1",
        page=11,
        color="red",
        rgb=[1.0, 0.0, 0.0],
        created_at="2026-07-01T10:01:00Z",
        rect=[8.0, 25.0, 300.0, 100.0],
        ink_vertex_sets=([[8.0, 25.0], [8.0, 100.0]],),
        member_fingerprints=(f"drawboard-{DOCUMENT_ID}-red-ink",),
    )
    extraction = DrawboardExtraction(
        source_url=SHARE_URL,
        document_id=DOCUMENT_ID,
        captures=[highlight],
        red_ink=[ink],
        all_ink=[ink],
        ignored={},
    )
    monkeypatch.setattr(
        pdf_annotation_service,
        "extract_drawboard_annotations",
        lambda _source_url: extraction,
    )

    with transaction() as connection:
        pdf_annotation_service.save_drawboard_color_roles(
            connection,
            resource_id,
            {"#FF0000": "question"},
        )
        collected = collect_resource_pdf_annotations(connection, resource_id)
        rows = connection.execute(
            text(
                """
                SELECT a.kind, a.origin
                FROM annotations a
                WHERE a.resource_id = :resource_id
                  AND a.deleted_at IS NULL
                ORDER BY a.kind
                """
            ),
            {"resource_id": resource_id},
        ).mappings().all()

    assert collected.kind_counts == {"highlight": 1, "question": 1}
    assert rows == [
        {"kind": "highlight", "origin": "drawboard_cloud"},
        {"kind": "question", "origin": "drawboard_cloud_ink"},
    ]


def test_ink_groups_in_the_same_pdf_paragraph_become_one_capture() -> None:
    first = DrawboardInk(
        fingerprint="ink-one",
        source_revision="rev-one",
        page=172,
        color="red",
        rgb=[1.0, 0.0, 0.0],
        created_at="2026-08-17T10:00:00Z",
        rect=[5.0, 531.0, 32.0, 548.0],
        ink_vertex_sets=([[5.0, 531.0], [32.0, 548.0]],),
        member_fingerprints=("ink-one",),
    )
    second = DrawboardInk(
        fingerprint="ink-two",
        source_revision="rev-two",
        page=172,
        color="red",
        rgb=[1.0, 0.0, 0.0],
        created_at="2026-08-17T10:01:00Z",
        rect=[5.0, 552.0, 34.0, 573.0],
        ink_vertex_sets=([[5.0, 552.0], [34.0, 573.0]],),
        member_fingerprints=("ink-two",),
    )
    context = PdfAnnotationContext(
        chapter_number=7,
        chapter_title="n-step Bootstrapping",
        context_after="",
        context_before="",
        context_sentence="Expected Sarsa uses one fewer ratio.",
        match_method="paragraph",
        subchapter_title="Per-decision Methods",
        paragraph_id="paragraph-172-a",
    )

    merged = _merge_ink_groups_by_paragraph(
        [first, second],
        {first.fingerprint: context, second.fingerprint: context},
    )

    assert len(merged) == 1
    assert merged[0].rect == [5.0, 531.0, 34.0, 573.0]
    assert set(merged[0].member_fingerprints) == {"ink-one", "ink-two"}


def test_book_chapters_map_to_their_explicit_study_days(tmp_path: Path) -> None:
    pdf_path = tmp_path / "book.pdf"
    pdf_path.write_bytes(b"%PDF-1.4")
    plan_path = tmp_path / "chapter-plan.md"
    plan_path.write_text(
        f"""
+++
format = "study-plan/v1"
id = "chapter_study_days"
title = "Chapter Study Days"
mode = "full"

[resources.book]
title = "RL Book"
path = "{pdf_path}"
kind = "book"
+++

# Chapter Study Days

### Day 1: Chapter two {{#day-01}}

#### Reading

- [ ] Read Sections 2.1-2.4. {{#read-two resources=book}}

Stop when: chapter two is read. {{#day01-stop}}

### Day 2: Chapter three {{#day-02}}

#### Reading

- [ ] Read Sections 3.1-3.6. {{#read-three resources=book}}

Stop when: chapter three is read. {{#day02-stop}}
""".lstrip(),
        encoding="utf-8",
    )
    result = sync_study_plan(plan_path)

    with transaction() as connection:
        resource_id = str(
            connection.execute(
                text(
                    """
                    SELECT entity_id
                    FROM source_bindings
                    WHERE entity_type = 'resource'
                      AND source_key = 'chapter_study_days:book'
                    """
                )
            ).scalar_one()
        )
        days = {
            int(row["number"]): str(row["id"])
            for row in connection.execute(
                text(
                    """
                    SELECT id, number
                    FROM study_days
                    WHERE course_id = :course_id
                    ORDER BY number
                    """
                ),
                {"course_id": result.course_id},
            ).mappings()
        }
        mapping = _chapter_study_days(connection, resource_id)

    assert mapping == {2: days[1], 3: days[2]}


def test_cloud_resource_open_uses_native_document_before_local_copy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[list[str], str]] = []
    monkeypatch.setattr(
        "tracker_api.services.resource_open_service.resolve_drawboard_document_id",
        lambda _url: DOCUMENT_ID,
    )

    def fake_open(command: list[str], label: str) -> str:
        calls.append((command, label))
        return label

    monkeypatch.setattr(
        "tracker_api.services.resource_open_service._run_open",
        fake_open,
    )
    target, application = open_resource(
        local_path="/missing/stale-copy.pdf",
        source_url=SHARE_URL,
    )

    assert target == SHARE_URL
    assert application == "Drawboard PDF cloud"
    assert calls == [
        (
            [
                "open",
                f"com.drawboard.drawboardpdf://open/documents/{DOCUMENT_ID}",
            ],
            "Drawboard PDF cloud",
        )
    ]
