CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  canonical_format TEXT NOT NULL CHECK(canonical_format IN ('markdown', 'tiptap_json')),
  markdown TEXT,
  editor_json TEXT CHECK(editor_json IS NULL OR json_valid(editor_json)),
  plain_text TEXT NOT NULL DEFAULT '',
  editor_name TEXT NOT NULL DEFAULT 'tiptap',
  editor_schema_version TEXT NOT NULL,
  markdown_converter_version TEXT,
  content_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)
);

CREATE TABLE document_revisions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  markdown TEXT NOT NULL,
  editor_json TEXT CHECK(editor_json IS NULL OR json_valid(editor_json)),
  plain_text TEXT NOT NULL,
  content_hash TEXT,
  change_reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(document_id, revision_number)
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)
);

CREATE TABLE note_links (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  relation TEXT NOT NULL CHECK(relation IN ('primary', 'related')),
  created_at TEXT NOT NULL,
  PRIMARY KEY(note_id, entity_type, entity_id, relation)
);

CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  body_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK(kind IN ('question', 'note', 'highlight', 'todo')),
  status TEXT NOT NULL CHECK(status IN ('open', 'answered', 'archived')),
  priority TEXT NOT NULL CHECK(priority IN ('low', 'normal', 'high')),
  origin TEXT NOT NULL,
  external_id TEXT,
  source_fingerprint TEXT,
  answered_at TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)
);

CREATE TABLE annotation_anchors (
  annotation_id TEXT PRIMARY KEY REFERENCES annotations(id) ON DELETE CASCADE,
  resource_version_id TEXT REFERENCES resource_versions(id) ON DELETE SET NULL,
  anchor_type TEXT NOT NULL,
  quote TEXT,
  section_id TEXT,
  section_title TEXT,
  source_line_start INTEGER,
  source_line_end INTEGER,
  page_number INTEGER,
  rect_json TEXT CHECK(rect_json IS NULL OR json_valid(rect_json)),
  discussion_message_id TEXT,
  dom_selector TEXT,
  text_prefix TEXT,
  text_suffix TEXT,
  start_offset INTEGER,
  end_offset INTEGER,
  color TEXT,
  rgb_json TEXT CHECK(rgb_json IS NULL OR json_valid(rgb_json)),
  annotation_kind TEXT,
  selector_json TEXT CHECK(selector_json IS NULL OR json_valid(selector_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  storage_type TEXT NOT NULL,
  local_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_name TEXT,
  file_hash TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  source_resource_version_id TEXT REFERENCES resource_versions(id) ON DELETE SET NULL,
  source_page_number INTEGER,
  source_rect_json TEXT CHECK(source_rect_json IS NULL OR json_valid(source_rect_json)),
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE document_assets (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  PRIMARY KEY(document_id, asset_id)
);

CREATE TABLE annotation_assets (
  annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  PRIMARY KEY(annotation_id, asset_id)
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(course_id, name)
);

CREATE TABLE resource_tags (
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(resource_id, tag_id)
);

CREATE TABLE annotation_tags (
  annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(annotation_id, tag_id)
);

CREATE INDEX idx_notes_course_kind_status ON notes(course_id, kind, status);
CREATE INDEX idx_note_links_entity ON note_links(entity_type, entity_id);
CREATE INDEX idx_annotations_resource_state ON annotations(resource_id, kind, status);
CREATE UNIQUE INDEX idx_annotations_fingerprint
  ON annotations(resource_id, source_fingerprint)
  WHERE source_fingerprint IS NOT NULL;
CREATE INDEX idx_assets_hash ON assets(file_hash);

CREATE VIRTUAL TABLE document_search USING fts5(
  document_id UNINDEXED,
  markdown,
  plain_text,
  content='documents',
  content_rowid='rowid'
);

CREATE TRIGGER documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO document_search(rowid, document_id, markdown, plain_text)
  VALUES (new.rowid, new.id, new.markdown, new.plain_text);
END;
CREATE TRIGGER documents_ad AFTER DELETE ON documents BEGIN
  INSERT INTO document_search(document_search, rowid, document_id, markdown, plain_text)
  VALUES ('delete', old.rowid, old.id, old.markdown, old.plain_text);
END;
CREATE TRIGGER documents_au AFTER UPDATE ON documents BEGIN
  INSERT INTO document_search(document_search, rowid, document_id, markdown, plain_text)
  VALUES ('delete', old.rowid, old.id, old.markdown, old.plain_text);
  INSERT INTO document_search(rowid, document_id, markdown, plain_text)
  VALUES (new.rowid, new.id, new.markdown, new.plain_text);
END;
