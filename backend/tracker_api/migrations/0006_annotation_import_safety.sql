CREATE UNIQUE INDEX idx_annotations_resource_fingerprint
  ON annotations(resource_id, source_fingerprint)
  WHERE source_fingerprint IS NOT NULL;
