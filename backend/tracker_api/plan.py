from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path

from .services.study_plan_parser import parse_study_plan
from .services.study_plan_service import (
    StudyPlanSyncError,
    inspect_plan_structure,
    sync_study_plan,
)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m tracker_api.plan",
        description="Validate, sync, patch, or inspect Study Plan v1 Markdown.",
    )
    subcommands = parser.add_subparsers(dest="command", required=True)

    validate = subcommands.add_parser(
        "validate",
        help="Validate a plan without changing SQLite.",
    )
    validate.add_argument("path", type=Path)
    validate.add_argument("--json", action="store_true", dest="as_json")

    sync = subcommands.add_parser(
        "sync",
        help="Create or update a course from a full Study Plan v1 file.",
    )
    sync.add_argument("path", type=Path)
    sync.add_argument("--json", action="store_true", dest="as_json")
    sync.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate through the real transaction, then roll back every change.",
    )

    patch = subcommands.add_parser(
        "patch",
        help="Apply only the explicitly identified entities in a patch file.",
    )
    patch.add_argument("path", type=Path)
    patch.add_argument("--json", action="store_true", dest="as_json")
    patch.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate through the real transaction, then roll back every change.",
    )

    inspect = subcommands.add_parser(
        "inspect",
        help="Print current day/task IDs for authoring a patch.",
    )
    inspect.add_argument("course")
    return parser


def _validate(path: Path, *, as_json: bool) -> int:
    result = parse_study_plan(path)
    if as_json:
        print(
            json.dumps(
                {
                    "ok": not result.errors,
                    "plan_id": result.plan.plan_id if result.plan else None,
                    "mode": result.plan.mode if result.plan else None,
                    "days": len(result.plan.days) if result.plan else 0,
                    "tasks": (
                        sum(
                            len(section.tasks)
                            for day in result.plan.days
                            for section in day.sections
                        )
                        if result.plan
                        else 0
                    ),
                    "resources": len(result.plan.resources) if result.plan else 0,
                    "skills": len(result.plan.skills) if result.plan else 0,
                    "diagnostics": [asdict(item) for item in result.diagnostics],
                },
                indent=2,
            )
        )
    else:
        for diagnostic in result.diagnostics:
            print(diagnostic.render())
        if result.plan is not None and not result.errors:
            task_count = sum(
                len(section.tasks) for day in result.plan.days for section in day.sections
            )
            print(
                f"OK {result.plan.plan_id}: "
                f"{len(result.plan.days)} days, {task_count} tasks, "
                f"{len(result.plan.resources)} resources, "
                f"{len(result.plan.skills)} skills"
            )
    return 1 if result.errors else 0


def _sync(path: Path, *, force_patch: bool, as_json: bool, dry_run: bool = False) -> int:
    try:
        result = sync_study_plan(path, force_patch=force_patch, dry_run=dry_run, backup=not dry_run)
    except StudyPlanSyncError as error:
        print(str(error))
        return 1
    if as_json:
        print(json.dumps(asdict(result), indent=2))
    else:
        for diagnostic in result.diagnostics:
            print(diagnostic.render())
        if result.backup_path:
            print(f"Backup: {result.backup_path}")
        print(
            f"{'PREVIEW (rolled back)' if result.dry_run else 'OK'} "
            f"{result.plan_id} ({result.mode}) -> {result.course_id}\n"
            f"{'Preview run' if result.dry_run else 'Import run'}: {result.import_run_id}\n"
            f"Changes: {json.dumps(result.counts, sort_keys=True)}"
        )
    return 0


def main() -> None:
    parser = _parser()
    args = parser.parse_args()
    if args.command == "validate":
        raise SystemExit(_validate(args.path, as_json=args.as_json))
    if args.command == "sync":
        raise SystemExit(
            _sync(args.path, force_patch=False, as_json=args.as_json, dry_run=args.dry_run)
        )
    if args.command == "patch":
        raise SystemExit(
            _sync(args.path, force_patch=True, as_json=args.as_json, dry_run=args.dry_run)
        )
    if args.command == "inspect":
        try:
            print(inspect_plan_structure(args.course), end="")
        except StudyPlanSyncError as error:
            print(str(error))
            raise SystemExit(1) from error
        return
    parser.error(f"Unknown command: {args.command}")


if __name__ == "__main__":
    main()
