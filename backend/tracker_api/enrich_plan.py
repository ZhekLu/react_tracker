from __future__ import annotations

import argparse
import json
from pathlib import Path

from .services.plan_enrichment_service import enrich_from_tracker_html


def main() -> None:
    parser = argparse.ArgumentParser(description="Enrich v2 state from generated tracker data.")
    parser.add_argument("tracker_html", type=Path, help="Path to the frozen generated tracker HTML")
    args = parser.parse_args()
    print(json.dumps(enrich_from_tracker_html(args.tracker_html), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
