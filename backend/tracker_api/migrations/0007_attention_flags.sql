ALTER TABLE notes
ADD COLUMN attention TEXT NOT NULL DEFAULT 'none'
CHECK (attention IN ('none', 'professor'));

ALTER TABLE discussion_threads
ADD COLUMN attention TEXT NOT NULL DEFAULT 'none'
CHECK (attention IN ('none', 'professor'));

CREATE INDEX idx_notes_course_attention
ON notes(course_id, attention)
WHERE deleted_at IS NULL;

CREATE INDEX idx_discussion_threads_course_attention
ON discussion_threads(course_id, attention)
WHERE deleted_at IS NULL;
