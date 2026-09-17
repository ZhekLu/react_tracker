"""Export current editable documents and apply a reviewed, revision-guarded repair.

The frontend scanner supplies parser checks. No repair runs automatically on startup.
Historical snapshots and removed entities are never candidates.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import uuid
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .backup import backup_database
from .config import get_settings

ACTIVE_DOCUMENTS = """
SELECT d.id, d.markdown, d.revision FROM documents d
WHERE d.deleted_at IS NULL AND d.canonical_format = 'markdown' AND (
 EXISTS (SELECT 1 FROM notes n WHERE n.document_id=d.id AND n.deleted_at IS NULL)
 OR EXISTS (SELECT 1 FROM discussion_messages m
 JOIN discussion_threads t ON t.id=m.thread_id
 WHERE m.body_document_id=d.id AND m.deleted_at IS NULL AND t.deleted_at IS NULL)
 OR EXISTS (SELECT 1 FROM annotations a JOIN resources r ON r.id=a.resource_id
 WHERE a.body_document_id=d.id AND a.deleted_at IS NULL AND r.deleted_at IS NULL)
)
"""


def source_hash(markdown: str) -> str:
    return hashlib.sha256(markdown.encode()).hexdigest()


def snapshot() -> list[dict[str, Any]]:
    path = get_settings().database_path.resolve()
    with closing(sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True)) as db:
        db.row_factory = sqlite3.Row
        return [
            {**dict(row), "original_sha256": source_hash(row["markdown"] or "")}
            for row in db.execute(ACTIVE_DOCUMENTS)
        ]


def apply_repairs(rows: list[dict[str, Any]]) -> dict[str, Any]:
    repairs = [row for row in rows if row.get("reasons")]
    if not repairs:
        return {"repaired": 0, "backup": None}
    if len({row["id"] for row in repairs}) != len(repairs):
        raise ValueError("Duplicate document in repair plan.")
    for row in repairs:
        if row.get("checks") != [] or not isinstance(row.get("plain_text"), str):
            raise ValueError(f"Document {row['id']} has not passed the editor checks.")
        if not row.get("original_sha256") or not isinstance(row.get("markdown"), str):
            raise ValueError("Every repair needs original_sha256 and Markdown.")
    backup = backup_database()
    path = get_settings().database_path
    now = datetime.now(UTC).isoformat()
    with closing(sqlite3.connect(path, timeout=10)) as db, db:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("BEGIN IMMEDIATE")
        current = {row["id"]: row for row in db.execute(ACTIVE_DOCUMENTS)}
        # Validate the entire batch before the first write, under the write lock.
        for repair in repairs:
            existing = current.get(repair["id"])
            if (
                existing is None
                or existing["revision"] != repair["revision"]
                or source_hash(existing["markdown"] or "") != repair["original_sha256"]
            ):
                raise ValueError(f"Document changed or is no longer editable: {repair['id']}")
        for repair in repairs:
            document_id, markdown = repair["id"], repair["markdown"]
            plain_text = repair["plain_text"]
            digest = source_hash(
                json.dumps(
                    {"markdown": markdown, "editor_json": None, "plain_text": plain_text},
                    ensure_ascii=False,
                    sort_keys=True,
                )
            )
            revision = repair["revision"] + 1
            db.execute(
                """UPDATE documents SET markdown=?, editor_json=NULL, plain_text=?,
                content_hash=?, updated_at=?, revision=?,
                markdown_converter_version='tracker-inline-runs-v3' WHERE id=?""",
                (markdown, plain_text, digest, now, revision, document_id),
            )
            db.execute(
                """INSERT INTO document_revisions
                (id,document_id,revision_number,markdown,editor_json,plain_text,
                 content_hash,change_reason,created_at) VALUES (?,?,?,?,NULL,?,?,?,?)""",
                (
                    str(uuid.uuid4()),
                    document_id,
                    revision,
                    markdown,
                    plain_text,
                    digest,
                    "editor_audit_repair",
                    now,
                ),
            )
            # Preserve entity status, links, question labels and review markers.
            # Mirrored note/message content is audited in the same batch.
            for table, column in [
                ("notes", "document_id"),
                ("discussion_messages", "body_document_id"),
                ("annotations", "body_document_id"),
            ]:
                db.execute(
                    f"UPDATE {table} SET revision=revision+1, updated_at=? "
                    f"WHERE {column}=? AND deleted_at IS NULL",
                    (now, document_id),
                )
            db.execute(
                """UPDATE discussion_threads SET revision=revision+1, updated_at=?
                WHERE deleted_at IS NULL AND id IN (SELECT thread_id FROM discussion_messages
                WHERE body_document_id=? AND deleted_at IS NULL)""",
                (now, document_id),
            )
    return {
        "repaired": len(repairs),
        "backup": str(backup),
        "documents": [
            {"id": row["id"], "previous_revision": row["revision"], "reasons": row["reasons"]}
            for row in repairs
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["snapshot", "apply"])
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    if args.operation == "snapshot":
        args.path.write_text(json.dumps(snapshot(), ensure_ascii=False), encoding="utf8")
    else:
        rows = json.loads(args.path.read_text(encoding="utf8"))
        print(json.dumps(apply_repairs(rows), indent=2))


if __name__ == "__main__":
    main()
