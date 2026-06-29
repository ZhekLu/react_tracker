CREATE TABLE app_preferences (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL CHECK(json_valid(value_json)),
  updated_at TEXT NOT NULL
);

CREATE TABLE courses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  short_code TEXT,
  subtitle TEXT,
  description_document_id TEXT,
  accent_color TEXT,
  icon_uri TEXT,
  deadline TEXT,
  status TEXT NOT NULL CHECK(status IN ('active', 'paused', 'completed', 'archived')),
  toggl_workspace_id TEXT,
  toggl_project_id TEXT,
  toggl_description_prefix TEXT,
  settings_json TEXT CHECK(settings_json IS NULL OR json_valid(settings_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)
);

CREATE TABLE tracker_dumps (
  id TEXT PRIMARY KEY,
  source_path TEXT NOT NULL,
  schema_version TEXT,
  app_version TEXT,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  payload_hash TEXT NOT NULL UNIQUE,
  imported_at TEXT NOT NULL
);

CREATE TABLE plan_sources (
  id TEXT PRIMARY KEY,
  course_id TEXT REFERENCES courses(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  local_path TEXT NOT NULL,
  parser_name TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  last_file_hash TEXT,
  last_import_run_id TEXT,
  last_successful_import_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_type, local_path)
);

CREATE TABLE import_runs (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  resource_id TEXT,
  resource_version_id TEXT,
  importer TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed')),
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  details_json TEXT CHECK(details_json IS NULL OR json_valid(details_json)),
  error_message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE plan_snapshots (
  dump_id TEXT NOT NULL REFERENCES tracker_dumps(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL,
  day_count INTEGER NOT NULL DEFAULT 0,
  resource_count INTEGER NOT NULL DEFAULT 0,
  annotation_count INTEGER NOT NULL DEFAULT 0,
  discussion_count INTEGER NOT NULL DEFAULT 0,
  exam_state_count INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  PRIMARY KEY(dump_id, plan_id)
);

CREATE TABLE source_bindings (
  id TEXT PRIMARY KEY,
  plan_source_id TEXT NOT NULL REFERENCES plan_sources(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  source_hash TEXT,
  source_payload_json TEXT CHECK(source_payload_json IS NULL OR json_valid(source_payload_json)),
  first_seen_import_run_id TEXT NOT NULL,
  last_seen_import_run_id TEXT NOT NULL,
  missing_since_import_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(plan_source_id, source_key, entity_type),
  UNIQUE(plan_source_id, entity_type, entity_id)
);

CREATE INDEX idx_plan_sources_type_path ON plan_sources(source_type, local_path);
CREATE INDEX idx_import_runs_importer_started ON import_runs(importer, started_at);
CREATE INDEX idx_source_bindings_source_key
  ON source_bindings(plan_source_id, source_key, entity_type);
