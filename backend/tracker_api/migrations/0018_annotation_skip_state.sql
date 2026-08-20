ALTER TABLE annotations ADD COLUMN skipped_at TEXT;

CREATE INDEX idx_annotations_skipped
  ON annotations(resource_id, skipped_at)
  WHERE deleted_at IS NULL;
