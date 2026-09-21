-- Separate study importance from the legacy capture queue priority.
-- NULL preserves existing priorities; 'auto' explicitly returns to tutor guidance.
ALTER TABLE annotations ADD COLUMN discussion_priority TEXT
  CHECK (discussion_priority IN ('auto', 'core', 'high', 'medium', 'low'));
