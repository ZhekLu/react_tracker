-- Readable question labels are presentation identifiers; annotation UUIDs
-- remain the canonical foreign keys.  A separate identity table lets several
-- captures in one PDF context group share one immutable question label.
CREATE TABLE question_identities (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  resource_code TEXT NOT NULL,
  scope_code TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal > 0),
  readable_label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(course_id, readable_label),
  UNIQUE(resource_id, scope_code, ordinal)
);

CREATE TABLE annotation_question_identities (
  annotation_id TEXT PRIMARY KEY REFERENCES annotations(id) ON DELETE CASCADE,
  question_identity_id TEXT NOT NULL REFERENCES question_identities(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_annotation_question_identity
  ON annotation_question_identities(question_identity_id);

-- Human-readable labels and annotation membership are immutable.  A later
-- prompt may add an alias, but must never rename the underlying question.
CREATE TRIGGER question_identity_label_immutable
BEFORE UPDATE OF course_id, resource_id, resource_code, scope_code, ordinal, readable_label
ON question_identities
WHEN OLD.course_id <> NEW.course_id
  OR OLD.resource_id <> NEW.resource_id
  OR OLD.resource_code <> NEW.resource_code
  OR OLD.scope_code <> NEW.scope_code
  OR OLD.ordinal <> NEW.ordinal
  OR OLD.readable_label <> NEW.readable_label
BEGIN
  SELECT RAISE(ABORT, 'question identity is immutable');
END;

CREATE TRIGGER annotation_question_identity_immutable
BEFORE UPDATE OF question_identity_id
ON annotation_question_identities
WHEN OLD.question_identity_id <> NEW.question_identity_id
BEGIN
  SELECT RAISE(ABORT, 'annotation question identity is immutable');
END;

CREATE TEMP TABLE question_identity_backfill (
  logical_key TEXT NOT NULL,
  representative_id TEXT NOT NULL,
  course_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  resource_code TEXT NOT NULL,
  scope_code TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  identity_id TEXT NOT NULL,
  readable_label TEXT NOT NULL
);

INSERT INTO question_identity_backfill (
  logical_key, representative_id, course_id, resource_id, resource_code,
  scope_code, ordinal, identity_id, readable_label
)
WITH candidates AS (
  SELECT
    a.id,
    a.resource_id,
    r.course_id,
    a.created_at,
    COALESCE(aa.page_number, 2147483647) AS page_number,
    COALESCE(json_extract(aa.rect_json, '$[1]'), 2147483647) AS top_position,
    COALESCE(
      NULLIF(json_extract(aa.selector_json, '$.contextGroupId'), ''),
      a.id
    ) AS logical_key,
    CASE
      WHEN json_extract(r.metadata_json, '$.plan_resource_id') = 'rl-book' THEN 'b'
      WHEN json_extract(r.metadata_json, '$.plan_resource_id') LIKE 'unipd-lc%' THEN 'us'
      WHEN r.kind = 'paper' THEN 'p' || substr(replace(r.id, '-', ''), 1, 6)
      WHEN r.kind = 'slides' THEN 's' || substr(replace(r.id, '-', ''), 1, 6)
      ELSE 'r' || substr(replace(r.id, '-', ''), 1, 6)
    END AS resource_code,
    CASE
      WHEN json_extract(r.metadata_json, '$.plan_resource_id') = 'rl-book'
        THEN printf('%02d', COALESCE(json_extract(aa.selector_json, '$.chapterNumber'), 0))
      WHEN json_extract(r.metadata_json, '$.plan_resource_id') LIKE 'unipd-lc%'
        THEN printf('%02d', CAST(substr(json_extract(r.metadata_json, '$.plan_resource_id'), 9) AS INTEGER))
      ELSE '00'
    END AS scope_code
  FROM annotations a
  JOIN resources r ON r.id = a.resource_id AND r.deleted_at IS NULL
  LEFT JOIN annotation_anchors aa ON aa.annotation_id = a.id
  WHERE a.deleted_at IS NULL AND a.kind IN ('question', 'todo')
), logical_questions AS (
  SELECT
    logical_key,
    min(id) AS representative_id,
    course_id,
    resource_id,
    resource_code,
    scope_code,
    min(page_number) AS page_number,
    min(top_position) AS top_position,
    min(created_at) AS created_at
  FROM candidates
  GROUP BY logical_key, course_id, resource_id, resource_code, scope_code
), ranked AS (
  SELECT
    *,
    row_number() OVER (
      PARTITION BY resource_id, scope_code
      ORDER BY page_number, top_position, created_at, representative_id
    ) AS ordinal
  FROM logical_questions
)
SELECT
  logical_key,
  representative_id,
  course_id,
  resource_id,
  resource_code,
  scope_code,
  ordinal,
  'question-identity-' || representative_id,
  'Q-' || resource_code || '-' || scope_code || '-' || printf('%03d', ordinal)
FROM ranked;

INSERT INTO question_identities (
  id, course_id, resource_id, resource_code, scope_code, ordinal,
  readable_label, created_at
)
SELECT
  identity_id, course_id, resource_id, resource_code, scope_code, ordinal,
  readable_label, '2026-08-20T00:00:00+00:00'
FROM question_identity_backfill;

INSERT INTO annotation_question_identities (
  annotation_id, question_identity_id, created_at
)
WITH candidates AS (
  SELECT
    a.id,
    a.resource_id,
    COALESCE(
      NULLIF(json_extract(aa.selector_json, '$.contextGroupId'), ''),
      a.id
    ) AS logical_key
  FROM annotations a
  LEFT JOIN annotation_anchors aa ON aa.annotation_id = a.id
  WHERE a.deleted_at IS NULL AND a.kind IN ('question', 'todo')
)
SELECT
  candidates.id,
  backfill.identity_id,
  '2026-08-20T00:00:00+00:00'
FROM candidates
JOIN question_identity_backfill backfill
  ON backfill.resource_id = candidates.resource_id
 AND backfill.logical_key = candidates.logical_key;

DROP TABLE question_identity_backfill;
