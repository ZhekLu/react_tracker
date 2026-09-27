CREATE TABLE capture_group_decisions (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  source_fingerprint TEXT NOT NULL,
  target_source_fingerprint TEXT,
  source_member_fingerprints_json TEXT NOT NULL
    CHECK(json_valid(source_member_fingerprints_json)),
  target_member_fingerprints_json TEXT
    CHECK(target_member_fingerprints_json IS NULL OR json_valid(target_member_fingerprints_json)),
  page_number INTEGER NOT NULL CHECK(page_number > 0),
  layout_mode TEXT NOT NULL CHECK(layout_mode IN ('single', 'two_column')),
  layout_column TEXT NOT NULL CHECK(layout_column IN ('full', 'left', 'right')),
  proposed_rect_json TEXT NOT NULL CHECK(json_valid(proposed_rect_json)),
  decision TEXT NOT NULL CHECK(decision IN ('suppress', 'attach')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(resource_id, source_fingerprint)
);

CREATE INDEX idx_capture_group_decisions_resource_updated
  ON capture_group_decisions(resource_id, updated_at DESC);
