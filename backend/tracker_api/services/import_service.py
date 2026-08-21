from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from pydantic import ValidationError
from sqlalchemy import Connection, inspect, text

from ..database import transaction
from ..migrations.runner import run_migrations
from ..schemas.imports import ImportTableResult, NormalizedBundle, NormalizedImportResult

IMPORTABLE_TABLES = frozenset(
    {
        "app_preferences",
        "courses",
        "study_days",
        "day_sections",
        "tasks",
        "skills",
        "day_skills",
        "resources",
        "resource_versions",
        "resource_reading_progress",
        "task_resources",
        "resource_relations",
        "exam_question_details",
        "documents",
        "document_revisions",
        "notes",
        "note_links",
        "annotations",
        "annotation_anchors",
        "assets",
        "document_assets",
        "annotation_assets",
        "question_identities",
        "annotation_question_identities",
        "prompt_batches",
        "prompt_batch_items",
        "discussion_threads",
        "discussion_messages",
        "discussion_message_annotations",
        "time_entries",
        "integration_sync_states",
        "plan_sources",
        "source_bindings",
        "import_runs",
        "tracker_dumps",
        "plan_snapshots",
        "tags",
        "resource_tags",
        "annotation_tags",
    }
)


class BundleImportError(ValueError):
    """Raised when a normalized bundle cannot be imported safely."""


def load_bundle(path: Path) -> NormalizedBundle:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        return NormalizedBundle.model_validate(payload)
    except (OSError, json.JSONDecodeError, ValidationError) as error:
        raise BundleImportError(f"Invalid normalized bundle at {path}: {error}") from error


def _database_value(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    if isinstance(value, bool):
        return int(value)
    return value


def _table_metadata(connection: Connection, table_name: str) -> tuple[set[str], list[str]]:
    inspector = inspect(connection)
    columns = {str(column["name"]) for column in inspector.get_columns(table_name)}
    primary_key = [
        str(column_name)
        for column_name in inspector.get_pk_constraint(table_name).get("constrained_columns", [])
    ]
    if not columns:
        raise BundleImportError(f"Target table does not exist: {table_name}")
    if not primary_key:
        raise BundleImportError(f"Target table has no primary key: {table_name}")
    return columns, primary_key


def _upsert_rows(
    connection: Connection,
    table_name: str,
    rows: list[dict[str, Any]],
) -> int:
    if not rows:
        return 0

    available_columns, primary_key = _table_metadata(connection, table_name)
    written = 0
    for row in rows:
        unknown_columns = set(row) - available_columns
        if unknown_columns:
            raise BundleImportError(
                f"{table_name} contains columns absent from the database: "
                f"{sorted(unknown_columns)}"
            )
        missing_primary_key = set(primary_key) - set(row)
        if missing_primary_key:
            raise BundleImportError(
                f"{table_name} row is missing primary key columns: {sorted(missing_primary_key)}"
            )

        column_names = list(row)
        quoted_columns = ", ".join(f'"{column}"' for column in column_names)
        placeholders = ", ".join(f":{column}" for column in column_names)
        conflict_target = ", ".join(f'"{column}"' for column in primary_key)
        mutable_columns = [column for column in column_names if column not in primary_key]
        if mutable_columns:
            update_clause = ", ".join(
                f'"{column}" = excluded."{column}"' for column in mutable_columns
            )
            conflict_clause = f"DO UPDATE SET {update_clause}"
        else:
            conflict_clause = "DO NOTHING"

        statement = text(
            f"""
            INSERT INTO "{table_name}" ({quoted_columns})
            VALUES ({placeholders})
            ON CONFLICT ({conflict_target}) {conflict_clause}
            """
        )
        connection.execute(
            statement,
            {column: _database_value(value) for column, value in row.items()},
        )
        written += 1
    return written


def import_normalized_bundle(path: Path) -> NormalizedImportResult:
    run_migrations()
    bundle = load_bundle(path)

    unknown_tables = set(bundle.load_order) - IMPORTABLE_TABLES
    if unknown_tables:
        raise BundleImportError(f"Bundle contains unsupported tables: {sorted(unknown_tables)}")

    results: list[ImportTableResult] = []
    with transaction() as active_connection:
        active_connection.execute(text("PRAGMA defer_foreign_keys = ON"))
        for table_name in bundle.load_order:
            rows = bundle.tables[table_name]
            written = _upsert_rows(active_connection, table_name, rows)
            results.append(
                ImportTableResult(
                    table=table_name,
                    input_rows=len(rows),
                    written_rows=written,
                )
            )

    return NormalizedImportResult(
        source_path=str(path.resolve()),
        bundle_version=bundle.bundle_version,
        tables=results,
        total_rows=sum(result.written_rows for result in results),
    )


def table_counts(connection: Connection) -> Mapping[str, int]:
    return {
        table_name: int(
            connection.execute(text(f'SELECT COUNT(*) FROM "{table_name}"')).scalar_one()
        )
        for table_name in sorted(IMPORTABLE_TABLES)
    }
