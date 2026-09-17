-- Explicit removal is separate from cancellation. Keep study content recoverable.
CREATE TABLE task_admin_state (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  protected_fields_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(protected_fields_json)),
  removed_at TEXT,
  original_order INTEGER
);

CREATE TABLE task_admin_events (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('edit', 'delete', 'restore', 'release')),
  request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  before_json TEXT NOT NULL CHECK(json_valid(before_json)),
  after_json TEXT NOT NULL CHECK(json_valid(after_json)),
  backup_path TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_task_admin_history ON task_admin_events(course_id, created_at DESC);
