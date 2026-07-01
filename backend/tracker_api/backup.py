from __future__ import annotations

import argparse
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from .config import get_settings


def backup_database(output_path: Path | None = None) -> Path:
    source_path = get_settings().database_path.expanduser().resolve()
    if not source_path.exists():
        raise FileNotFoundError(f"Tracker database does not exist: {source_path}")

    if output_path is None:
        timestamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
        destination = (
            source_path.parent
            / "backups"
            / f"{source_path.stem}-{timestamp}{source_path.suffix}"
        )
    else:
        destination = output_path.expanduser().resolve()
    if destination == source_path:
        raise ValueError("Backup destination must differ from the live database.")
    destination.parent.mkdir(parents=True, exist_ok=True)

    with (
        sqlite3.connect(source_path) as source,
        sqlite3.connect(destination) as target,
    ):
        source.backup(target)
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
