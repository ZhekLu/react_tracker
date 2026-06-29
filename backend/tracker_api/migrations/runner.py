from __future__ import annotations

import hashlib
import re
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path

from ..config import get_settings

MIGRATIONS_DIR = Path(__file__).parent
MIGRATION_PATTERN = re.compile(r"^(?P<version>\d{4})_(?P<name>[a-z0-9_]+)\.sql$")


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    path: Path
    checksum: str
    sql: str


def discover_migrations() -> list[Migration]:
    migrations: list[Migration] = []
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        match = MIGRATION_PATTERN.match(path.name)
        if match is None:
            continue
        sql = path.read_text(encoding="utf-8")
        migrations.append(
            Migration(
                version=int(match.group("version")),
                name=match.group("name"),
                path=path,
                checksum=hashlib.sha256(sql.encode("utf-8")).hexdigest(),
                sql=sql,
            )
        )
    return migrations


def _connect() -> sqlite3.Connection:
    database_path = get_settings().database_path
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path)
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = NORMAL")
    connection.execute("PRAGMA busy_timeout = 5000")
    return connection


def _sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def run_migrations() -> list[Migration]:
    applied: list[Migration] = []
    with _connect() as database:
        database.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
              version INTEGER PRIMARY KEY,
              name TEXT NOT NULL UNIQUE,
              checksum TEXT NOT NULL,
              applied_at TEXT NOT NULL,
              execution_ms INTEGER NOT NULL
            )
            """
        )
        current = {
            int(row[0]): (str(row[1]), str(row[2]))
            for row in database.execute(
                "SELECT version, name, checksum FROM schema_migrations ORDER BY version"
            )
        }

        for migration in discover_migrations():
            existing = current.get(migration.version)
            if existing is not None:
                if existing != (migration.name, migration.checksum):
                    raise RuntimeError(
                        f"Migration {migration.version:04d} was modified after application."
                    )
                continue

            started = time.perf_counter()
            try:
                ledger_insert = f"""
                    INSERT INTO schema_migrations
                      (version, name, checksum, applied_at, execution_ms)
                    VALUES
                      (
                        {migration.version},
                        {_sql_literal(migration.name)},
                        {_sql_literal(migration.checksum)},
                        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                        0
                      );
                """
                database.executescript(
                    f"BEGIN IMMEDIATE;\n{migration.sql}\n{ledger_insert}\nCOMMIT;"
                )
                execution_ms = round((time.perf_counter() - started) * 1000)
                database.execute(
                    "UPDATE schema_migrations SET execution_ms = ? WHERE version = ?",
                    (execution_ms, migration.version),
                )
                database.commit()
            except Exception:
                database.rollback()
                raise
            applied.append(migration)
    return applied
