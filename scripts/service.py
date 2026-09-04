#!/usr/bin/env python3
"""Control the tracker in a persistent, named tmux session."""

from __future__ import annotations

import argparse
import logging
import os
import shlex
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from logging.handlers import RotatingFileHandler
from pathlib import Path

SESSION = "study-tracker"
ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
PYTHON = BACKEND / ".venv" / "bin" / "python"
FRONTEND_INDEX = ROOT / "frontend" / "dist" / "index.html"
LOG_DIR = ROOT / "data" / "logs"
LOG_PATH = LOG_DIR / "tracker.log"
HEALTH_URL = "http://127.0.0.1:8787/api/health"
LOG_MAX_BYTES = int(os.getenv("TRACKER_LOG_MAX_BYTES", str(5 * 1024 * 1024)))
LOG_BACKUP_COUNT = int(os.getenv("TRACKER_LOG_BACKUP_COUNT", "4"))
LOG_LEVEL = os.getenv("TRACKER_LOG_LEVEL", "DEBUG").upper()


class ServiceError(RuntimeError):
    """Raised when the local tracker service cannot be managed safely."""


def tmux_path() -> str:
    executable = shutil.which("tmux")
    if executable is None:
        raise ServiceError("tmux is required. Install it with `brew install tmux`.")
    return executable


def run_tmux(
    *arguments: str,
    check: bool = True,
    capture_output: bool = False,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [tmux_path(), *arguments],
        check=check,
        text=True,
        capture_output=capture_output,
    )


def is_running() -> bool:
    result = run_tmux(
        "has-session",
        "-t",
        f"={SESSION}",
        check=False,
        capture_output=True,
    )
    return result.returncode == 0


def validate_runtime() -> None:
    if not PYTHON.is_file():
        raise ServiceError("Python environment is missing. Run `make install` first.")
    if not FRONTEND_INDEX.is_file():
        raise ServiceError("Frontend build is missing. Run `make build` first.")


def health(*, quiet: bool = False) -> bool:
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=2.0) as response:
            body = response.read().decode("utf-8", errors="replace")
    except (OSError, urllib.error.URLError):
        if not quiet:
            print(f"HTTP health: unavailable ({HEALTH_URL})")
        return False
    if not quiet:
        print(f"HTTP health: {response.status} {body}")
    return response.status == 200


def wait_for_health(timeout: float = 8.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if health(quiet=True):
            return True
        time.sleep(0.2)
    return False


def start() -> None:
    validate_runtime()
    if is_running():
        print(f"{SESSION} is already running.")
        health()
        return
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    script_path = Path(__file__).resolve()
    command = f"exec {shlex.quote(sys.executable)} {shlex.quote(str(script_path))} run"
    run_tmux(
        "new-session",
        "-d",
        "-s",
        SESSION,
        "-c",
        str(BACKEND),
        command,
    )
    if not wait_for_health():
        raise ServiceError(f"Tracker did not become healthy. Inspect {LOG_PATH}.")
    print(f"Started {SESSION} in tmux.")
    print("Open: http://127.0.0.1:8787")


def stop() -> None:
    if not is_running():
        print(f"{SESSION} is already stopped.")
        return
    run_tmux("send-keys", "-t", SESSION, "C-c")
    deadline = time.monotonic() + 5.0
    while is_running() and time.monotonic() < deadline:
        time.sleep(0.1)
    if is_running():
        run_tmux("kill-session", "-t", SESSION)
    print(f"Stopped {SESSION}.")


def restart() -> None:
    stop()
    start()


def status() -> None:
    if is_running():
        details = run_tmux(
            "display-message",
            "-p",
            "-t",
            SESSION,
            "#{session_name}: #{session_windows} window(s); created #{t:session_created}",
            capture_output=True,
        ).stdout.strip()
        print(f"tmux: running ({details})")
    else:
        print(f"tmux: stopped ({SESSION})")
    health()
    print(f"log: {LOG_PATH}")


def attach() -> None:
    if not is_running():
        raise ServiceError(f"{SESSION} is not running.")
    run_tmux("attach-session", "-t", SESSION)


def run_server() -> None:
    """Supervise the single app process inside tmux and restart after a crash."""

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    service_logger = logging.getLogger("tracker.service")
    service_logger.setLevel(getattr(logging, LOG_LEVEL, logging.DEBUG))
    service_logger.propagate = False
    if not service_logger.handlers:
        handler = RotatingFileHandler(
            LOG_PATH,
            maxBytes=LOG_MAX_BYTES,
            backupCount=LOG_BACKUP_COUNT,
            encoding="utf-8",
        )
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        service_logger.addHandler(handler)

    stopping = False
    child: subprocess.Popen[str] | None = None

    def request_stop(_signum: int, _frame: object) -> None:
        nonlocal stopping
        stopping = True
        if child is not None and child.poll() is None:
            child.send_signal(signal.SIGINT)

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)
    while not stopping:
        child = subprocess.Popen(
            [str(PYTHON), "-m", "tracker_api.main"],
            cwd=BACKEND,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            bufsize=1,
        )
        assert child.stdout is not None
        for raw_line in child.stdout:
            line = raw_line.rstrip("\n")
            if line.startswith("ERROR") or "Traceback (most recent call last)" in line:
                level = logging.ERROR
            elif line.startswith("WARNING"):
                level = logging.WARNING
            elif line.startswith("DEBUG"):
                level = logging.DEBUG
            else:
                level = logging.INFO
            service_logger.log(level, "%s", line)
        return_code = child.wait()
        child = None
        if stopping:
            break
        service_logger.error(
            "Tracker exited with code %s; restarting in 2 seconds.",
            return_code,
        )
        time.sleep(2.0)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=("start", "stop", "restart", "status", "attach", "run"),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.command == "start":
            start()
        elif args.command == "stop":
            stop()
        elif args.command == "restart":
            restart()
        elif args.command == "status":
            status()
        elif args.command == "attach":
            attach()
        elif args.command == "run":
            run_server()
        else:
            raise AssertionError(f"Unhandled command: {args.command}")
    except (OSError, subprocess.CalledProcessError, ServiceError) as error:
        print(f"error: {error}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
