from __future__ import annotations

import argparse
import json
from pathlib import Path

from .services.import_service import BundleImportError, import_normalized_bundle


def import_tracker_dump(path: Path) -> str:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or payload.get("bundle_version") != 1:
        raise BundleImportError(
            "import_dump now expects a normalized v2 bundle. "
            "Convert raw tracker exports with dump/convert_tracker_dump_to_v2.py first."
        )
    result = import_normalized_bundle(path)
    return f"imported {result.total_rows} rows from {result.source_path}"


def main() -> None:
    parser = argparse.ArgumentParser(description="Import a normalized v2 tracker bundle.")
    parser.add_argument("dump", type=Path, help="Path to normalized v2 tracker bundle JSON")
    args = parser.parse_args()
    print(import_tracker_dump(args.dump))


if __name__ == "__main__":
    main()
