CREATE TABLE prompt_batches (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  prompt_document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  source_scope TEXT NOT NULL,
  source_resource_id TEXT REFERENCES resources(id) ON DELETE SET NULL,
  source_day_id TEXT REFERENCES study_days(id) ON DELETE SET NULL,
  source_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  parent_discussion_thread_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('draft', 'copied', 'answered', 'archived')),
  copied_at TEXT,
  answered_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE prompt_batch_items (
  prompt_batch_id TEXT NOT NULL REFERENCES prompt_batches(id) ON DELETE CASCADE,
  annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  question_label TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  quote_snapshot TEXT,
  question_snapshot_markdown TEXT NOT NULL,
  source_metadata_snapshot_json TEXT
    CHECK(source_metadata_snapshot_json IS NULL OR json_valid(source_metadata_snapshot_json)),
  created_at TEXT NOT NULL,
  PRIMARY KEY(prompt_batch_id, annotation_id)
);

CREATE TABLE discussion_threads (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL UNIQUE REFERENCES resources(id) ON DELETE CASCADE,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  initial_prompt_batch_id TEXT REFERENCES prompt_batches(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'reviewed', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)
);

CREATE TABLE discussion_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES discussion_threads(id) ON DELETE CASCADE,
  parent_message_id TEXT REFERENCES discussion_messages(id) ON DELETE SET NULL,
  reply_to_message_id TEXT REFERENCES discussion_messages(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'personal_note')),
  body_document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  sequence_number INTEGER NOT NULL,
  imported_from_clipboard INTEGER NOT NULL DEFAULT 0
    CHECK(imported_from_clipboard IN (0, 1)),
  externally_created_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  UNIQUE(thread_id, sequence_number)
);

CREATE TABLE discussion_message_annotations (
  message_id TEXT NOT NULL REFERENCES discussion_messages(id) ON DELETE CASCADE,
  annotation_id TEXT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(message_id, annotation_id, relation)
);

CREATE INDEX idx_prompt_items_annotation ON prompt_batch_items(annotation_id);
CREATE INDEX idx_discussion_messages_sequence
  ON discussion_messages(thread_id, sequence_number);
CREATE INDEX idx_discussion_message_annotations_annotation
  ON discussion_message_annotations(annotation_id);
