CREATE TABLE study_days (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  date TEXT,
  order_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  topic TEXT,
  purpose TEXT,
  goals_document_id TEXT,
  stop_when_document_id TEXT,
  closure_note_document_id TEXT,
  status TEXT NOT NULL
    CHECK(status IN ('not_started', 'open', 'closed', 'completed', 'archived')),
  opened_at TEXT,
  closed_at TEXT,
  completed_at TEXT,
  toggl_description_token TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  UNIQUE(course_id, number),
  UNIQUE(course_id, order_index)
);

CREATE TABLE day_sections (
  id TEXT PRIMARY KEY,
  day_id TEXT NOT NULL REFERENCES study_days(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  default_collapsed INTEGER NOT NULL DEFAULT 0 CHECK(default_collapsed IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(day_id, order_index)
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  day_id TEXT NOT NULL REFERENCES study_days(id) ON DELETE CASCADE,
  section_id TEXT REFERENCES day_sections(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description_document_id TEXT,
  rationale_document_id TEXT,
  status_note_document_id TEXT,
  task_type TEXT,
  is_optional INTEGER NOT NULL DEFAULT 0 CHECK(is_optional IN (0, 1)),
  order_index INTEGER NOT NULL,
  estimated_minutes INTEGER CHECK(estimated_minutes IS NULL OR estimated_minutes >= 0),
  status TEXT NOT NULL CHECK(status IN ('todo', 'in_progress', 'done', 'later', 'skipped')),
  defer_until TEXT,
  started_at TEXT,
  completed_at TEXT,
  deferred_at TEXT,
  skipped_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  UNIQUE(day_id, order_index)
);

CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT,
  description_document_id TEXT,
  confidence REAL CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1),
  last_reviewed_at TEXT,
  order_index INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)
);

CREATE TABLE day_skills (
  day_id TEXT NOT NULL REFERENCES study_days(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  coverage TEXT NOT NULL CHECK(coverage IN ('introduced', 'practised', 'reviewed', 'assessed')),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0, 1)),
  weight REAL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(day_id, skill_id)
);

CREATE TABLE resources (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  parent_resource_id TEXT REFERENCES resources(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  current_version_id TEXT,
  content_document_id TEXT,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  format TEXT NOT NULL,
  source_type TEXT NOT NULL,
  category TEXT,
  authors_json TEXT CHECK(authors_json IS NULL OR json_valid(authors_json)),
  publication_year INTEGER,
  canonical_url TEXT,
  status TEXT NOT NULL CHECK(status IN ('unread', 'skimmed', 'reading', 'read', 'review', 'archived')),
  first_opened_at TEXT,
  last_opened_at TEXT,
  completed_at TEXT,
  metadata_json TEXT CHECK(metadata_json IS NULL OR json_valid(metadata_json)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)
);

CREATE TABLE resource_versions (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK(version_number > 0),
  storage_type TEXT NOT NULL,
  local_path TEXT,
  object_key TEXT,
  source_url TEXT,
  document_id TEXT,
  file_name TEXT,
  mime_type TEXT,
  file_hash TEXT,
  file_size_bytes INTEGER,
  page_count INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE(resource_id, version_number),
  UNIQUE(resource_id, file_hash)
);

CREATE TABLE resource_reading_progress (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  resource_version_id TEXT REFERENCES resource_versions(id) ON DELETE CASCADE,
  progress_percent REAL NOT NULL CHECK(progress_percent BETWEEN 0 AND 100),
  position_type TEXT NOT NULL,
  page_number INTEGER,
  source_line INTEGER,
  heading_id TEXT,
  position_json TEXT CHECK(position_json IS NULL OR json_valid(position_json)),
  started_at TEXT,
  last_read_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)
);

CREATE UNIQUE INDEX idx_resource_progress_version
  ON resource_reading_progress(resource_id, resource_version_id)
  WHERE resource_version_id IS NOT NULL;
CREATE UNIQUE INDEX idx_resource_progress_virtual
  ON resource_reading_progress(resource_id)
  WHERE resource_version_id IS NULL;

CREATE TABLE task_resources (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  is_required INTEGER NOT NULL DEFAULT 1 CHECK(is_required IN (0, 1)),
  order_index INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(task_id, resource_id, relation)
);

CREATE TABLE resource_relations (
  source_resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  target_resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(source_resource_id, target_resource_id, relation)
);

CREATE TABLE exam_question_details (
  resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
  part TEXT,
  question_number TEXT,
  topic TEXT,
  points REAL,
  order_index INTEGER NOT NULL,
  prompt_document_id TEXT,
  solve_status TEXT NOT NULL
    CHECK(solve_status IN ('unsolved', 'attempted', 'solved', 'review', 'skipped')),
  attempted_at TEXT,
  solved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_days_course_order ON study_days(course_id, order_index);
CREATE INDEX idx_tasks_day_order ON tasks(day_id, order_index);
CREATE INDEX idx_tasks_day_status ON tasks(day_id, status);
CREATE INDEX idx_skills_course ON skills(course_id);
CREATE INDEX idx_day_skills_skill ON day_skills(skill_id);
CREATE INDEX idx_resources_course_kind ON resources(course_id, kind);
CREATE INDEX idx_resources_course_status ON resources(course_id, status);
CREATE INDEX idx_resources_parent ON resources(parent_resource_id);
CREATE INDEX idx_task_resources_resource ON task_resources(resource_id);
CREATE INDEX idx_resource_versions_resource ON resource_versions(resource_id, version_number);
