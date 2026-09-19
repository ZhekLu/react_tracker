CREATE TABLE capture_region_corrections (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  source_fingerprint TEXT NOT NULL,
  page_number INTEGER NOT NULL CHECK(page_number > 0),
  layout_mode TEXT NOT NULL CHECK(layout_mode IN ('single', 'two_column')),
  layout_column TEXT NOT NULL CHECK(layout_column IN ('full', 'left', 'right')),
  proposed_rect_json TEXT NOT NULL CHECK(json_valid(proposed_rect_json)),
  final_rect_json TEXT NOT NULL CHECK(json_valid(final_rect_json)),
  page_width REAL NOT NULL CHECK(page_width > 0),
  page_height REAL NOT NULL CHECK(page_height > 0),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_capture_region_corrections_resource_created
  ON capture_region_corrections(resource_id, created_at DESC);

CREATE TABLE resource_integration_exports (
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  integration TEXT NOT NULL,
  external_id TEXT NOT NULL,
  external_note_id TEXT,
  external_attachment_id TEXT,
  source_url TEXT,
  note_hash TEXT,
  file_hash TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending', 'synced', 'partial', 'failed')),
  last_error TEXT,
  metadata_json TEXT CHECK(metadata_json IS NULL OR json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(resource_id, integration),
  UNIQUE(integration, external_id)
);

CREATE INDEX idx_resource_integration_exports_status
  ON resource_integration_exports(integration, status, updated_at DESC);
