CREATE TABLE time_entries (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  day_id TEXT REFERENCES study_days(id) ON DELETE SET NULL,
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  resource_id TEXT REFERENCES resources(id) ON DELETE SET NULL,
  discussion_thread_id TEXT REFERENCES discussion_threads(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK(provider IN ('toggl', 'manual', 'internal')),
  external_id TEXT,
  description TEXT,
  started_at TEXT NOT NULL,
  stopped_at TEXT,
  duration_override_seconds INTEGER,
  external_workspace_id TEXT,
  external_project_id TEXT,
  last_synced_at TEXT,
  sync_payload_json TEXT CHECK(sync_payload_json IS NULL OR json_valid(sync_payload_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, external_id)
);

CREATE TABLE integration_sync_states (
  id TEXT PRIMARY KEY,
  integration TEXT NOT NULL UNIQUE,
  cursor TEXT,
  last_successful_sync_at TEXT,
  last_error TEXT,
  backoff_until TEXT,
  settings_json TEXT CHECK(settings_json IS NULL OR json_valid(settings_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_time_entries_course_started ON time_entries(course_id, started_at);
CREATE INDEX idx_time_entries_day_started ON time_entries(day_id, started_at);
CREATE INDEX idx_time_entries_external ON time_entries(external_id);

CREATE VIEW day_progress AS
SELECT
  d.id AS day_id,
  COUNT(t.id) FILTER (WHERE t.is_optional = 0 AND t.deleted_at IS NULL) AS required_task_count,
  COUNT(t.id) FILTER (
    WHERE t.is_optional = 0 AND t.status = 'done' AND t.deleted_at IS NULL
  ) AS completed_required_count,
  COUNT(t.id) FILTER (
    WHERE t.is_optional = 0 AND t.status = 'later' AND t.deleted_at IS NULL
  ) AS deferred_required_count,
  COUNT(t.id) FILTER (
    WHERE t.is_optional = 0 AND t.status = 'skipped' AND t.deleted_at IS NULL
  ) AS skipped_required_count,
  COUNT(t.id) FILTER (WHERE t.is_optional = 1 AND t.deleted_at IS NULL) AS optional_task_count,
  CASE
    WHEN COUNT(t.id) FILTER (
      WHERE t.is_optional = 0 AND t.status != 'skipped' AND t.deleted_at IS NULL
    ) = 0 THEN 0.0
    ELSE CAST(COUNT(t.id) FILTER (
      WHERE t.is_optional = 0 AND t.status = 'done' AND t.deleted_at IS NULL
    ) AS REAL) / COUNT(t.id) FILTER (
      WHERE t.is_optional = 0 AND t.status != 'skipped' AND t.deleted_at IS NULL
    )
  END AS completion_ratio
FROM study_days d
LEFT JOIN tasks t ON t.day_id = d.id
GROUP BY d.id;

CREATE VIEW course_time_summary AS
SELECT
  course_id,
  SUM(
    COALESCE(
      duration_override_seconds,
      CASE
        WHEN stopped_at IS NOT NULL
        THEN CAST(strftime('%s', stopped_at) - strftime('%s', started_at) AS INTEGER)
        ELSE CAST(strftime('%s', 'now') - strftime('%s', started_at) AS INTEGER)
      END
    )
  ) AS tracked_seconds
FROM time_entries
GROUP BY course_id;

CREATE VIEW day_time_summary AS
SELECT
  day_id,
  SUM(
    COALESCE(
      duration_override_seconds,
      CASE
        WHEN stopped_at IS NOT NULL
        THEN CAST(strftime('%s', stopped_at) - strftime('%s', started_at) AS INTEGER)
        ELSE CAST(strftime('%s', 'now') - strftime('%s', started_at) AS INTEGER)
      END
    )
  ) AS tracked_seconds
FROM time_entries
WHERE day_id IS NOT NULL
GROUP BY day_id;
