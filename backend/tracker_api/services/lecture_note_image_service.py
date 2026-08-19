from __future__ import annotations

import hashlib
import sqlite3
from dataclasses import dataclass
from typing import cast

import pymupdf
from sqlalchemy.engine import Connection

from ..config import get_settings
from ..repositories import workspace_repository
from ..schemas.workspace import AnnotationAnchorCreate, AnnotationCreateCommand
from .pdf_ink_image_service import annotation_image_path, annotation_image_url

IMAGE_PASTEBOARD_TYPES = (
    "public.png",
    "public.jpeg",
    "public.jpg",
    "public.tiff",
    "public.heic",
)
MAX_IMAGE_BYTES = 30 * 1024 * 1024


class LectureNoteImageError(RuntimeError):
    """Raised when lecture-note pictures cannot be imported safely."""


@dataclass(frozen=True, slots=True)
class ImportedImageQuestions:
    imported: int
    duplicates: int
    annotation_ids: list[str]


def _maccy_read_error(error: sqlite3.Error) -> LectureNoteImageError:
    message = str(error)
    normalized = message.casefold()
    if any(
        fragment in normalized
        for fragment in ("authorization denied", "not authorized", "unable to open")
    ):
        return LectureNoteImageError(
            "macOS denied access to Maccy history. Grant Full Disk Access to the "
            "application that starts the tracker, restart that application and the "
            "tracker, or use Choose pictures instead."
        )
    return LectureNoteImageError(f"Could not read Maccy history: {message}")


def _quoted(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _table_columns(connection: sqlite3.Connection, table: str) -> dict[str, str]:
    rows = connection.execute(f"PRAGMA table_info({_quoted(table)})").fetchall()
    return {str(row[1]).upper(): str(row[1]) for row in rows}


def _find_table(
    connection: sqlite3.Connection,
    *,
    required_columns: tuple[str, ...],
) -> tuple[str, dict[str, str]]:
    tables = [
        str(row[0])
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
        ).fetchall()
    ]
    for table in tables:
        columns = _table_columns(connection, table)
        if all(column in columns for column in required_columns):
            return table, columns
    raise LectureNoteImageError(
        "Maccy's clipboard database format is not recognized by this tracker version."
    )


def recent_maccy_images(count: int) -> list[bytes]:
    """Read the most recent distinct image items from Maccy's local history."""

    database_path = get_settings().maccy_database_path.expanduser()
    if not database_path.is_file():
        raise LectureNoteImageError(
            f"Maccy history was not found at {database_path}. "
            "Open Maccy once or configure TRACKER_MACCY_DATABASE_PATH."
        )
    try:
        database = sqlite3.connect(
            f"{database_path.resolve().as_uri()}?mode=ro",
            uri=True,
            timeout=5,
        )
    except sqlite3.OperationalError as error:
        raise _maccy_read_error(error) from error

    try:
        item_table, item_columns = _find_table(
            database,
            required_columns=("Z_PK", "ZLASTCOPIEDAT"),
        )
        content_table, content_columns = _find_table(
            database,
            required_columns=("ZITEM", "ZTYPE", "ZVALUE"),
        )
        placeholders = ", ".join("?" for _ in IMAGE_PASTEBOARD_TYPES)
        query = f"""
            SELECT
              i.{_quoted(item_columns['Z_PK'])} AS item_id,
              c.{_quoted(content_columns['ZTYPE'])} AS content_type,
              c.{_quoted(content_columns['ZVALUE'])} AS content_value
            FROM {_quoted(item_table)} i
            JOIN {_quoted(content_table)} c
              ON c.{_quoted(content_columns['ZITEM'])}
               = i.{_quoted(item_columns['Z_PK'])}
            WHERE c.{_quoted(content_columns['ZTYPE'])} IN ({placeholders})
              AND c.{_quoted(content_columns['ZVALUE'])} IS NOT NULL
            ORDER BY i.{_quoted(item_columns['ZLASTCOPIEDAT'])} DESC,
                     CASE c.{_quoted(content_columns['ZTYPE'])}
                       WHEN 'public.png' THEN 0
                       WHEN 'public.jpeg' THEN 1
                       WHEN 'public.jpg' THEN 2
                       WHEN 'public.tiff' THEN 3
                       ELSE 4
                     END
        """
        rows = database.execute(query, IMAGE_PASTEBOARD_TYPES).fetchall()
    except sqlite3.DatabaseError as error:
        raise _maccy_read_error(error) from error
    finally:
        database.close()

    images: list[bytes] = []
    seen_items: set[int] = set()
    for item_id, _content_type, value in rows:
        numeric_id = int(item_id)
        if numeric_id in seen_items:
            continue
        seen_items.add(numeric_id)
        images.append(bytes(cast(bytes | memoryview, value)))
        if len(images) >= count:
            break
    if not images:
        raise LectureNoteImageError(
            "No images were found in Maccy's recent clipboard history."
        )
    return images


def _normalized_png(data: bytes) -> bytes:
    if not data:
        raise LectureNoteImageError("An imported picture is empty.")
    if len(data) > MAX_IMAGE_BYTES:
        raise LectureNoteImageError("An imported picture is larger than 30 MB.")
    try:
        pixmap = pymupdf.Pixmap(data)  # type: ignore[no-untyped-call]
        if pixmap.colorspace is None:
            raise LectureNoteImageError("The imported picture has no color space.")
        if pixmap.colorspace.n not in {1, 3}:
            pixmap = pymupdf.Pixmap(  # type: ignore[no-untyped-call]
                pymupdf.csRGB,
                pixmap,
            )
        return bytes(pixmap.tobytes("png"))  # type: ignore[no-untyped-call]
    except (RuntimeError, ValueError) as error:
        raise LectureNoteImageError(
            "One clipboard item is not a supported PNG, JPEG, TIFF, or HEIC picture."
        ) from error


def import_image_questions(
    connection: Connection,
    *,
    resource_id: str,
    image_payloads: list[bytes],
    source: str,
    source_day_id: str | None,
    source_task_id: str | None,
) -> ImportedImageQuestions:
    annotation_ids: list[str] = []
    imported = 0
    duplicates = 0
    for ordinal, payload in enumerate(image_payloads, start=1):
        png = _normalized_png(payload)
        digest = hashlib.sha256(png).hexdigest()
        image_id = f"lecture-note-{digest[:40]}"
        fingerprint = f"lecture-note-image:{digest}"
        path = annotation_image_path(resource_id, image_id)
        existed = path.is_file()
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            if not existed:
                path.write_bytes(png)
        except OSError as error:
            raise LectureNoteImageError(
                f"Could not save an imported lecture-note picture: {error}"
            ) from error

        metadata: dict[str, object] = {
            "captureSource": "maccy_history" if source == "maccy" else "image_upload",
            "contextImageUrl": annotation_image_url(resource_id, image_id),
            "imageDigest": digest,
            "imageOrdinal": ordinal,
            "sourceLabel": "Lecture notes screenshot",
        }
        if source_day_id:
            metadata["createdDayId"] = source_day_id
        if source_task_id:
            metadata["createdTaskId"] = source_task_id
        result = workspace_repository.create_annotation(
            connection,
            AnnotationCreateCommand(
                resource_id=resource_id,
                kind="question",
                priority="normal",
                origin="lecture_note_image",
                source_fingerprint=fingerprint,
                markdown="Lecture notes screenshot",
                plain_text="Lecture notes screenshot",
                anchor=AnnotationAnchorCreate(
                    anchor_type="image",
                    annotation_kind="Image",
                    color="red",
                    metadata=metadata,
                ),
            ),
        )
        annotation_ids.append(result.id)
        if existed:
            duplicates += 1
        else:
            imported += 1
    return ImportedImageQuestions(
        imported=imported,
        duplicates=duplicates,
        annotation_ids=annotation_ids,
    )
