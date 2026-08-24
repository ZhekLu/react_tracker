ALTER TABLE discussion_qa_reviews
  ADD COLUMN section_id TEXT;

ALTER TABLE discussion_qa_reviews
  ADD COLUMN section_fingerprint TEXT;

CREATE INDEX idx_discussion_qa_reviews_section
  ON discussion_qa_reviews(discussion_id, section_id);
