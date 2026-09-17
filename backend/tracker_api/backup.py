from __future__ import annotations

import argparse
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

from .config import get_settings


def backup_database(output_path: Path | None = None) -> Path:
    source_path = get_settings().database_path.expanduser().resolve()
    if not source_path.exists():
        raise FileNotFoundError(f"Tracker database does not exist: {source_path}")

    if output_path is None:
        timestamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S-%f")
        destination = (
            source_path.parent / "backups" / f"{source_path.stem}-{timestamp}{source_path.suffix}"
        )
    else:
        destination = output_path.expanduser().resolve()
    if destination == source_path:
        raise ValueError("Backup destination must differ from the live database.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Reserve the filename atomically; two callers cannot overwrite one another.
    destination.touch(exist_ok=False)
    try:
        with (
            closing(sqlite3.connect(f"{source_path.as_uri()}?mode=rw", uri=True)) as source,
            closing(sqlite3.connect(destination)) as target,
        ):
            # A checkpointed WAL database may have no sidecar files. SQLite
            # must be able to initialize those even though backup issues no
            # writes to the source's study tables. mode=rw still forbids creation.
            source.backup(target)
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create a consistent SQLite backup of the React tracker.",
    )
    parser.add_argument(
        "output",
        nargs="?",
        type=Path,
        help="Optional destination path; defaults to react_tracker/data/backups/.",
    )
    args = parser.parse_args()
    print(backup_database(args.output))


if __name__ == "__main__":
    main()
