CREATE TABLE resource_chapter_progress (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  chapter_number INTEGER NOT NULL CHECK(chapter_number > 0),
  status TEXT NOT NULL DEFAULT 'unread'
    CHECK(status IN ('unread', 'read_partially', 'read_fully')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  UNIQUE(resource_id, chapter_number)
);

CREATE INDEX idx_resource_chapter_progress_resource
  ON resource_chapter_progress(resource_id, chapter_number);
