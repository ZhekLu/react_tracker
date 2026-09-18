from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import Mock

import pymupdf
import pytest

from tracker_api.config import get_settings
from tracker_api.services import resource_open_service
from tracker_api.services.pdf_annotation_service import extract_pdf_annotations
from tracker_api.services.pdf_reader_service import pdf_metadata, render_pdf_page


@pytest.fixture
def resource_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = tmp_path / "Mobile Documents" / "papers"
    root.mkdir(parents=True)
    helper = tmp_path / "helper.json"
    helper.write_text(
        json.dumps({"open_allowed_roots": [str(tmp_path / "legacy")], "pdf_app": "Drawboard PDF"})
    )
    config = tmp_path / "course_files.json"
    config.write_text(json.dumps({"resource_file_roots": ["Mobile Documents/papers"]}))
    monkeypatch.setenv("TRACKER_HELPER_CONFIG_PATH", str(helper))
    monkeypatch.setenv("TRACKER_COURSE_FILES_CONFIG_PATH", str(config))
    get_settings.cache_clear()
    yield root
    get_settings.cache_clear()


def test_open_read_render_and_extract_from_root_with_spaces(resource_root, monkeypatch):
    path = resource_root / "A paper with spaces.pdf"
    with pymupdf.open() as doc:
        page = doc.new_page()
        page.insert_text((72, 72), "A highlighted sentence.")
        page.add_highlight_annot(page.search_for("highlighted"))
        doc.save(path)
    run = Mock()
    monkeypatch.setattr(resource_open_service.subprocess, "run", run)
    result = resource_open_service.open_resource(local_path=str(path), source_url=None)
    assert result == (str(path), "Drawboard PDF")
    assert run.call_args.args[0] == ["open", "-a", "Drawboard PDF", str(path)]
    assert pdf_metadata(str(path)).page_count == 1
    assert render_pdf_page(str(path), 1).startswith(b"\x89PNG")
    assert (
        len(
            extract_pdf_annotations(
                resource_open_service.safe_local_resource_path(str(path))
            ).captures
        )
        == 1
    )


@pytest.mark.parametrize("escape", ["sibling", "traversal", "symlink"])
def test_additional_root_still_rejects_escape(resource_root, escape):
    outside = resource_root.parent / "papers-private"
    outside.mkdir()
    target = outside / "private.pdf"
    target.write_bytes(b"%PDF")
    if escape == "traversal":
        target = resource_root / ".." / "papers-private" / "private.pdf"
    elif escape == "symlink":
        link = resource_root / "linked.pdf"
        link.symlink_to(target)
        target = link
    with pytest.raises(resource_open_service.ResourceOpenError, match="outside configured"):
        resource_open_service.safe_local_resource_path(str(target))


def test_legacy_roots_and_home_expansion(resource_root, tmp_path, monkeypatch):
    legacy = tmp_path / "legacy"
    legacy.mkdir()
    path = legacy / "old.pdf"
    path.touch()
    assert resource_open_service.safe_local_resource_path(str(path)) == path
    monkeypatch.setenv("HOME", str(tmp_path))
    get_settings().course_files_config_path.write_text(
        json.dumps({"resource_file_roots": ["~/Mobile Documents/papers"]})
    )
    paper = resource_root / "new.pdf"
    paper.touch()
    assert resource_open_service.safe_local_resource_path(str(paper)) == paper


def test_invalid_config_fails_closed(resource_root):
    get_settings().course_files_config_path.write_text('{"resource_file_roots": "/"}')
    path = resource_root / "paper.pdf"
    path.touch()
    with pytest.raises(resource_open_service.ResourceOpenError, match="list of directory paths"):
        resource_open_service.safe_local_resource_path(str(path))


def test_pdf_read_permission_error_is_actionable_but_external_open_still_works(
    resource_root, monkeypatch
):
    from tracker_api.services.pdf_reader_service import PdfReaderError

    path = resource_root / "read restricted.pdf"
    path.write_bytes(b"%PDF")
    original_open = Path.open

    def restricted_open(self, *args, **kwargs):
        if self == path:
            raise PermissionError("Operation not permitted")
        return original_open(self, *args, **kwargs)

    monkeypatch.setattr(Path, "open", restricted_open)
    monkeypatch.setattr(resource_open_service.subprocess, "run", Mock())
    assert resource_open_service.open_resource(local_path=str(path), source_url=None)[0] == str(
        path
    )
    with pytest.raises(PdfReaderError, match="permission denied"):
        pdf_metadata(str(path))
