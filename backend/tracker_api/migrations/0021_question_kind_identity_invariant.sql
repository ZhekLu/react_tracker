-- A Drawboard colour role classifies a new capture; it must not erase an
-- established question identity on a later sync. Restore records affected by
-- the former reclassification behaviour, then enforce the invariant for every
-- write path (not only the importer).
--
-- Brown (#B49791) is the user's explicit "previously reviewed question"
-- colour in the RL book.  A palette refresh briefly classified it as regular,
-- which changed seven established questions into highlights.  Some grouped
-- captures consequently lost their identity mapping as well.
UPDATE annotations
SET kind = 'question',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    revision = revision + 1
WHERE kind NOT IN ('question', 'todo')
  AND (
    EXISTS (
      SELECT 1
      FROM annotation_question_identities identity
      WHERE identity.annotation_id = annotations.id
    )
    OR EXISTS (
      SELECT 1
      FROM resources resource
      JOIN annotation_anchors anchor ON anchor.annotation_id = annotations.id
      WHERE resource.id = annotations.resource_id
        AND json_extract(resource.metadata_json, '$.plan_resource_id') = 'rl-book'
        AND annotations.origin = 'drawboard_cloud'
        AND upper(anchor.selector_json) LIKE '%#B49791%'
    )
  );

-- Reattach a repaired capture to the immutable identity already used by the
-- other member(s) of its Drawboard context group.  This is deliberately a
-- relationship repair, not a renumbering operation.
INSERT INTO annotation_question_identities (
  annotation_id, question_identity_id, created_at
)
SELECT
  repaired.id,
  (
    SELECT grouped_identity.question_identity_id
    FROM annotations grouped_annotation
    JOIN annotation_anchors grouped_anchor
      ON grouped_anchor.annotation_id = grouped_annotation.id
    JOIN annotation_question_identities grouped_identity
      ON grouped_identity.annotation_id = grouped_annotation.id
    WHERE grouped_annotation.resource_id = repaired.resource_id
      AND grouped_annotation.id <> repaired.id
      AND json_extract(grouped_anchor.selector_json, '$.contextGroupId') =
          json_extract(repaired_anchor.selector_json, '$.contextGroupId')
    ORDER BY
      CASE WHEN grouped_annotation.deleted_at IS NULL THEN 0 ELSE 1 END,
      grouped_annotation.created_at,
      grouped_annotation.id
    LIMIT 1
  ),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM annotations repaired
JOIN resources resource ON resource.id = repaired.resource_id
JOIN annotation_anchors repaired_anchor
  ON repaired_anchor.annotation_id = repaired.id
WHERE repaired.deleted_at IS NULL
  AND repaired.kind IN ('question', 'todo')
  AND repaired.origin = 'drawboard_cloud'
  AND json_extract(resource.metadata_json, '$.plan_resource_id') = 'rl-book'
  AND upper(repaired_anchor.selector_json) LIKE '%#B49791%'
  AND json_extract(repaired_anchor.selector_json, '$.contextGroupId') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM annotation_question_identities existing
    WHERE existing.annotation_id = repaired.id
  )
  AND EXISTS (
    SELECT 1
    FROM annotations grouped_annotation
    JOIN annotation_anchors grouped_anchor
      ON grouped_anchor.annotation_id = grouped_annotation.id
    JOIN annotation_question_identities grouped_identity
      ON grouped_identity.annotation_id = grouped_annotation.id
    WHERE grouped_annotation.resource_id = repaired.resource_id
      AND grouped_annotation.id <> repaired.id
      AND json_extract(grouped_anchor.selector_json, '$.contextGroupId') =
          json_extract(repaired_anchor.selector_json, '$.contextGroupId')
  );

DROP TRIGGER IF EXISTS annotation_question_kind_immutable;
CREATE TRIGGER annotation_question_kind_immutable
BEFORE UPDATE OF kind ON annotations
WHEN OLD.kind IN ('question', 'todo')
  AND NEW.kind NOT IN ('question', 'todo')
  AND EXISTS (
    SELECT 1
    FROM annotation_question_identities identity
    WHERE identity.annotation_id = OLD.id
  )
BEGIN
  SELECT RAISE(ABORT, 'question kind is immutable after identity assignment');
END;
