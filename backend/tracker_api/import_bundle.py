from __future__ import annotations

import argparse
from pathlib import Path

from .services.import_service import import_normalized_bundle


def main() -> None:
    parser = argparse.ArgumentParser(description="Import a normalized Study Tracker v2 bundle.")
    parser.add_argument("bundle", type=Path, help="Path to a normalized v2 JSON bundle")
    args = parser.parse_args()
    result = import_normalized_bundle(args.bundle)
    print(result.model_dump_json(indent=2))


if __name__ == "__main__":
    main()
