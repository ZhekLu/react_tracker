from __future__ import annotations

from collections.abc import Generator

from sqlalchemy.engine import Connection

from ..database import get_engine


def db_connection() -> Generator[Connection, None, None]:
    with get_engine().begin() as connection:
        yield connection
