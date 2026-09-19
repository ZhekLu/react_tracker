from __future__ import annotations

import hashlib
import html
import json
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, cast
from urllib.parse import urlencode, urljoin, urlparse
from xml.etree import ElementTree

import httpx
from sqlalchemy import text
from sqlalchemy.engine import Connection

from .resource_open_service import ResourceOpenError, readable_local_resource_path

ZOTERO_BASE_URL = "http://127.0.0.1:23119/api"
ZOTERO_ITEM_KEY_ALPHABET = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ"


class ZoteroIntegrationError(RuntimeError):
    pass


class ZoteroUnavailableError(ZoteroIntegrationError):
    pass


@dataclass(frozen=True, slots=True)
class ZoteroStatus:
    available: bool
    enabled: bool
    api_version: str
    zotero_version: str
    item_count: int | None
    message: str


@dataclass(frozen=True, slots=True)
class ZoteroExportResult:
    status: str
    created: bool
    item_key: str
    note_key: str
    attachment_key: str
    metadata_source: str
    file_attached: bool
    message: str


@dataclass(frozen=True, slots=True)
class SourceMetadata:
    source_url: str
    item_type: str
    title: str
    authors: tuple[str, ...]
    date: str
    abstract: str
    publication_title: str
    conference_name: str
    doi: str
    pages: str
    pdf_url: str


@dataclass(slots=True)
class _Authorization:
    key: str
    remember: bool


_AUTHORIZATIONS: dict[str, _Authorization] = {}


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _zotero_client() -> httpx.Client:
    return httpx.Client(timeout=30, follow_redirects=True, trust_env=False)


def _source_client() -> httpx.Client:
    return httpx.Client(timeout=20, follow_redirects=True)


def _base_headers() -> dict[str, str]:
    return {
        "User-Agent": "Study Tracker/0.1 (local Zotero integration)",
        "Zotero-API-Version": "3",
        "Zotero-Allowed-Request": "1",
    }


def _zotero_request(
    method: str,
    path_or_url: str,
    *,
    headers: dict[str, str] | None = None,
    json_payload: Any = None,
    data: dict[str, str] | None = None,
    content: bytes | None = None,
) -> httpx.Response:
    url = (
        path_or_url
        if path_or_url.startswith(("http://", "https://"))
        else f"{ZOTERO_BASE_URL}{path_or_url}"
    )
    request_headers = _base_headers()
    request_headers.update(headers or {})
    try:
        with _zotero_client() as client:
            return client.request(
                method,
                url,
                headers=request_headers,
                json=json_payload,
                data=data,
                content=content,
            )
    except httpx.RequestError as error:
        raise ZoteroUnavailableError(
            "Zotero is not reachable. Open Zotero and enable its local API in "
            "Settings → Advanced."
        ) from error


def _raise_for_zotero(response: httpx.Response, action: str) -> None:
    if 200 <= response.status_code < 300:
        return
    detail = response.text.strip()
    if response.status_code == 403:
        raise ZoteroIntegrationError(
            "Zotero denied the request. Enable local API access or allow Study Tracker "
            "in Zotero's authorization dialog."
        )
    if response.status_code == 401:
        raise ZoteroIntegrationError("Zotero write authorization expired.")
    raise ZoteroIntegrationError(
        f"Zotero could not {action} (HTTP {response.status_code})"
        + (f": {detail[:300]}" if detail else ".")
    )


def _server_info() -> tuple[str, str, str]:
    response = _zotero_request("GET", "/")
    _raise_for_zotero(response, "report its local API status")
    server_id = response.headers.get("Zotero-Server-ID", "")
    api_version = response.headers.get("Zotero-API-Version", "")
    zotero_version = response.headers.get("Zotero-Version", "")
    if not server_id:
        raise ZoteroIntegrationError(
            "The running Zotero does not expose write authorization. "
            "Zotero 10 or newer is required."
        )
    return server_id, api_version, zotero_version


def zotero_status() -> ZoteroStatus:
    try:
        _server_id, api_version, zotero_version = _server_info()
        response = _zotero_request("GET", "/users/0/items?limit=1")
        _raise_for_zotero(response, "read the local library")
        raw_count = response.headers.get("Total-Results")
        return ZoteroStatus(
            available=True,
            enabled=True,
            api_version=api_version,
            zotero_version=zotero_version,
            item_count=int(raw_count) if raw_count and raw_count.isdigit() else None,
            message="Zotero local library is connected.",
        )
    except ZoteroUnavailableError as error:
        return ZoteroStatus(False, False, "", "", None, str(error))
    except ZoteroIntegrationError as error:
        return ZoteroStatus(True, False, "", "", None, str(error))


def _authorize(server_id: str) -> _Authorization:
    response = _zotero_request(
        "POST",
        "/local/authorize",
        headers={"Zotero-Server-ID": server_id},
        json_payload={"appName": "Study Tracker"},
    )
    _raise_for_zotero(response, "authorize Study Tracker")
    payload = response.json()
    key = str(payload.get("key") or "")
    if not key:
        raise ZoteroIntegrationError("Zotero returned an empty write authorization.")
    authorization = _Authorization(key=key, remember=bool(payload.get("remember")))
    if authorization.remember:
        _AUTHORIZATIONS[server_id] = authorization
    return authorization


def _authorized_write(
    server_id: str,
    method: str,
    path: str,
    *,
    headers: dict[str, str] | None = None,
    json_payload: Any = None,
    data: dict[str, str] | None = None,
) -> httpx.Response:
    for attempt in range(2):
        authorization = _AUTHORIZATIONS.get(server_id) or _authorize(server_id)
        request_headers = {
            "Zotero-Server-ID": server_id,
            "Zotero-API-Key": authorization.key,
            **(headers or {}),
        }
        response = _zotero_request(
            method,
            path,
            headers=request_headers,
            json_payload=json_payload,
            data=data,
        )
        if not authorization.remember:
            _AUTHORIZATIONS.pop(server_id, None)
        if response.status_code != 401 or attempt == 1:
            _raise_for_zotero(response, "write to the local library")
            return response
        _AUTHORIZATIONS.pop(server_id, None)
    raise ZoteroIntegrationError("Zotero write authorization failed.")


class _CitationMetadataParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.values: dict[str, list[str]] = {}

    def handle_starttag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        if tag.casefold() != "meta":
            return
        attributes = {key.casefold(): value or "" for key, value in attrs}
        key = (attributes.get("name") or attributes.get("property") or "").casefold()
        value = attributes.get("content", "").strip()
        if key and value:
            self.values.setdefault(key, []).append(value)


def _first(values: dict[str, list[str]], *keys: str) -> str:
    for key in keys:
        candidates = values.get(key.casefold(), [])
        if candidates:
            return candidates[0].strip()
    return ""


def _fetch_arxiv_metadata(source_url: str, identifier: str) -> SourceMetadata:
    api_url = f"https://export.arxiv.org/api/query?{urlencode({'id_list': identifier})}"
    try:
        with _source_client() as client:
            response = client.get(api_url, headers={"User-Agent": _base_headers()["User-Agent"]})
        response.raise_for_status()
    except httpx.HTTPError as error:
        raise ZoteroIntegrationError(f"Could not read arXiv metadata for {identifier}.") from error
    root = ElementTree.fromstring(response.content)
    namespace = {"atom": "http://www.w3.org/2005/Atom", "arxiv": "http://arxiv.org/schemas/atom"}
    entry = root.find("atom:entry", namespace)
    if entry is None:
        raise ZoteroIntegrationError(f"arXiv did not return metadata for {identifier}.")

    def value(path: str) -> str:
        element = entry.find(path, namespace)
        return " ".join((element.text or "").split()) if element is not None else ""

    authors = tuple(
        " ".join((author.text or "").split())
        for author in entry.findall("atom:author/atom:name", namespace)
        if (author.text or "").strip()
    )
    pdf_url = next(
        (
            str(link.attrib.get("href") or "")
            for link in entry.findall("atom:link", namespace)
            if link.attrib.get("type") == "application/pdf"
        ),
        f"https://arxiv.org/pdf/{identifier}",
    )
    return SourceMetadata(
        source_url=f"https://arxiv.org/abs/{identifier}",
        item_type="preprint",
        title=value("atom:title"),
        authors=authors,
        date=value("atom:published")[:10],
        abstract=value("atom:summary"),
        publication_title="arXiv",
        conference_name="",
        doi=value("arxiv:doi"),
        pages="",
        pdf_url=pdf_url,
    )


def _arxiv_identifier(source_url: str) -> str:
    parsed = urlparse(source_url)
    if parsed.netloc.casefold() not in {"arxiv.org", "www.arxiv.org"}:
        return ""
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) < 2 or parts[0] not in {"abs", "pdf"}:
        return ""
    return parts[1].removesuffix(".pdf")


def _fetch_citation_metadata(source_url: str) -> SourceMetadata:
    try:
        with _source_client() as client:
            response = client.get(source_url, headers={"User-Agent": _base_headers()["User-Agent"]})
        response.raise_for_status()
    except httpx.HTTPError as error:
        raise ZoteroIntegrationError(
            "Could not read bibliographic metadata from the paper's original source."
        ) from error
    parser = _CitationMetadataParser()
    parser.feed(response.text)
    values = parser.values
    title = _first(values, "citation_title", "dc.title", "og:title")
    authors = tuple(values.get("citation_author", []) or values.get("dc.creator", []))
    if not title:
        raise ZoteroIntegrationError(
            "The original source did not expose citation metadata; nothing was sent to Zotero."
        )
    conference_name = _first(values, "citation_conference_title")
    publication_title = _first(
        values,
        "citation_journal_title",
        "citation_inbook_title",
        "citation_technical_report_institution",
    )
    first_page = _first(values, "citation_firstpage")
    last_page = _first(values, "citation_lastpage")
    pages = f"{first_page}-{last_page}" if first_page and last_page else first_page
    return SourceMetadata(
        source_url=str(response.url),
        item_type="conferencePaper" if conference_name else "journalArticle",
        title=title,
        authors=authors,
        date=_first(values, "citation_publication_date", "citation_date", "dc.date"),
        abstract=_first(values, "citation_abstract", "dc.description", "description"),
        publication_title=publication_title,
        conference_name=conference_name,
        doi=_first(values, "citation_doi", "dc.identifier"),
        pages=pages,
        pdf_url=urljoin(str(response.url), _first(values, "citation_pdf_url")),
    )


def _fetch_source_metadata(source_url: str) -> SourceMetadata:
    arxiv_id = _arxiv_identifier(source_url)
    metadata = (
        _fetch_arxiv_metadata(source_url, arxiv_id)
        if arxiv_id
        else _fetch_citation_metadata(source_url)
    )
    if not metadata.title or not metadata.authors:
        raise ZoteroIntegrationError(
            "The original source is missing a title or authors; nothing was sent to Zotero."
        )
    return metadata


def _creator(author: str) -> dict[str, str]:
    name = " ".join(author.split())
    if "," in name:
        last_name, first_name = (part.strip() for part in name.split(",", 1))
        return {"creatorType": "author", "firstName": first_name, "lastName": last_name}
    parts = name.split()
    if len(parts) < 2:
        return {"creatorType": "author", "name": name}
    return {
        "creatorType": "author",
        "firstName": " ".join(parts[:-1]),
        "lastName": parts[-1],
    }


def _item_key() -> str:
    return "".join(secrets.choice(ZOTERO_ITEM_KEY_ALPHABET) for _ in range(8))


def _item_template(item_type: str, *, link_mode: str = "") -> dict[str, Any]:
    query = {"itemType": item_type}
    if link_mode:
        query["linkMode"] = link_mode
    response = _zotero_request("GET", f"/items/new?{urlencode(query)}")
    _raise_for_zotero(response, f"load the {item_type} item template")
    payload = response.json()
    if not isinstance(payload, dict):
        raise ZoteroIntegrationError(f"Zotero returned an invalid {item_type} template.")
    return cast(dict[str, Any], payload)


def _set_supported(item: dict[str, Any], values: dict[str, Any]) -> None:
    for key, value in values.items():
        if key in item and value not in ("", None, [], ()):  # keep Zotero's schema authoritative
            item[key] = value


def _metadata_item(metadata: SourceMetadata, tags: list[str], key: str) -> dict[str, Any]:
    try:
        item = _item_template(metadata.item_type)
    except ZoteroIntegrationError:
        item = _item_template("journalArticle")
    item.update({"key": key, "version": 0})
    _set_supported(
        item,
        {
            "title": metadata.title,
            "creators": [_creator(author) for author in metadata.authors],
            "date": metadata.date,
            "abstractNote": metadata.abstract,
            "publicationTitle": metadata.publication_title,
            "conferenceName": metadata.conference_name,
            "proceedingsTitle": metadata.conference_name,
            "DOI": metadata.doi.removeprefix("https://doi.org/"),
            "pages": metadata.pages,
            "url": metadata.source_url,
            "archive": "arXiv" if metadata.item_type == "preprint" else "",
            "tags": [{"tag": tag} for tag in tags],
        },
    )
    return item


def _note_html(plain_text: str) -> str:
    paragraphs = [part.strip() for part in plain_text.split("\n\n") if part.strip()]
    return "".join(
        f"<p>{html.escape(paragraph).replace(chr(10), '<br/>')}</p>"
        for paragraph in paragraphs
    )


def _note_item(note_html: str, parent_key: str, key: str) -> dict[str, Any]:
    item = _item_template("note")
    item.update({"key": key, "version": 0, "parentItem": parent_key})
    _set_supported(item, {"note": note_html})
    return item


def _attachment_item(
    path: Path,
    metadata: SourceMetadata,
    parent_key: str,
    key: str,
) -> dict[str, Any]:
    item = _item_template("attachment", link_mode="imported_file")
    item.update(
        {
            "key": key,
            "version": 0,
            "parentItem": parent_key,
            "linkMode": "imported_file",
        }
    )
    _set_supported(
        item,
        {
            "title": "Full Text PDF",
            "url": metadata.pdf_url or metadata.source_url,
            "contentType": "application/pdf",
            "filename": path.name,
        },
    )
    return item


def _validate_multi_write(response: httpx.Response, expected_count: int) -> None:
    payload = response.json()
    failures = payload.get("failed", {})
    if failures:
        raise ZoteroIntegrationError(f"Zotero rejected an item: {failures}")
    successful = payload.get("successful", payload.get("success", {}))
    unchanged = payload.get("unchanged", {})
    if len(successful) + len(unchanged) < expected_count:
        raise ZoteroIntegrationError("Zotero did not confirm every created item.")


def _file_hash(path: Path) -> str:
    digest = hashlib.md5(usedforsecurity=False)
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _content_hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _upload_file(
    server_id: str,
    attachment_key: str,
    path: Path,
    md5: str,
    *,
    previous_md5: str = "",
) -> None:
    match_headers = {"If-Match": previous_md5} if previous_md5 else {"If-None-Match": "*"}
    stat = path.stat()
    response = _authorized_write(
        server_id,
        "POST",
        f"/users/0/items/{attachment_key}/file",
        headers=match_headers,
        data={
            "md5": md5,
            "filename": path.name,
            "filesize": str(stat.st_size),
            "mtime": str(stat.st_mtime_ns // 1_000_000),
        },
    )
    payload = response.json()
    if payload.get("exists") == 1:
        return
    upload_url = str(payload.get("url") or "")
    upload_key = str(payload.get("uploadKey") or "")
    if not upload_url or not upload_key:
        raise ZoteroIntegrationError("Zotero returned an invalid file upload authorization.")
    body = (
        str(payload.get("prefix") or "").encode()
        + path.read_bytes()
        + str(payload.get("suffix") or "").encode()
    )
    upload = _zotero_request(
        "POST",
        upload_url,
        headers={"Content-Type": str(payload.get("contentType") or "application/pdf")},
        content=body,
    )
    if upload.status_code != 201:
        _raise_for_zotero(upload, "upload the PDF file")
    _authorized_write(
        server_id,
        "POST",
        f"/users/0/items/{attachment_key}/file",
        headers=match_headers,
        data={"upload": upload_key},
    )


def _resource_payload(connection: Connection, resource_id: str) -> dict[str, Any]:
    row = connection.execute(
        text("""
            SELECT r.id, r.kind, r.status, r.title, r.canonical_url,
                   rv.local_path, rv.source_url
            FROM resources r
            LEFT JOIN resource_versions rv ON rv.id = r.current_version_id
            WHERE r.id = :resource_id AND r.deleted_at IS NULL
            """),
        {"resource_id": resource_id},
    ).mappings().one_or_none()
    if row is None:
        raise ZoteroIntegrationError("Resource does not exist.")
    if row["kind"] != "paper":
        raise ZoteroIntegrationError("Only paper resources can be saved to Zotero.")
    if row["status"] not in {"read", "review"}:
        raise ZoteroIntegrationError(
            "Mark the paper as read before approving its final note for Zotero."
        )
    note = connection.execute(
        text("""
            SELECT d.plain_text
            FROM notes n
            JOIN note_links nl ON nl.note_id = n.id
            JOIN documents d ON d.id = n.document_id
            WHERE nl.entity_type = 'resource' AND nl.entity_id = :resource_id
              AND nl.relation = 'primary' AND n.kind = 'resource'
              AND n.status = 'active' AND n.deleted_at IS NULL
            ORDER BY n.updated_at DESC
            LIMIT 1
            """),
        {"resource_id": resource_id},
    ).scalar_one_or_none()
    note_text = str(note or "").strip()
    if not note_text:
        raise ZoteroIntegrationError(
            "Write the paper's final resource note before saving it to Zotero."
        )
    source_url = str(row["canonical_url"] or row["source_url"] or "").strip()
    if not source_url:
        raise ZoteroIntegrationError(
            "This paper needs an original-source URL (for example arXiv) before Zotero export."
        )
    local_path = str(row["local_path"] or "").strip()
    if not local_path:
        raise ZoteroIntegrationError("This paper has no local PDF file to attach.")
    try:
        path = readable_local_resource_path(local_path)
    except ResourceOpenError as error:
        raise ZoteroIntegrationError(str(error)) from error
    tags = [
        str(value)
        for value in connection.execute(
            text("""
                SELECT t.name
                FROM resource_tags rt
                JOIN tags t ON t.id = rt.tag_id
                WHERE rt.resource_id = :resource_id
                ORDER BY lower(t.name)
                """),
            {"resource_id": resource_id},
        ).scalars()
    ]
    return {
        **dict(row),
        "note_text": note_text,
        "source_url": source_url,
        "path": path,
        "tags": tags,
    }


def _export_row(connection: Connection, resource_id: str) -> dict[str, Any] | None:
    row = connection.execute(
        text("""
            SELECT * FROM resource_integration_exports
            WHERE resource_id = :resource_id AND integration = 'zotero'
            """),
        {"resource_id": resource_id},
    ).mappings().one_or_none()
    return dict(row) if row else None


def _save_export(
    connection: Connection,
    resource_id: str,
    *,
    item_key: str,
    note_key: str,
    attachment_key: str,
    source_url: str,
    note_hash: str,
    file_hash: str | None,
    status: str,
    error: str | None,
    metadata: dict[str, Any],
) -> None:
    now = _utc_now()
    connection.execute(
        text("""
            INSERT INTO resource_integration_exports (
              resource_id, integration, external_id, external_note_id,
              external_attachment_id, source_url, note_hash, file_hash,
              status, last_error, metadata_json, created_at, updated_at
            ) VALUES (
              :resource_id, 'zotero', :external_id, :external_note_id,
              :external_attachment_id, :source_url, :note_hash, :file_hash,
              :status, :last_error, :metadata_json, :created_at, :updated_at
            )
            ON CONFLICT(resource_id, integration) DO UPDATE SET
              external_id = excluded.external_id,
              external_note_id = excluded.external_note_id,
              external_attachment_id = excluded.external_attachment_id,
              source_url = excluded.source_url,
              note_hash = excluded.note_hash,
              file_hash = excluded.file_hash,
              status = excluded.status,
              last_error = excluded.last_error,
              metadata_json = excluded.metadata_json,
              updated_at = excluded.updated_at
            """),
        {
            "resource_id": resource_id,
            "external_id": item_key,
            "external_note_id": note_key,
            "external_attachment_id": attachment_key,
            "source_url": source_url,
            "note_hash": note_hash,
            "file_hash": file_hash,
            "status": status,
            "last_error": error,
            "metadata_json": json.dumps(metadata, sort_keys=True),
            "created_at": now,
            "updated_at": now,
        },
    )


def _item_data(item_key: str) -> dict[str, Any]:
    response = _zotero_request("GET", f"/users/0/items/{item_key}")
    _raise_for_zotero(response, f"read item {item_key}")
    payload = response.json()
    data = payload.get("data")
    if not isinstance(data, dict):
        raise ZoteroIntegrationError(f"Zotero item {item_key} has invalid data.")
    return cast(dict[str, Any], data)


def export_resource_to_zotero(
    connection: Connection,
    resource_id: str,
) -> ZoteroExportResult:
    resource = _resource_payload(connection, resource_id)
    server_id, _api_version, _zotero_version = _server_info()
    existing = _export_row(connection, resource_id)
    note_html = _note_html(str(resource["note_text"]))
    note_hash = _content_hash(note_html)
    path = cast(Path, resource["path"])
    file_hash = _file_hash(path)
    tags = cast(list[str], resource["tags"])
    tags_hash = _content_hash(json.dumps(tags, sort_keys=True))

    if existing is None:
        metadata = _fetch_source_metadata(str(resource["source_url"]))
        parent_key, note_key, attachment_key = _item_key(), _item_key(), _item_key()
        objects = [
            _metadata_item(metadata, tags, parent_key),
            _note_item(note_html, parent_key, note_key),
            _attachment_item(path, metadata, parent_key, attachment_key),
        ]
        response = _authorized_write(
            server_id,
            "POST",
            "/users/0/items",
            headers={"Zotero-Write-Token": secrets.token_hex(16)},
            json_payload=objects,
        )
        _validate_multi_write(response, 3)
        export_metadata = {
            "serverId": server_id,
            "metadataSource": metadata.source_url,
            "itemType": objects[0]["itemType"],
            "tagsHash": tags_hash,
        }
        _save_export(
            connection,
            resource_id,
            item_key=parent_key,
            note_key=note_key,
            attachment_key=attachment_key,
            source_url=metadata.source_url,
            note_hash=note_hash,
            file_hash=None,
            status="partial",
            error=None,
            metadata=export_metadata,
        )
        created = True
    else:
        parent_key = str(existing["external_id"])
        note_key = str(existing["external_note_id"] or "")
        attachment_key = str(existing["external_attachment_id"] or "")
        export_metadata = json.loads(str(existing["metadata_json"] or "{}"))
        if export_metadata.get("serverId") != server_id:
            raise ZoteroIntegrationError(
                "This paper was exported to a different Zotero library. "
                "Reconnect that library first."
            )
        created = False

    try:
        if existing is not None and existing.get("note_hash") != note_hash:
            note_data = _item_data(note_key)
            _authorized_write(
                server_id,
                "PATCH",
                f"/users/0/items/{note_key}",
                json_payload={"version": note_data["version"], "note": note_html},
            )
        if existing is not None and export_metadata.get("tagsHash") != tags_hash:
            parent_data = _item_data(parent_key)
            current_tags = {
                str(item.get("tag"))
                for item in parent_data.get("tags", [])
                if isinstance(item, dict) and item.get("tag")
            }
            merged_tags = sorted(current_tags.union(tags), key=str.casefold)
            _authorized_write(
                server_id,
                "PATCH",
                f"/users/0/items/{parent_key}",
                json_payload={
                    "version": parent_data["version"],
                    "tags": [{"tag": tag} for tag in merged_tags],
                },
            )
        if existing is None or existing.get("file_hash") != file_hash:
            previous_md5 = ""
            if existing is not None:
                attachment_data = _item_data(attachment_key)
                previous_md5 = str(attachment_data.get("md5") or "")
            _upload_file(
                server_id,
                attachment_key,
                path,
                file_hash,
                previous_md5=previous_md5,
            )
        export_metadata["tagsHash"] = tags_hash
        _save_export(
            connection,
            resource_id,
            item_key=parent_key,
            note_key=note_key,
            attachment_key=attachment_key,
            source_url=str(export_metadata.get("metadataSource") or resource["source_url"]),
            note_hash=note_hash,
            file_hash=file_hash,
            status="synced",
            error=None,
            metadata=export_metadata,
        )
        return ZoteroExportResult(
            status="synced",
            created=created,
            item_key=parent_key,
            note_key=note_key,
            attachment_key=attachment_key,
            metadata_source=str(export_metadata.get("metadataSource") or ""),
            file_attached=True,
            message=(
                "Paper metadata, approved note, tags, and PDF were saved to Zotero."
                if created
                else "The approved paper note, tags, and PDF are up to date in Zotero."
            ),
        )
    except ZoteroIntegrationError as error:
        _save_export(
            connection,
            resource_id,
            item_key=parent_key,
            note_key=note_key,
            attachment_key=attachment_key,
            source_url=str(export_metadata.get("metadataSource") or resource["source_url"]),
            note_hash=note_hash,
            file_hash=existing.get("file_hash") if existing else None,
            status="partial",
            error=str(error),
            metadata=export_metadata,
        )
        return ZoteroExportResult(
            status="partial",
            created=created,
            item_key=parent_key,
            note_key=note_key,
            attachment_key=attachment_key,
            metadata_source=str(export_metadata.get("metadataSource") or ""),
            file_attached=False,
            message=f"Zotero saved the library items, but synchronization is incomplete: {error}",
        )
