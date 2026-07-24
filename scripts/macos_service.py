#!/usr/bin/env python3
"""Install and control the tracker as one low-overhead macOS launchd service."""

from __future__ import annotations

import argparse
import os
import plistlib
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

LABEL = "com.eugene.study-tracker"
ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
PYTHON = BACKEND / ".venv" / "bin" / "python"
FRONTEND_INDEX = ROOT / "frontend" / "dist" / "index.html"
LOG_DIR = ROOT / "data" / "logs"
PLIST_PATH = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
DOMAIN = f"gui/{os.getuid()}"
TARGET = f"{DOMAIN}/{LABEL}"
HEALTH_URL = "http://127.0.0.1:8787/api/health"


class ServiceError(RuntimeError):
    """Raised when the launchd service cannot be managed safely."""


def plist_payload() -> dict[str, Any]:
    return {
        "Label": LABEL,
        "ProgramArguments": [str(PYTHON), "-m", "tracker_api.main"],
        "WorkingDirectory": str(BACKEND),
        "EnvironmentVariables": {
            "PATH": (
                "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:"
                "/usr/sbin:/sbin"
            ),
        },
        "RunAtLoad": True,
        "KeepAlive": True,
        "ProcessType": "Background",
        "ThrottleInterval": 5,
        "StandardOutPath": str(LOG_DIR / "tracker.stdout.log"),
        "StandardErrorPath": str(LOG_DIR / "tracker.stderr.log"),
    }


def plist_bytes() -> bytes:
    return plistlib.dumps(plist_payload(), fmt=plistlib.FMT_XML, sort_keys=True)


def run_launchctl(*arguments: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["launchctl", *arguments],
        check=check,
        text=True,
    )


def is_loaded() -> bool:
    result = subprocess.run(
        ["launchctl", "print", TARGET],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return result.returncode == 0


def validate_runtime() -> None:
    if not PYTHON.is_file():
        raise ServiceError("Python environment is missing. Run `make install` first.")
    if not FRONTEND_INDEX.is_file():
        raise ServiceError("Frontend build is missing. Run `make build` first.")


def write_plist() -> None:
    PLIST_PATH.parent.mkdir(parents=True, exist_ok=True)
    PLIST_PATH.write_bytes(plist_bytes())


def start() -> None:
    validate_runtime()
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    if not PLIST_PATH.is_file():
        write_plist()
    loaded = is_loaded()
    if not loaded:
        run_launchctl("bootstrap", DOMAIN, str(PLIST_PATH))
    run_launchctl("enable", TARGET)
    if loaded:
        run_launchctl("kickstart", TARGET)
    print(f"Started {LABEL}.")


def stop() -> None:
    if is_loaded():
        run_launchctl("bootout", TARGET)
        print(f"Stopped {LABEL}.")
    else:
        print(f"{LABEL} is already stopped.")


def install() -> None:
    validate_runtime()
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    if is_loaded():
        run_launchctl("bootout", TARGET)
    write_plist()
    run_launchctl("bootstrap", DOMAIN, str(PLIST_PATH))
    run_launchctl("enable", TARGET)
    print(f"Installed and started {LABEL}.")
    print(f"Plist: {PLIST_PATH}")


def restart() -> None:
    validate_runtime()
    if not is_loaded():
        start()
        return
    run_launchctl("kickstart", "-k", TARGET)
    print(f"Restarted {LABEL}.")


def uninstall() -> None:
    stop()
    if PLIST_PATH.exists():
        PLIST_PATH.unlink()
    print(f"Removed {PLIST_PATH}.")


def health() -> bool:
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=2.0) as response:
            body = response.read().decode("utf-8", errors="replace")
    except (OSError, urllib.error.URLError):
        print(f"HTTP health: unavailable ({HEALTH_URL})")
        return False
    print(f"HTTP health: {response.status} {body}")
    return response.status == 200


def status() -> None:
    loaded = is_loaded()
    print(f"launchd: {'loaded' if loaded else 'not loaded'} ({TARGET})")
    print(f"plist: {'installed' if PLIST_PATH.is_file() else 'missing'} ({PLIST_PATH})")
    if loaded:
        run_launchctl("print", TARGET)
    health()


def render(output: Path | None) -> None:
    payload = plist_bytes()
    if output is None:
        sys.stdout.buffer.write(payload)
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(payload)
    print(output)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("install", "start", "stop", "restart", "status", "uninstall"):
        subparsers.add_parser(command)
    render_parser = subparsers.add_parser("render")
    render_parser.add_argument("--output", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.command == "install":
            install()
        elif args.command == "start":
            start()
        elif args.command == "stop":
            stop()
        elif args.command == "restart":
            restart()
        elif args.command == "status":
            status()
        elif args.command == "uninstall":
            uninstall()
        elif args.command == "render":
            render(args.output)
        else:
            raise AssertionError(f"Unhandled command: {args.command}")
    except (OSError, subprocess.CalledProcessError, ServiceError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
