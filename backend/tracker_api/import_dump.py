from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from .db import connect, initialize


def stable_dump_id(path: Path, payload: str) -> str:
    digest = hashlib.sha256()
    digest.update(str(path.resolve()).encode("utf-8"))
    digest.update(b"\0")
    digest.update(payload.encode("utf-8"))
    return f"dump-{digest.hexdigest()[:16]}"


def object_count(value: Any) -> int:
    if isinstance(value, (dict, list)):
        return len(value)
    return 0


def import_tracker_dump(path: Path) -> str:
    initialize()
    payload = path.read_text(encoding="utf-8")
    data = json.loads(payload)
    dump_id = stable_dump_id(path, payload)
    plans = data.get("plans") if isinstance(data, dict) else {}
    if not isinstance(plans, dict):
        raise ValueError("Expected dump JSON to contain a dict at top-level key 'plans'.")

    with connect() as connection:
        connection.execute(
            """
            INSERT INTO tracker_dumps (id, source_path, schema_version, app_version, payload_json)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              source_path = excluded.source_path,
              schema_version = excluded.schema_version,
              app_version = excluded.app_version,
              payload_json = excluded.payload_json,
              imported_at = CURRENT_TIMESTAMP
            """,
            (
                dump_id,
                str(path),
                str(data.get("schemaVersion", "")),
                str(data.get("version", "")),
                payload,
            ),
        )
        for plan_id, plan_payload in plans.items():
            if not isinstance(plan_payload, dict):
                continue
            connection.execute(
                """
                INSERT INTO plan_snapshots (
                  dump_id,
                  plan_id,
                  day_count,
                  resource_count,
                  annotation_count,
                  discussion_count,
                  exam_state_count,
                  payload_json
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(dump_id, plan_id) DO UPDATE SET
                  day_count = excluded.day_count,
                  resource_count = excluded.resource_count,
                  annotation_count = excluded.annotation_count,
                  discussion_count = excluded.discussion_count,
                  exam_state_count = excluded.exam_state_count,
                  payload_json = excluded.payload_json
                """,
                (
                    dump_id,
                    str(plan_id),
                    object_count(plan_payload.get("days")),
                    object_count(plan_payload.get("resources")),
                    object_count(plan_payload.get("annotations")),
                    object_count(plan_payload.get("discussions")),
                    object_count(plan_payload.get("exams")),
                    json.dumps(plan_payload, ensure_ascii=False, sort_keys=True),
                ),
            )
    return dump_id


def main() -> None:
    parser = argparse.ArgumentParser(description="Import a static tracker JSON export into SQLite.")
    parser.add_argument("dump", type=Path, help="Path to study-tracker export JSON")
    args = parser.parse_args()
    dump_id = import_tracker_dump(args.dump)
    print(dump_id)


if __name__ == "__main__":
    main()
