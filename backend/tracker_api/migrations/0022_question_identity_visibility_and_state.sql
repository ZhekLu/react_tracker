-- A PDF mark is only the source capture for a question. Once a stable question
-- identity exists, removing or recolouring that mark must not make the logical
-- question (or its answer/follow-up history) disappear from the tracker.

-- When a refreshed capture already represents the same stable identity, move
-- historical relationships to the live capture. This keeps one visible capture
-- while preserving prompt, answer, review, and note history.
CREATE TEMP TABLE question_annotation_alias_repair AS
SELECT
  old_annotation.id AS old_annotation_id,
  (
    SELECT live_annotation.id
    FROM annotation_question_identities live_identity
    JOIN annotations live_annotation
      ON live_annotation.id = live_identity.annotation_id
    WHERE live_identity.question_identity_id = old_identity.question_identity_id
      AND live_annotation.deleted_at IS NULL
    ORDER BY live_annotation.created_at, live_annotation.id
    LIMIT 1
  ) AS live_annotation_id,
  old_identity.question_identity_id
FROM annotation_question_identities old_identity
JOIN annotations old_annotation ON old_annotation.id = old_identity.annotation_id
WHERE old_annotation.deleted_at IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM annotation_question_identities live_identity
    JOIN annotations live_annotation
      ON live_annotation.id = live_identity.annotation_id
    WHERE live_identity.question_identity_id = old_identity.question_identity_id
      AND live_annotation.deleted_at IS NULL
  );

INSERT OR IGNORE INTO discussion_message_annotations (
  message_id, annotation_id, relation, created_at
)
SELECT link.message_id, alias.live_annotation_id, link.relation, link.created_at
FROM discussion_message_annotations link
JOIN question_annotation_alias_repair alias
  ON alias.old_annotation_id = link.annotation_id;

DELETE FROM discussion_message_annotations
WHERE annotation_id IN (
  SELECT old_annotation_id FROM question_annotation_alias_repair
);

INSERT OR IGNORE INTO prompt_batch_items (
  prompt_batch_id, annotation_id, question_label, order_index,
  quote_snapshot, question_snapshot_markdown,
  source_metadata_snapshot_json, created_at
)
SELECT
  item.prompt_batch_id, alias.live_annotation_id, item.question_label,
  item.order_index, item.quote_snapshot, item.question_snapshot_markdown,
  item.source_metadata_snapshot_json, item.created_at
FROM prompt_batch_items item
JOIN question_annotation_alias_repair alias
  ON alias.old_annotation_id = item.annotation_id;

DELETE FROM prompt_batch_items
WHERE annotation_id IN (
  SELECT old_annotation_id FROM question_annotation_alias_repair
);

INSERT OR IGNORE INTO discussion_qa_reviews (
  discussion_id, annotation_id, message_id, message_revision,
  viewed_at, updated_at
)
SELECT
  review.discussion_id, alias.live_annotation_id, review.message_id,
  review.message_revision, review.viewed_at, review.updated_at
FROM discussion_qa_reviews review
JOIN question_annotation_alias_repair alias
  ON alias.old_annotation_id = review.annotation_id;

DELETE FROM discussion_qa_reviews
WHERE annotation_id IN (
  SELECT old_annotation_id FROM question_annotation_alias_repair
);

INSERT OR IGNORE INTO note_links (
  note_id, entity_type, entity_id, relation, created_at
)
SELECT
  link.note_id, link.entity_type, alias.live_annotation_id,
  link.relation, link.created_at
FROM note_links link
JOIN question_annotation_alias_repair alias
  ON link.entity_type = 'annotation'
 AND alias.old_annotation_id = link.entity_id;

DELETE FROM note_links
WHERE entity_type = 'annotation'
  AND entity_id IN (
    SELECT old_annotation_id FROM question_annotation_alias_repair
  );

-- Preserve the resolved state of a logical question when a recoloured live
-- capture replaced its former source capture.
UPDATE annotations
SET status = CASE
      WHEN EXISTS (
        SELECT 1
        FROM annotation_question_identities sibling_identity
        JOIN annotations sibling ON sibling.id = sibling_identity.annotation_id
        WHERE sibling_identity.question_identity_id = (
          SELECT current_identity.question_identity_id
          FROM annotation_question_identities current_identity
          WHERE current_identity.annotation_id = annotations.id
        )
          AND sibling.status = 'archived'
      ) THEN 'archived'
      WHEN EXISTS (
        SELECT 1
        FROM annotation_question_identities sibling_identity
        JOIN annotations sibling ON sibling.id = sibling_identity.annotation_id
        WHERE sibling_identity.question_identity_id = (
          SELECT current_identity.question_identity_id
          FROM annotation_question_identities current_identity
          WHERE current_identity.annotation_id = annotations.id
        )
          AND sibling.status = 'answered'
      ) THEN 'answered'
      ELSE status
    END,
    answered_at = COALESCE(
      answered_at,
      (
        SELECT MAX(sibling.answered_at)
        FROM annotation_question_identities sibling_identity
        JOIN annotations sibling ON sibling.id = sibling_identity.annotation_id
        WHERE sibling_identity.question_identity_id = (
          SELECT current_identity.question_identity_id
          FROM annotation_question_identities current_identity
          WHERE current_identity.annotation_id = annotations.id
        )
      )
    ),
    archived_at = COALESCE(
      archived_at,
      (
        SELECT MAX(sibling.archived_at)
        FROM annotation_question_identities sibling_identity
        JOIN annotations sibling ON sibling.id = sibling_identity.annotation_id
        WHERE sibling_identity.question_identity_id = (
          SELECT current_identity.question_identity_id
          FROM annotation_question_identities current_identity
          WHERE current_identity.annotation_id = annotations.id
        )
      )
    ),
    postponed_at = CASE
      WHEN status IN ('answered', 'archived') THEN NULL
      ELSE postponed_at
    END,
    skipped_at = CASE
      WHEN status IN ('answered', 'archived') THEN NULL
      ELSE skipped_at
    END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    revision = revision + 1
WHERE id IN (
  SELECT live_annotation_id FROM question_annotation_alias_repair
);

-- SQLite evaluates every assignment above from the pre-update row. Clear
-- queue-only state in a second statement after the resolved status has landed.
UPDATE annotations
SET postponed_at = NULL,
    skipped_at = NULL
WHERE id IN (
  SELECT live_annotation_id FROM question_annotation_alias_repair
)
  AND status IN ('answered', 'archived');

-- Restore every established logical question that has no remaining visible
-- capture. The original anchor and screenshot are retained, so book QA can
-- still show the exact source even after the mark is removed from the PDF.
CREATE TEMP TABLE question_annotation_visibility_repair AS
SELECT aqi.annotation_id
FROM annotation_question_identities aqi
JOIN annotations annotation ON annotation.id = aqi.annotation_id
WHERE annotation.deleted_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM annotation_question_identities live_identity
    JOIN annotations live_annotation
      ON live_annotation.id = live_identity.annotation_id
    WHERE live_identity.question_identity_id = aqi.question_identity_id
      AND live_annotation.deleted_at IS NULL
  );

UPDATE annotations
SET deleted_at = NULL,
    kind = CASE
      WHEN kind IN ('question', 'todo') THEN kind
      ELSE 'question'
    END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    revision = revision + 1
WHERE id IN (
  SELECT annotation_id FROM question_annotation_visibility_repair
);

-- Enforce the invariant below the service layer too. A source refresh can
-- archive ordinary highlights, but it can never hide an established question.
DROP TRIGGER IF EXISTS annotation_question_visibility_immutable;
CREATE TRIGGER annotation_question_visibility_immutable
BEFORE UPDATE OF deleted_at ON annotations
WHEN OLD.deleted_at IS NULL
  AND NEW.deleted_at IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM annotation_question_identities identity
    WHERE identity.annotation_id = OLD.id
  )
BEGIN
  SELECT RAISE(ABORT, 'question visibility is immutable after identity assignment');
END;

DROP TABLE question_annotation_visibility_repair;
DROP TABLE question_annotation_alias_repair;
