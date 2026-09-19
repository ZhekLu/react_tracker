from __future__ import annotations

import json
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.engine import Connection

CAPTURE_DEBUG_MODE_KEY = "capture_debug_mode"


def _now() -> str:
    return datetime.now(UTC).isoformat()


def capture_debug_mode(connection: Connection) -> bool:
    raw = connection.execute(
        text("SELECT value_json FROM app_preferences WHERE key = :key"),
        {"key": CAPTURE_DEBUG_MODE_KEY},
    ).scalar_one_or_none()
    if raw is None:
        return True
    try:
        value = json.loads(str(raw))
    except json.JSONDecodeError:
        return True
    return value if isinstance(value, bool) else True


def save_capture_debug_mode(connection: Connection, enabled: bool) -> bool:
    connection.execute(
        text("""
            INSERT INTO app_preferences (key, value_json, updated_at)
            VALUES (:key, :value_json, :updated_at)
            ON CONFLICT(key) DO UPDATE SET
              value_json = excluded.value_json,
              updated_at = excluded.updated_at
            """),
        {
            "key": CAPTURE_DEBUG_MODE_KEY,
            "value_json": json.dumps(enabled),
            "updated_at": _now(),
        },
    )
    return enabled


def capture_correction_count(connection: Connection) -> int:
    return int(
        connection.execute(
            text("SELECT COUNT(*) FROM capture_region_corrections")
        ).scalar_one()
    )
