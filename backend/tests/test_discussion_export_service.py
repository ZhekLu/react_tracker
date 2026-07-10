from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import pytest

from tracker_api.config import get_settings
from tracker_api.services.discussion_export_service import sync_discussion_exports


@pytest.fixture(autouse=True)
def isolated_config(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[None]:
    export_root = tmp_path / "discussion-exports"
    config_path = tmp_path / "course_files.json"
    config_path.write_text(
        json.dumps(
            {"discussion_export_roots": {"TORL": str(export_root)}}
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("TRACKER_COURSE_FILES_CONFIG_PATH", str(config_path))
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_tagged_blocks_append_and_repeated_message_saves_replace() -> None:
    root = get_settings().course_files_config_path.parent / "discussion-exports"
    root.mkdir(parents=True)
    target = root / "day4_code_task.md"
    target.write_text("# My manual header\n", encoding="utf-8")

    sync_discussion_exports(
        short_code="TORL",
        message_id="message-1",
        markdown=(
            "Theory.\n\n<day4_code_task>First instruction.</day4_code_task>\n\n"
            "<day4_code_task>Second instruction.</day4_code_task>"
        ),
    )
    first = target.read_text(encoding="utf-8")
    assert "# My manual header" in first
    assert "First instruction." in first
    assert "Second instruction." in first

    sync_discussion_exports(
        short_code="TORL",
        message_id="message-1",
        markdown="<day4_code_task>Revised instruction.</day4_code_task>",
    )
    revised = target.read_text(encoding="utf-8")
    assert "# My manual header" in revised
    assert "Revised instruction." in revised
    assert "First instruction." not in revised
    assert revised.count("tracker-export:message-1") == 2


def test_removing_tag_removes_only_tracker_owned_message_section() -> None:
    root = get_settings().course_files_config_path.parent / "discussion-exports"
    sync_discussion_exports(
        short_code="TORL",
        message_id="message-1",
        markdown="<day4_code_task>Temporary instruction.</day4_code_task>",
    )
    target = root / "day4_code_task.md"
    target.write_text(
        target.read_text(encoding="utf-8") + "\nProfessor note.\n",
        encoding="utf-8",
    )

    sync_discussion_exports(
        short_code="TORL",
        message_id="message-1",
        markdown="No export tag anymore.",
    )

    cleaned = target.read_text(encoding="utf-8")
    assert "Temporary instruction." not in cleaned
    assert "Professor note." in cleaned
