ALTER TABLE annotations ADD COLUMN postponed_at TEXT;

CREATE INDEX idx_annotations_postponed
  ON annotations(resource_id, postponed_at)
  WHERE deleted_at IS NULL;
