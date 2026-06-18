from __future__ import annotations

import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from .db import DB_PATH, connect, initialize, rows_to_dicts


HOST = "127.0.0.1"
PORT = 8787


class TrackerHandler(BaseHTTPRequestHandler):
    server_version = "ReactStudyTracker/0.1"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self.send_json({"ok": True, "database": str(DB_PATH)})
            return
        if parsed.path == "/api/courses":
            with connect() as connection:
                rows = connection.execute(
                    "SELECT id, title, short_code, accent, source_path FROM courses ORDER BY title"
                ).fetchall()
            self.send_json({"courses": rows_to_dicts(rows)})
            return
        if parsed.path == "/api/dumps":
            with connect() as connection:
                dump_rows = connection.execute(
                    """
                    SELECT id, source_path, schema_version, app_version, imported_at
                    FROM tracker_dumps
                    ORDER BY imported_at DESC
                    """
                ).fetchall()
                plan_rows = connection.execute(
                    """
                    SELECT dump_id, plan_id, day_count, resource_count, annotation_count,
                           discussion_count, exam_state_count
                    FROM plan_snapshots
                    ORDER BY plan_id
                    """
                ).fetchall()
            plans_by_dump: dict[str, list[dict[str, object]]] = {}
            for row in rows_to_dicts(plan_rows):
                plans_by_dump.setdefault(str(row["dump_id"]), []).append(row)
            dumps = []
            for row in rows_to_dicts(dump_rows):
                row["plans"] = plans_by_dump.get(str(row["id"]), [])
                dumps.append(row)
            self.send_json({"dumps": dumps})
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Unknown endpoint")

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/dev/seed":
            self.seed_development_data()
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Unknown endpoint")

    def seed_development_data(self) -> None:
        with connect() as connection:
            connection.execute(
                """
                INSERT INTO courses (id, title, short_code, accent, source_path)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  title = excluded.title,
                  short_code = excluded.short_code,
                  accent = excluded.accent,
                  source_path = excluded.source_path,
                  updated_at = CURRENT_TIMESTAMP
                """,
                (
                    "big_data",
                    "Big Data Exam Sprint",
                    "BigData",
                    "#2e6fbb",
                    "../study_plans/big_data/Big_Data_Exam_Sprint_Plan_2026-06-09_to_2026-06-23.md",
                ),
            )
        self.send_json({"ok": True})

    def send_json(self, payload: dict[str, object], status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "http://127.0.0.1:5174")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        print(f"{self.address_string()} - {format % args}")


def main() -> None:
    path = initialize()
    print(f"SQLite database ready: {path}")
    server = ThreadingHTTPServer((HOST, PORT), TrackerHandler)
    print(f"React tracker API listening on http://{HOST}:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
