from __future__ import annotations

import base64
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from ..config import get_settings

API_BASE = "https://api.track.toggl.com/api/v9"
DEFAULT_STATUS_CACHE_SECONDS = 600
DEFAULT_RATE_LIMIT_BACKOFF_SECONDS = 3600
DEFAULT_PLAN_PREFIXES = {
    "big_data": ["[BigData]"],
    "special_course": ["[SpecialCourse]"],
    "torl": ["[TORL]"],
}
_STATE_LOCK = threading.RLock()


class TogglServiceError(RuntimeError):
    """Raised when Toggl cannot complete a requested operation."""


class TogglConfigurationError(TogglServiceError):
    """Raised when the local Toggl configuration is incomplete."""


class TogglApiError(TogglServiceError):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(f"Toggl HTTP {status}: {detail}")
        self.status = status
        self.detail = detail


def _utc_now_iso() -> str:
    return (
        datetime.now(UTC)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z")
    )


def _parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _load_json(path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return fallback
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback
    return payload if isinstance(payload, dict) else fallback


def _save_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(
        json.dumps(data, indent=2, ensure_ascii=True),
        encoding="utf-8",
    )
    temporary.replace(path)


def _load_config() -> dict[str, Any]:
    path = get_settings().helper_config_path
    config = _load_json(path, {})
    required = ["api_token", "workspace_id", "project_id"]
    missing = [key for key in required if not config.get(key)]
    if missing:
        raise TogglConfigurationError(
            f"Missing {', '.join(missing)} in {path.name}"
        )
    return config


def _load_state() -> dict[str, Any]:
    return _load_json(get_settings().helper_state_path, {"current": None})


def _save_state(state: dict[str, Any]) -> None:
    _save_json(get_settings().helper_state_path, state)


def _config_int(
    config: dict[str, Any],
    key: str,
    default: int,
    minimum: int,
) -> int:
    try:
        value = int(config.get(key) or default)
    except (TypeError, ValueError):
        return default
    return max(minimum, value)


def _status_cache_seconds(config: dict[str, Any]) -> int:
    return _config_int(
        config,
        "status_cache_seconds",
        DEFAULT_STATUS_CACHE_SECONDS,
        300,
    )


def _rate_limit_backoff_seconds(config: dict[str, Any]) -> int:
    return _config_int(
        config,
        "rate_limit_backoff_seconds",
        DEFAULT_RATE_LIMIT_BACKOFF_SECONDS,
        300,
    )


def _invalidate_status_cache(state: dict[str, Any]) -> None:
    state.pop("status_cache", None)


def _auth_header(api_token: str) -> str:
    raw = f"{api_token}:api_token".encode()
    return "Basic " + base64.b64encode(raw).decode("ascii")


def _toggl_request(
    config: dict[str, Any],
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
) -> Any:
    # Separate from the status file: callers hold an older copy of that file while
    # making requests. Persist the quota before I/O so restarts and failures count.
    quota_path = get_settings().helper_state_path.with_suffix(".quota.json")
    quota = _load_json(quota_path, {})
    now = time.time()
    bucket = "user" if path.startswith("/me/") else "workspace"
    requests = [float(t) for t in quota.get(bucket, []) if float(t) > now - 3600]
    until = float(quota.get("backoff_until") or 0)
    if now < until:
        raise TogglApiError(429, _rate_limit_message(until))
    if len(requests) >= 24:
        raise TogglApiError(429, _rate_limit_message(requests[0] + 3600))
    quota[bucket] = [*requests, now]
    _save_json(quota_path, quota)
    body = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        API_BASE + path,
        data=body,
        method=method,
        headers={
            "Authorization": _auth_header(str(config["api_token"])),
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            text = response.read().decode()
            return json.loads(text) if text else {}
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")
        if error.code in (402, 429):
            try:
                retry_after = float(error.headers.get("Retry-After", "0"))
            except (ValueError, TypeError):
                retry_after = 0
            quota["backoff_until"] = now + max(
                retry_after, _rate_limit_backoff_seconds(config)
            )
            _save_json(quota_path, quota)
        raise TogglApiError(error.code, detail) from error
    except urllib.error.URLError as error:
        raise TogglServiceError(
            f"Toggl connection failed: {error.reason}"
        ) from error


def _current_time_entry(config: dict[str, Any]) -> dict[str, Any] | None:
    current = _toggl_request(config, "GET", "/me/time_entries/current")
    if isinstance(current, list):
        current = current[0] if current else None
    return current if isinstance(current, dict) and current.get("id") else None


def _plan_prefixes(config: dict[str, Any]) -> dict[str, list[str]]:
    configured = config.get("plan_prefixes")
    prefixes: dict[str, Any] = dict(DEFAULT_PLAN_PREFIXES)
    if isinstance(configured, dict):
        prefixes.update(configured)
    return {
        str(plan_id): [str(prefix) for prefix in values]
        for plan_id, values in prefixes.items()
        if isinstance(values, list)
    }


def _plan_from_description(config: dict[str, Any], description: str) -> str:
    lowered = description.strip().casefold()
    for plan_id, prefixes in _plan_prefixes(config).items():
        if any(lowered.startswith(prefix.casefold()) for prefix in prefixes):
            return plan_id
    return ""


def _day_id_from_description(description: str) -> str:
    match = re.search(r"\bday\s+(\d+)\b", description, flags=re.IGNORECASE)
    return f"day-{int(match.group(1)):02d}" if match else ""


def _entry_matches_project(
    config: dict[str, Any],
    entry: dict[str, Any],
) -> bool:
    expected = str(config.get("project_id") or "")
    actual = str(entry.get("project_id") or entry.get("pid") or "")
    workspace = entry.get("workspace_id") or entry.get("wid")
    return (not expected or actual == expected) and (
        workspace is None or str(workspace) == str(config["workspace_id"])
    )


def _tracker_current(
    config: dict[str, Any],
    entry: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if not entry or not _entry_matches_project(config, entry):
        return None
    description = str(entry.get("description") or "")
    plan_id = _plan_from_description(config, description)
    if not plan_id:
        return None
    return {
        "id": entry.get("id"),
        "description": description,
        "plan_id": plan_id,
        "day_id": _day_id_from_description(description),
        "start": entry.get("start") or _utc_now_iso(),
    }


def _current_elapsed(entry: dict[str, Any] | None) -> int:
    if not entry:
        return 0
    try:
        elapsed = datetime.now(UTC) - _parse_iso(str(entry["start"]))
    except (KeyError, ValueError):
        return 0
    return max(0, int(elapsed.total_seconds()))


def _stats_window(config: dict[str, Any]) -> tuple[str, str]:
    now = datetime.now(UTC)
    configured_start = str(config.get("stats_start_date") or "").strip()
    if configured_start:
        start = (
            configured_start
            if "T" in configured_start
            else f"{configured_start}T00:00:00Z"
        )
    else:
        since_days = int(config.get("stats_since_days") or 90)
        start = (
            (now - timedelta(days=since_days))
            .isoformat(timespec="seconds")
            .replace("+00:00", "Z")
        )
    end = (
        (now + timedelta(days=1))
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z")
    )
    return start, end


def _list_time_entries(config: dict[str, Any]) -> list[dict[str, Any]]:
    start, end = _stats_window(config)
    query = urllib.parse.urlencode({"start_date": start, "end_date": end})
    entries = _toggl_request(config, "GET", f"/me/time_entries?{query}")
    if not isinstance(entries, list) or any(
        not isinstance(entry, dict) or not entry.get("id") or not entry.get("start")
        for entry in entries
    ):
        raise TogglServiceError("Toggl returned an incomplete time-entry response; saved time was kept.")
    # A full page may be truncated. Never infer deletions from a partial window.
    if len(entries) >= 1000:
        raise TogglServiceError("Toggl returned 1,000+ entries. Narrow stats_start_date before syncing; saved time was kept.")
    try:
        for entry in entries:
            _parse_iso(str(entry["start"]))
            int(entry.get("duration") or 0)
            if entry.get("stop"):
                _parse_iso(str(entry["stop"]))
    except (ValueError, TypeError):
        raise TogglServiceError("Toggl returned invalid entry times; saved time was kept.") from None
    return entries


def _entry_duration_seconds(entry: dict[str, Any]) -> int:
    duration = int(entry.get("duration") or 0)
    if duration > 0:
        return duration
    start = entry.get("start")
    stop = entry.get("stop")
    if not start or not stop:
        return 0
    try:
        return max(
            0,
            int((_parse_iso(str(stop)) - _parse_iso(str(start))).total_seconds()),
        )
    except ValueError:
        return 0


def _aggregate_time_entries(
    config: dict[str, Any],
    current: dict[str, Any] | None,
    entries: list[dict[str, Any]] | None = None,
) -> dict[str, dict[str, Any]]:
    totals: dict[str, int] = {}
    days: dict[str, dict[str, int]] = {}
    for entry in entries if entries is not None else _list_time_entries(config):
        if not _entry_matches_project(config, entry):
            continue
        description = str(entry.get("description") or "")
        plan_id = _plan_from_description(config, description)
        seconds = _entry_duration_seconds(entry)
        if not plan_id or seconds <= 0:
            continue
        day_id = _day_id_from_description(description)
        totals[plan_id] = totals.get(plan_id, 0) + seconds
        if day_id:
            plan_days = days.setdefault(plan_id, {})
            plan_days[day_id] = plan_days.get(day_id, 0) + seconds
    if current:
        seconds = _current_elapsed(current)
        plan_id = str(current["plan_id"])
        totals[plan_id] = totals.get(plan_id, 0) + seconds
        day_id = str(current.get("day_id") or "")
        if day_id:
            plan_days = days.setdefault(plan_id, {})
            plan_days[day_id] = plan_days.get(day_id, 0) + seconds
    return {"totals": totals, "days": days}


def _legacy_totals(state: dict[str, Any]) -> dict[str, int]:
    raw_totals = state.get("totals")
    if not isinstance(raw_totals, dict):
        return {}
    totals: dict[str, int] = {}
    for key, value in raw_totals.items():
        try:
            seconds = int(value)
        except (TypeError, ValueError):
            continue
        if seconds > 0:
            totals[str(key)] = seconds
    return totals


def _status_payload(
    config: dict[str, Any],
    current: dict[str, Any] | None,
    totals: dict[str, dict[str, Any]] | None,
    error: str = "",
) -> dict[str, Any]:
    totals = totals or {"totals": {}, "days": {}}
    return {
        "configured": True,
        "error": error,
        "project_name": config.get("project_name", "Study"),
        "running": bool(current),
        "current": current,
        "totals": totals.get("totals", {}),
        "days": totals.get("days", {}),
    }


def _cached_status(
    state: dict[str, Any],
    config: dict[str, Any],
    *,
    error: str = "",
    stale: bool = False,
    max_age: int | None = None,
) -> dict[str, Any] | None:
    cache = state.get("status_cache")
    if not isinstance(cache, dict) or not isinstance(cache.get("payload"), dict):
        return None
    try:
        timestamp = float(cache.get("timestamp") or 0)
    except (TypeError, ValueError):
        timestamp = 0
    if not stale and time.time() - timestamp > (max_age if max_age is not None else _status_cache_seconds(config)):
        return None
    raw_result = json.loads(json.dumps(cache["payload"]))
    if not isinstance(raw_result, dict):
        return None
    result: dict[str, Any] = raw_result
    if stale:
        result["running"] = False
        result["current"] = None
    elif result.get("running") and result.get("current") and not result.get("error"):
        # Advance the displayed estimate locally; this does not read Toggl.
        elapsed = max(0, int(time.time() - timestamp))
        current = result["current"]
        plan = current["plan_id"]
        result.setdefault("totals", {})[plan] = result.get("totals", {}).get(plan, 0) + elapsed
        if current.get("day_id"):
            days = result.setdefault("days", {}).setdefault(plan, {})
            days[current["day_id"]] = days.get(current["day_id"], 0) + elapsed
    if error:
        result["error"] = error
    return result


def _rate_limit_error(error: TogglApiError) -> bool:
    detail = error.detail.casefold()
    return (
        error.status in (402, 429)
        or "rate limit" in detail
        or "too many" in detail
        or "api calls" in detail
        or "run out" in detail
    )


def _rate_limit_message(until: float) -> str:
    retry_at = (
        datetime.fromtimestamp(until, tz=UTC)
        .astimezone()
        .strftime("%H:%M")
    )
    return f"Toggl API rate-limited; cached stats only until about {retry_at}."


def _reconciliation_entry(entry: dict[str, Any]) -> dict[str, Any]:
    stopped_at = entry.get("stop")
    if not stopped_at and int(entry.get("duration") or -1) >= 0:
        stopped_at = (_parse_iso(str(entry["start"])) + timedelta(seconds=int(entry["duration"]))).isoformat()
    return {
        "description": str(entry.get("description") or ""),
        "duration_seconds": (
            _entry_duration_seconds(entry) if stopped_at else None
        ),
        "external_id": str(entry.get("id") or ""),
        "payload": entry,
        "started_at": str(entry.get("start") or ""),
        "stopped_at": str(stopped_at) if stopped_at else None,
    }


def public_status(
    *,
    force: bool = False,
    include_entries: bool = True,
) -> dict[str, Any]:
    with _STATE_LOCK:
        state = _load_state()
        try:
            config = _load_config()
        except TogglConfigurationError as error:
            return {
                "configured": False,
                "error": str(error),
                "project_name": "",
                "running": False,
                "current": None,
                "totals": {},
                "days": {},
            }
        cached = _cached_status(state, config, max_age=60 if force else None)
        if cached:
            return cached
        try:
            backoff_until = float(state.get("toggl_backoff_until") or 0)
        except (TypeError, ValueError):
            backoff_until = 0
        if time.time() < backoff_until:
            message = _rate_limit_message(backoff_until)
            return _cached_status(
                state,
                config,
                error=message,
                stale=True,
            ) or _status_payload(
                config,
                None,
                {"totals": _legacy_totals(state), "days": {}},
                message,
            )
        try:
            raw_current = _current_time_entry(config)
            current = _tracker_current(config, raw_current)
            entries = _list_time_entries(config)
            # The list is fetched after current; a phone may stop it between calls.
            latest_current = next((entry for entry in entries if raw_current and entry["id"] == raw_current["id"]), None)
            if latest_current and (latest_current.get("stop") or int(latest_current.get("duration") or 0) >= 0):
                current = None
                raw_current = None
            totals = _aggregate_time_entries(config, current, entries)
            payload = _status_payload(config, current, totals)
            payload["synced_at"] = _utc_now_iso()
            payload["sync_interval_seconds"] = _status_cache_seconds(config)
            if include_entries:
                project_entries = [
                    entry
                    for entry in entries
                    if _entry_matches_project(config, entry) and entry.get("id")
                ]
                if (
                    raw_current
                    and _entry_matches_project(config, raw_current)
                    and raw_current.get("id")
                    and all(
                        str(entry.get("id")) != str(raw_current.get("id"))
                        for entry in project_entries
                    )
                ):
                    project_entries.append(raw_current)
                payload["_entries"] = [
                    _reconciliation_entry(entry) for entry in project_entries
                ]
                payload["_window_start"] = _stats_window(config)[0]
            state["current"] = current
            state["toggl_backoff_until"] = 0
        except TogglApiError as error:
            if _rate_limit_error(error):
                backoff_until = time.time() + _rate_limit_backoff_seconds(config)
                state["toggl_backoff_until"] = backoff_until
                state["current"] = None
                message = _rate_limit_message(backoff_until)
                _save_state(state)
                return _cached_status(
                    state,
                    config,
                    error=message,
                    stale=True,
                ) or _status_payload(
                    config,
                    None,
                    {"totals": _legacy_totals(state), "days": {}},
                    message,
                )
            payload = _status_payload(
                config,
                None,
                {"totals": _legacy_totals(state), "days": {}},
                str(error),
            )
        except TogglServiceError as error:
            payload = _cached_status(state, config, stale=True, error=str(error)) or _status_payload(
                config,
                None,
                {"totals": _legacy_totals(state), "days": {}},
                str(error),
            )
        state["status_cache"] = {"timestamp": time.time(), "payload": {
            key: value for key, value in payload.items() if not key.startswith("_")
        }}
        _save_state(state)
        return payload


def start(description: str) -> dict[str, Any]:
    with _STATE_LOCK:
        config = _load_config()
        state = _load_state()
        current = _tracker_current(config, _current_time_entry(config))
        if current:
            _stop(config, state, current=current)
        started_at = _utc_now_iso()
        entry = _toggl_request(
            config,
            "POST",
            f"/workspaces/{int(config['workspace_id'])}/time_entries",
            {
                "description": description or "Study",
                "created_with": config.get("created_with", "Thesis Tracker"),
                "duration": -1,
                "start": started_at,
                "workspace_id": int(config["workspace_id"]),
                "project_id": int(config["project_id"]),
            },
        )
        state["current"] = _tracker_current(config, entry)
        state["toggl_backoff_until"] = 0
        _invalidate_status_cache(state)
        _save_state(state)
        payload = public_status(force=True)
        # A successful POST must remain bound to its task even if the subsequent
        # read hits a quota or connection failure.
        payload["current"] = _tracker_current(config, entry)
        payload["running"] = bool(payload["current"])
        return payload


def _stop(
    config: dict[str, Any],
    state: dict[str, Any],
    *,
    current: dict[str, Any] | None = None,
) -> None:
    current = current or _tracker_current(config, _current_time_entry(config))
    if not current:
        state["current"] = None
        state["toggl_backoff_until"] = 0
        _invalidate_status_cache(state)
        _save_state(state)
        return
    try:
        _toggl_request(
            config,
            "PATCH",
            (
                f"/workspaces/{int(config['workspace_id'])}/time_entries/"
                f"{int(current['id'])}/stop"
            ),
        )
    except TogglApiError as error:
        if error.status != 409:
            raise
    state["current"] = None
    state["toggl_backoff_until"] = 0
    _invalidate_status_cache(state)
    _save_state(state)


def stop() -> dict[str, Any]:
    with _STATE_LOCK:
        config = _load_config()
        state = _load_state()
        _stop(config, state)
        return public_status(force=True)
