from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlalchemy import text

from tracker_api.config import get_settings
from tracker_api.database import get_engine, transaction
from tracker_api.repositories.workspace_repository import upsert_note
from tracker_api.schemas.workspace import NoteUpsertCommand
from tracker_api.services import zotero_service
from tracker_api.services.study_plan_service import sync_study_plan
from tracker_api.services.zotero_service import (
    ZoteroIntegrationError,
    export_resource_to_zotero,
)


@pytest.fixture(autouse=True)
def isolated_settings(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[None]:
    helper_config = tmp_path / "helper.json"
    helper_config.write_text(
        json.dumps({"open_allowed_roots": [str(tmp_path)]}),
        encoding="utf-8",
    )
    monkeypatch.setenv("TRACKER_DATABASE_PATH", str(tmp_path / "tracker.db"))
    monkeypatch.setenv("TRACKER_HELPER_CONFIG_PATH", str(helper_config))
    get_settings.cache_clear()
    get_engine.cache_clear()
    zotero_service._AUTHORIZATIONS.clear()
    yield
    if get_engine.cache_info().currsize:
        get_engine().dispose()
    get_engine.cache_clear()
    get_settings.cache_clear()
    zotero_service._AUTHORIZATIONS.clear()


def _seed_paper(tmp_path: Path) -> tuple[str, str]:
    (tmp_path / "paper.pdf").write_bytes(b"%PDF-1.4\ntracker test\n")
    plan = tmp_path / "plan.md"
    plan.write_text(
        """
+++
format = "study-plan/v1"
id = "zotero_test"
title = "Zotero Test"
mode = "full"

[resources.paper]
title = "Tracker fallback title"
path = "paper.pdf"
url = "https://papers.example/original"
kind = "paper"
+++

# Zotero Test

### Day 1: 2026-09-19 - Paper {#day-01}

#### Reading

- [ ] Read the paper. {#read-paper resources=paper}

Stop when: the paper is read. {#day01-stop}
""".lstrip(),
        encoding="utf-8",
    )
    sync_study_plan(plan)
    with transaction() as connection:
        resource_id = str(
            connection.execute(
                text(
                    "SELECT entity_id FROM source_bindings "
                    "WHERE source_key='zotero_test:paper' AND entity_type='resource'"
                )
            ).scalar_one()
        )
        course_id = str(
            connection.execute(
                text("SELECT course_id FROM resources WHERE id=:id"),
                {"id": resource_id},
            )
            .scalar_one()
        )
    return resource_id, course_id


def test_export_requires_a_read_paper_with_a_saved_resource_note(tmp_path: Path) -> None:
    resource_id, course_id = _seed_paper(tmp_path)
    with transaction() as connection:
        with pytest.raises(ZoteroIntegrationError, match="Mark the paper as read"):
            export_resource_to_zotero(connection, resource_id)
        connection.execute(
            text("UPDATE resources SET status='read' WHERE id=:id"),
            {"id": resource_id},
        )
        with pytest.raises(ZoteroIntegrationError, match="final resource note"):
            export_resource_to_zotero(connection, resource_id)
        upsert_note(
            connection,
            NoteUpsertCommand(
                course_id=course_id,
                kind="resource",
                entity_type="resource",
                entity_id=resource_id,
                markdown="My final note",
                plain_text="My final note",
            ),
        )


def test_export_uses_original_source_metadata_and_uploads_note_tags_and_pdf(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resource_id, course_id = _seed_paper(tmp_path)
    with transaction() as connection:
        connection.execute(
            text("UPDATE resources SET status='read' WHERE id=:id"),
            {"id": resource_id},
        )
        upsert_note(
            connection,
            NoteUpsertCommand(
                course_id=course_id,
                kind="resource",
                entity_type="resource",
                entity_id=resource_id,
                markdown="Strong result.\n\nCheck the assumptions.",
                plain_text="Strong result.\n\nCheck the assumptions.",
            ),
        )
        connection.execute(
            text(
                "INSERT INTO tags (id, course_id, name, color, created_at) "
                "VALUES ('tag-1', :course, 'actor-critic', NULL, 'now')"
            ),
            {"course": course_id},
        )
        connection.execute(
            text("INSERT INTO resource_tags (resource_id, tag_id) VALUES (:resource, 'tag-1')"),
            {"resource": resource_id},
        )

    source_html = """
      <meta name="citation_title" content="Original Source Title">
      <meta name="citation_author" content="Ada Researcher">
      <meta name="citation_author" content="Grace Scientist">
      <meta name="citation_publication_date" content="2024">
      <meta name="citation_conference_title" content="Test Conference">
      <meta name="citation_pdf_url" content="/paper.pdf">
      <meta name="citation_doi" content="10.1000/example">
    """
    source_requests: list[httpx.Request] = []

    def source_handler(request: httpx.Request) -> httpx.Response:
        source_requests.append(request)
        return httpx.Response(200, text=source_html, request=request)

    created_items: list[dict[str, Any]] = []
    uploads: list[bytes] = []

    def zotero_handler(request: httpx.Request) -> httpx.Response:
        headers = {
            "Zotero-Server-ID": "server-one",
            "Zotero-API-Version": "3",
            "Zotero-Version": "8.0",
        }
        path = request.url.path
        if request.method == "GET" and path == "/api/":
            return httpx.Response(200, json={}, headers=headers, request=request)
        if request.method == "GET" and path == "/api/items/new":
            item_type = request.url.params["itemType"]
            templates: dict[str, dict[str, Any]] = {
                "conferencePaper": {
                    "itemType": "conferencePaper",
                    "title": "",
                    "creators": [],
                    "date": "",
                    "abstractNote": "",
                    "conferenceName": "",
                    "proceedingsTitle": "",
                    "DOI": "",
                    "pages": "",
                    "url": "",
                    "tags": [],
                    "collections": [],
                    "relations": {},
                },
                "note": {"itemType": "note", "note": "", "tags": [], "relations": {}},
                "attachment": {
                    "itemType": "attachment",
                    "linkMode": "imported_file",
                    "title": "",
                    "url": "",
                    "contentType": "",
                    "filename": "",
                    "tags": [],
                    "relations": {},
                },
            }
            return httpx.Response(200, json=templates[item_type], headers=headers, request=request)
        if request.method == "POST" and path == "/api/local/authorize":
            return httpx.Response(
                200,
                json={"key": "remembered-key", "remember": True},
                headers=headers,
                request=request,
            )
        if request.method == "POST" and path == "/api/users/0/items":
            created_items.extend(json.loads(request.content))
            return httpx.Response(
                200,
                json={"successful": {"0": {}, "1": {}, "2": {}}, "failed": {}},
                headers=headers,
                request=request,
            )
        if request.method == "POST" and path.endswith("/file"):
            if b"upload=" in request.content:
                return httpx.Response(204, headers=headers, request=request)
            return httpx.Response(
                200,
                json={
                    "url": "http://127.0.0.1:23119/api/local/uploads/upload-1",
                    "contentType": "application/pdf",
                    "prefix": "",
                    "suffix": "",
                    "uploadKey": "upload-1",
                },
                headers=headers,
                request=request,
            )
        if request.method == "POST" and path == "/api/local/uploads/upload-1":
            uploads.append(request.content)
            return httpx.Response(201, request=request)
        raise AssertionError(f"Unexpected Zotero request: {request.method} {request.url}")

    source_transport = httpx.MockTransport(source_handler)
    zotero_transport = httpx.MockTransport(zotero_handler)
    monkeypatch.setattr(
        zotero_service,
        "_source_client",
        lambda: httpx.Client(transport=source_transport),
    )
    monkeypatch.setattr(
        zotero_service,
        "_zotero_client",
        lambda: httpx.Client(transport=zotero_transport),
    )

    with transaction() as connection:
        result = export_resource_to_zotero(connection, resource_id)

    assert result.status == "synced"
    assert result.created is True
    assert result.file_attached is True
    assert len(source_requests) == 1
    assert created_items[0]["title"] == "Original Source Title"
    assert created_items[0]["title"] != "Tracker fallback title"
    assert created_items[0]["tags"] == [{"tag": "actor-critic"}]
    assert created_items[1]["parentItem"] == created_items[0]["key"]
    assert "Strong result." in created_items[1]["note"]
    assert created_items[2]["parentItem"] == created_items[0]["key"]
    assert uploads == [b"%PDF-1.4\ntracker test\n"]
    with transaction() as connection:
        saved = connection.execute(
            text("SELECT status, file_hash, metadata_json FROM resource_integration_exports")
        ).mappings().one()
    assert saved["status"] == "synced"
    assert saved["file_hash"]
    assert json.loads(saved["metadata_json"])["metadataSource"] == (
        "https://papers.example/original"
    )
