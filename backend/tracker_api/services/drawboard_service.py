from __future__ import annotations

import hashlib
import json
import re
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from ..config import get_settings

DRAWBOARD_API_BASE = "https://us-prod-prod.dbpdf.drawboard.com/api/v1"
DRAWBOARD_IDENTITY_BASE = "https://sso.drawboard.com/api/v1"
DRAWBOARD_WEB_CLIENT_ID = "8eb4c59e7874c315da22288b58b5c621"
DRAWBOARD_SHARE_PATH = re.compile(r"^/documents/links/([a-f0-9]+)/consume/?$")
DRAWBOARD_DOCUMENT_PATH = re.compile(r"^/documents/([a-f0-9]+)")
TEXT_MARKUP_TYPES = {"TextHighlight", "TextUnderline"}
TEXT_ANNOTATION_TYPES = TEXT_MARKUP_TYPES | {"TextInsert"}
INK_VERTICAL_OVERLAP_TOLERANCE = 2.0
INK_VERTICAL_GUIDE_MIN_HEIGHT = 18.0
INK_VERTICAL_GUIDE_ASPECT_RATIO = 3.0
_STATE_LOCK = threading.Lock()


class DrawboardError(RuntimeError):
    """Raised when a Drawboard cloud document cannot be read safely."""


@dataclass(frozen=True, slots=True)
class DrawboardCredentials:
    share_token: str
    user_id: str
    secret: str
    document_id: str


@dataclass(frozen=True, slots=True)
class DrawboardCapture:
    fingerprint: str
    source_revision: str
    page: int
    annotation_kind: str
    color: str
    rgb: list[float]
    quote: str
    comment: str
    is_question: bool
    created_at: str
    rect: list[float]


@dataclass(frozen=True, slots=True)
class DrawboardInk:
    fingerprint: str
    source_revision: str
    page: int
    color: str
    rgb: list[float]
    created_at: str
    rect: list[float]
    ink_vertex_sets: tuple[list[Any], ...]
    member_fingerprints: tuple[str, ...]

    @property
    def quote(self) -> str:
        return ""

    @property
    def comment(self) -> str:
        return ""


@dataclass(frozen=True, slots=True)
class DrawboardExtraction:
    source_url: str
    document_id: str
    captures: list[DrawboardCapture]
    red_ink: list[DrawboardInk]
    ignored: dict[str, int]


def is_drawboard_cloud_url(value: str | None) -> bool:
    if not value:
        return False
    parsed = urlparse(value)
    return (
        parsed.scheme == "https"
        and parsed.netloc.casefold() == "pdf.drawboard.com"
        and (
            DRAWBOARD_SHARE_PATH.match(parsed.path) is not None
            or DRAWBOARD_DOCUMENT_PATH.match(parsed.path) is not None
        )
    )


def drawboard_share_token(value: str) -> str | None:
    parsed = urlparse(value)
    if parsed.netloc.casefold() != "pdf.drawboard.com":
        return None
    match = DRAWBOARD_SHARE_PATH.match(parsed.path)
    return match.group(1) if match else None


def drawboard_document_id(value: str) -> str | None:
    parsed = urlparse(value)
    if parsed.netloc.casefold() != "pdf.drawboard.com":
        return None
    match = DRAWBOARD_DOCUMENT_PATH.match(parsed.path)
    return match.group(1) if match else None


def drawboard_deep_link(document_id: str) -> str:
    if not re.fullmatch(r"[a-f0-9]+", document_id):
        raise DrawboardError("Drawboard returned an invalid document id.")
    return f"com.drawboard.drawboardpdf://open/documents/{document_id}"


def _request_json(
    url: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    access_token: str | None = None,
) -> dict[str, Any]:
    body = (
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
        if payload is not None
        else None
    )
    headers = {
        "Accept": "application/json",
        "User-Agent": "StudyTracker/1.0 DrawboardCloudCompatibility",
    }
    if body is not None:
        headers["Content-Type"] = "application/json"
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    request = Request(url, data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=60) as response:
            raw = response.read().decode("utf-8")
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace").strip()
        suffix = f": {detail[:300]}" if detail else ""
        raise DrawboardError(
            f"Drawboard request failed ({error.code}){suffix}"
        ) from error
    except (TimeoutError, URLError, OSError) as error:
        raise DrawboardError(f"Could not reach Drawboard: {error}") from error
    try:
        result = json.loads(raw)
    except json.JSONDecodeError as error:
        raise DrawboardError("Drawboard returned an unreadable response.") from error
    if not isinstance(result, dict):
        raise DrawboardError("Drawboard returned an unexpected response.")
    return cast(dict[str, Any], result)


def _load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"links": {}}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"links": {}}
    return payload if isinstance(payload, dict) else {"links": {}}


def _save_state(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.chmod(0o600)
    temporary.replace(path)
    path.chmod(0o600)


def _stored_credentials(
    payload: dict[str, Any],
    share_token: str,
) -> DrawboardCredentials | None:
    links = payload.get("links")
    if not isinstance(links, dict):
        return None
    raw = links.get(share_token)
    if not isinstance(raw, dict):
        return None
    user_id = str(raw.get("user_id") or "")
    secret = str(raw.get("secret") or "")
    document_id = str(raw.get("document_id") or "")
    if not user_id or not secret or not document_id:
        return None
    return DrawboardCredentials(
        share_token=share_token,
        user_id=user_id,
        secret=secret,
        document_id=document_id,
    )


def _consume_share_link(share_token: str) -> DrawboardCredentials:
    result = _request_json(
        f"{DRAWBOARD_API_BASE}/documents/links/{share_token}/anonymous",
        method="POST",
        payload={"clientId": DRAWBOARD_WEB_CLIENT_ID},
    )
    user_id = str(result.get("userId") or "")
    secret = str(result.get("secret") or "")
    document_id = str(result.get("documentId") or "")
    if not user_id or not secret or not document_id:
        raise DrawboardError("Drawboard did not return document access credentials.")
    return DrawboardCredentials(
        share_token=share_token,
        user_id=user_id,
        secret=secret,
        document_id=document_id,
    )


def _credentials_for_share_url(source_url: str) -> DrawboardCredentials:
    share_token = drawboard_share_token(source_url)
    if not share_token:
        raise DrawboardError(
            "Cloud annotation collection requires a Drawboard sharing URL."
        )
    state_path = get_settings().drawboard_state_path
    with _STATE_LOCK:
        state = _load_state(state_path)
        stored = _stored_credentials(state, share_token)
        if stored is not None:
            return stored
        credentials = _consume_share_link(share_token)
        links = state.setdefault("links", {})
        if not isinstance(links, dict):
            links = {}
            state["links"] = links
        links[share_token] = {
            "document_id": credentials.document_id,
            "secret": credentials.secret,
            "user_id": credentials.user_id,
        }
        _save_state(state_path, state)
        return credentials


def resolve_drawboard_document_id(source_url: str) -> str:
    direct_id = drawboard_document_id(source_url)
    if direct_id:
        return direct_id
    return _credentials_for_share_url(source_url).document_id


def _anonymous_access_token(credentials: DrawboardCredentials) -> str:
    result = _request_json(
        f"{DRAWBOARD_IDENTITY_BASE}/token/anonymous",
        method="POST",
        payload={
            "clientId": DRAWBOARD_WEB_CLIENT_ID,
            "secret": credentials.secret,
            "userId": credentials.user_id,
        },
    )
    token = str(result.get("accessToken") or "")
    if not token:
        raise DrawboardError("Drawboard did not return an access token.")
    return token


def _as_int(value: object, fallback: int) -> int:
    try:
        return int(cast(Any, value))
    except (TypeError, ValueError):
        return fallback


def _page_numbers(document_payload: dict[str, Any]) -> dict[str, int]:
    document = document_payload.get("document")
    document = document if isinstance(document, dict) else document_payload
    pages = document.get("pages")
    items: list[tuple[str, dict[str, Any]]] = []
    if isinstance(pages, dict):
        items = [
            (str(page_id), cast(dict[str, Any], page))
            for page_id, page in pages.items()
            if isinstance(page, dict)
        ]
    elif isinstance(pages, list):
        items = [
            (str(page.get("id") or page.get("pageId") or index), page)
            for index, page in enumerate(pages)
            if isinstance(page, dict)
        ]
    items.sort(key=lambda item: _as_int(item[1].get("index"), 0))
    return {
        page_id: _as_int(page.get("resourcePageNo"), index + 1)
        for index, (page_id, page) in enumerate(items)
    }


def _annotation_batches(
    document_id: str,
    access_token: str,
) -> list[dict[str, Any]]:
    url = (
        f"{DRAWBOARD_API_BASE}/documents/{document_id}"
        "/data/annotations/fetch-batch"
    )
    annotations: list[dict[str, Any]] = []
    resume_on_page_id: str | None = None
    seen_resume_ids: set[str] = set()
    while True:
        body = (
            {"resumeOnPageId": resume_on_page_id}
            if resume_on_page_id is not None
            else {}
        )
        result = _request_json(
            url,
            method="POST",
            payload=body,
            access_token=access_token,
        )
        batch = result.get("annotations")
        if isinstance(batch, list):
            annotations.extend(
                cast(dict[str, Any], item)
                for item in batch
                if isinstance(item, dict)
            )
        raw_resume = result.get("resumeOnPageId")
        next_resume = str(raw_resume) if raw_resume else None
        if not next_resume:
            return annotations
        if next_resume in seen_resume_ids:
            raise DrawboardError("Drawboard returned a repeated annotation page.")
        seen_resume_ids.add(next_resume)
        resume_on_page_id = next_resume


def _flatten_numbers(value: object) -> list[float]:
    if isinstance(value, (int, float)):
        return [float(value)]
    if isinstance(value, list):
        result: list[float] = []
        for item in value:
            result.extend(_flatten_numbers(item))
        return result
    return []


def _annotation_rect(annotation: dict[str, Any]) -> list[float]:
    vertices = _flatten_numbers(annotation.get("vertices"))
    if len(vertices) < 2:
        return []
    xs = vertices[0::2]
    ys = vertices[1::2]
    return [min(xs), min(ys), max(xs), max(ys)]


def _annotation_color(annotation: dict[str, Any]) -> tuple[str, list[float]]:
    raw = str(
        annotation.get("fillColor")
        or annotation.get("strokeColor")
        or ""
    ).strip().lstrip("#")
    if len(raw) == 8:
        raw = raw[2:]
    if len(raw) != 6 or not re.fullmatch(r"[a-fA-F0-9]{6}", raw):
        return "", []
    rgb = [int(raw[index : index + 2], 16) / 255 for index in (0, 2, 4)]
    red, green, blue = rgb
    if red >= 0.75 and green <= 0.55 and blue <= 0.65:
        return "red", rgb
    if red >= 0.85 and green >= 0.75 and blue <= 0.55:
        return "yellow", rgb
    if red <= 0.35 and green >= 0.75 and blue >= 0.75:
        return "cyan", rgb
    if green >= 0.55 and red <= 0.55:
        return "green", rgb
    if blue >= 0.55 and red <= 0.55:
        return "blue", rgb
    return "custom", rgb


def _timestamp(value: object) -> str:
    if isinstance(value, str) and value.strip():
        return value
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _capture(
    item: dict[str, Any],
    document_id: str,
    pages: dict[str, int],
) -> DrawboardCapture | None:
    raw_annotation = item.get("annotation")
    annotation = (
        cast(dict[str, Any], raw_annotation)
        if isinstance(raw_annotation, dict)
        else item
    )
    annotation_kind = str(annotation.get("type") or "")
    content = re.sub(r"\s+", " ", str(annotation.get("content") or "")).strip()
    if annotation_kind not in TEXT_ANNOTATION_TYPES or not content:
        return None
    annotation_id = str(
        annotation.get("annotationId")
        or item.get("id")
        or ""
    )
    if not annotation_id:
        return None
    page_id = str(annotation.get("pageId") or item.get("pageId") or "")
    page = pages.get(
        page_id,
        _as_int(annotation.get("resourcePageNo") or annotation.get("pageNumber"), 1),
    )
    color, rgb = _annotation_color(annotation)
    is_markup = annotation_kind in TEXT_MARKUP_TYPES
    is_question = (
        color == "red"
        or content.rstrip().endswith("?")
        or "??" in content
        or "todo!" in content.casefold()
    )
    source_revision = str(
        item.get("revision") or annotation.get("revision") or ""
    )
    if not source_revision:
        source_revision = hashlib.sha1(
            json.dumps(
                annotation,
                ensure_ascii=True,
                sort_keys=True,
            ).encode("utf-8"),
            usedforsecurity=False,
        ).hexdigest()
    return DrawboardCapture(
        fingerprint=f"drawboard-{document_id}-{annotation_id}",
        source_revision=source_revision,
        page=page,
        annotation_kind=annotation_kind,
        color=color,
        rgb=rgb,
        quote=content if is_markup else "",
        comment="" if is_markup else content,
        is_question=is_question,
        created_at=_timestamp(annotation.get("created") or item.get("created")),
        rect=_annotation_rect(annotation),
    )


def _ink_capture(
    item: dict[str, Any],
    document_id: str,
    pages: dict[str, int],
) -> DrawboardInk | None:
    raw_annotation = item.get("annotation")
    annotation = (
        cast(dict[str, Any], raw_annotation)
        if isinstance(raw_annotation, dict)
        else item
    )
    if str(annotation.get("type") or "") != "Ink":
        return None
    color, rgb = _annotation_color(annotation)
    ink_vertices = annotation.get("inkVertices")
    if color != "red" or not isinstance(ink_vertices, list):
        return None
    annotation_id = str(annotation.get("annotationId") or item.get("id") or "")
    if not annotation_id:
        return None
    page_id = str(annotation.get("pageId") or item.get("pageId") or "")
    page = pages.get(
        page_id,
        _as_int(annotation.get("resourcePageNo") or annotation.get("pageNumber"), 1),
    )
    vertices = _flatten_numbers(ink_vertices)
    rect = []
    if len(vertices) >= 4:
        rect = [
            min(vertices[0::2]),
            min(vertices[1::2]),
            max(vertices[0::2]),
            max(vertices[1::2]),
        ]
    source_revision = str(
        item.get("revision") or annotation.get("revision") or ""
    )
    if not source_revision:
        source_revision = hashlib.sha1(
            json.dumps(
                annotation,
                ensure_ascii=True,
                sort_keys=True,
            ).encode("utf-8"),
            usedforsecurity=False,
        ).hexdigest()
    fingerprint = f"drawboard-{document_id}-{annotation_id}"
    return DrawboardInk(
        fingerprint=fingerprint,
        source_revision=source_revision,
        page=page,
        color=color,
        rgb=rgb,
        created_at=_timestamp(annotation.get("created") or item.get("created")),
        rect=rect,
        ink_vertex_sets=(ink_vertices,),
        member_fingerprints=(fingerprint,),
    )


def _ink_vertical_bounds(ink: DrawboardInk) -> tuple[float, float] | None:
    if len(ink.rect) != 4:
        return None
    return min(ink.rect[1], ink.rect[3]), max(ink.rect[1], ink.rect[3])


def _ink_horizontal_span(ink: DrawboardInk) -> float:
    if len(ink.rect) != 4:
        return 0.0
    return abs(ink.rect[2] - ink.rect[0])


def _ink_vertical_span(ink: DrawboardInk) -> float:
    bounds = _ink_vertical_bounds(ink)
    return 0.0 if bounds is None else bounds[1] - bounds[0]


def _is_vertical_guide(ink: DrawboardInk) -> bool:
    height = _ink_vertical_span(ink)
    width = _ink_horizontal_span(ink)
    return (
        height >= INK_VERTICAL_GUIDE_MIN_HEIGHT
        and height >= max(width, 1.0) * INK_VERTICAL_GUIDE_ASPECT_RATIO
    )


def _vertical_ranges_overlap(
    first: tuple[float, float],
    second: tuple[float, float],
    *,
    tolerance: float,
) -> bool:
    return (
        first[0] <= second[1] + tolerance
        and second[0] <= first[1] + tolerance
    )


def _group_anchor(members: list[DrawboardInk]) -> DrawboardInk:
    # The deliberately drawn vertical line should be the tallest/narrowest
    # member. Using it as the identity keeps the group stable when the user
    # adds or removes handwritten strokes around it.
    return max(
        members,
        key=lambda ink: (
            _is_vertical_guide(ink),
            _ink_vertical_span(ink),
            -_ink_horizontal_span(ink),
            ink.fingerprint,
        ),
    )


def _group_source_revision(members: list[DrawboardInk]) -> str:
    payload = [
        {
            "fingerprint": ink.fingerprint,
            "rect": [round(value, 3) for value in ink.rect],
            "revision": ink.source_revision,
        }
        for ink in sorted(members, key=lambda item: item.fingerprint)
    ]
    return hashlib.sha1(
        json.dumps(payload, ensure_ascii=True, sort_keys=True).encode("utf-8"),
        usedforsecurity=False,
    ).hexdigest()


def _merge_red_ink_group(members: list[DrawboardInk]) -> DrawboardInk:
    ordered = sorted(
        members,
        key=lambda ink: (
            ink.rect[1] if len(ink.rect) == 4 else 0.0,
            ink.rect[0] if len(ink.rect) == 4 else 0.0,
            ink.fingerprint,
        ),
    )
    if len(ordered) == 1:
        return ordered[0]

    anchor = _group_anchor(ordered)
    valid_rects = [ink.rect for ink in ordered if len(ink.rect) == 4]
    rect = (
        [
            min(item[0] for item in valid_rects),
            min(item[1] for item in valid_rects),
            max(item[2] for item in valid_rects),
            max(item[3] for item in valid_rects),
        ]
        if valid_rects
        else []
    )
    vertex_sets = tuple(
        vertex_set
        for ink in ordered
        for vertex_set in ink.ink_vertex_sets
    )
    member_fingerprints = tuple(
        sorted(
            fingerprint
            for ink in ordered
            for fingerprint in ink.member_fingerprints
        )
    )
    return DrawboardInk(
        fingerprint=anchor.fingerprint,
        source_revision=_group_source_revision(ordered),
        page=anchor.page,
        color=anchor.color,
        rgb=anchor.rgb,
        created_at=min(ink.created_at for ink in ordered),
        rect=rect,
        ink_vertex_sets=vertex_sets,
        member_fingerprints=member_fingerprints,
    )


def group_red_ink_annotations(
    inks: list[DrawboardInk],
    *,
    tolerance: float = INK_VERTICAL_OVERLAP_TOLERANCE,
) -> list[DrawboardInk]:
    """Merge red handwritten strokes into page-local vertical bands.

    Drawboard may expose handwriting as many independent Ink annotations. The
    user draws a red vertical guide beside the paragraph; every red stroke whose
    vertical range overlaps the current band joins the same group. The band is
    expanded transitively, so the guide can connect several handwritten lines.
    Each source stroke is consumed exactly once.
    """

    grouped: list[DrawboardInk] = []
    by_page: dict[int, list[DrawboardInk]] = {}
    for ink in inks:
        by_page.setdefault(ink.page, []).append(ink)

    for page in sorted(by_page):
        remaining = sorted(
            by_page[page],
            key=lambda ink: (
                ink.rect[1] if len(ink.rect) == 4 else 0.0,
                ink.rect[0] if len(ink.rect) == 4 else 0.0,
                ink.fingerprint,
            ),
        )
        while remaining:
            seed = remaining.pop(0)
            seed_bounds = _ink_vertical_bounds(seed)
            if seed_bounds is None:
                grouped.append(seed)
                continue

            members = [seed]
            band = seed_bounds
            changed = True
            while changed:
                changed = False
                still_remaining: list[DrawboardInk] = []
                for candidate in remaining:
                    candidate_bounds = _ink_vertical_bounds(candidate)
                    if candidate_bounds is not None and _vertical_ranges_overlap(
                        band,
                        candidate_bounds,
                        tolerance=tolerance,
                    ):
                        members.append(candidate)
                        band = (
                            min(band[0], candidate_bounds[0]),
                            max(band[1], candidate_bounds[1]),
                        )
                        changed = True
                    else:
                        still_remaining.append(candidate)
                remaining = still_remaining

            grouped.append(_merge_red_ink_group(members))

    grouped.sort(
        key=lambda ink: (
            ink.page,
            ink.rect[1] if len(ink.rect) == 4 else 0.0,
            ink.rect[0] if len(ink.rect) == 4 else 0.0,
        )
    )
    return grouped


def extract_drawboard_annotations(source_url: str) -> DrawboardExtraction:
    credentials = _credentials_for_share_url(source_url)
    access_token = _anonymous_access_token(credentials)
    document_payload = _request_json(
        f"{DRAWBOARD_API_BASE}/documents/{credentials.document_id}",
        access_token=access_token,
    )
    pages = _page_numbers(document_payload)
    raw_annotations = _annotation_batches(credentials.document_id, access_token)
    captures: list[DrawboardCapture] = []
    red_ink: list[DrawboardInk] = []
    ignored: dict[str, int] = {}
    for item in raw_annotations:
        raw_annotation = item.get("annotation")
        annotation = (
            cast(dict[str, Any], raw_annotation)
            if isinstance(raw_annotation, dict)
            else item
        )
        annotation_kind = str(annotation.get("type") or "Unknown")
        if annotation_kind == "Ink":
            ink = _ink_capture(item, credentials.document_id, pages)
            if ink is not None:
                red_ink.append(ink)
            else:
                ignored[annotation_kind] = ignored.get(annotation_kind, 0) + 1
            continue
        capture = _capture(item, credentials.document_id, pages)
        if capture is None:
            ignored[annotation_kind] = ignored.get(annotation_kind, 0) + 1
        else:
            captures.append(capture)
    captures.sort(
        key=lambda capture: (
            capture.page,
            capture.rect[1] if capture.rect else 0,
            capture.rect[0] if capture.rect else 0,
            capture.annotation_kind,
        )
    )
    red_ink = group_red_ink_annotations(red_ink)
    return DrawboardExtraction(
        source_url=source_url,
        document_id=credentials.document_id,
        captures=captures,
        red_ink=red_ink,
        ignored=ignored,
    )
