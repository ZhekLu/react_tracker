CREATE TABLE discussion_qa_reviews (
  discussion_id TEXT NOT NULL REFERENCES discussion_threads(id),
  annotation_id TEXT NOT NULL REFERENCES annotations(id),
  message_id TEXT NOT NULL REFERENCES discussion_messages(id),
  message_revision INTEGER NOT NULL,
  viewed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (discussion_id, annotation_id)
);

CREATE INDEX idx_discussion_qa_reviews_message
  ON discussion_qa_reviews(message_id);
