from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.engine import Connection

from .config import get_settings


@lru_cache
def get_engine() -> Engine:
    engine = create_engine(
        get_settings().database_url,
        connect_args={"check_same_thread": False},
        future=True,
    )

    @event.listens_for(engine, "connect")
    def configure_sqlite(dbapi_connection: object, _connection_record: object) -> None:
        cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.execute("PRAGMA journal_mode = WAL")
        cursor.execute("PRAGMA synchronous = NORMAL")
        cursor.execute("PRAGMA busy_timeout = 5000")
        cursor.close()

    return engine


@contextmanager
def connection() -> Iterator[Connection]:
    with get_engine().connect() as active_connection:
        yield active_connection


@contextmanager
def transaction() -> Iterator[Connection]:
    with get_engine().begin() as active_connection:
        yield active_connection
