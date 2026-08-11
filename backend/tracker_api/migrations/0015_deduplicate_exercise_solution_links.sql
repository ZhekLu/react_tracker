-- A double click on the old exercise mapper could create two byte-identical
-- notes pointing at the same task and tutor message. Keep the first copy; the
-- new mapper updates that note in place instead of inserting another one.
WITH ranked AS (
  SELECT
    n.id,
    ROW_NUMBER() OVER (
      PARTITION BY
        d.markdown,
        (
          SELECT nl.entity_id
          FROM note_links nl
          WHERE nl.note_id = n.id AND nl.entity_type = 'task'
          LIMIT 1
        ),
        (
          SELECT nl.entity_id
          FROM note_links nl
          WHERE nl.note_id = n.id
            AND nl.entity_type = 'discussion_message'
          LIMIT 1
        )
      ORDER BY n.created_at, n.id
    ) AS duplicate_rank
  FROM notes n
  JOIN documents d ON d.id = n.document_id
  WHERE n.kind = 'exercise_solution'
    AND n.deleted_at IS NULL
)
UPDATE notes
SET status = 'archived',
    deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    revision = revision + 1
WHERE id IN (
  SELECT id FROM ranked WHERE duplicate_rank > 1
);
