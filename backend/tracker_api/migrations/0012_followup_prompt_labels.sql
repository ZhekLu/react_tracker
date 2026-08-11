-- Persist the label used when a review follow-up is copied to the tutor.  Older
-- follow-ups were labelled from an ever-growing UI list, so a later response
-- could no longer be mapped reliably after unrelated questions were linked.
WITH followups AS (
  SELECT
    a.id AS annotation_id,
    dm.thread_id,
    ROW_NUMBER() OVER (
      PARTITION BY dm.thread_id
      ORDER BY a.created_at, a.id
    ) AS followup_rank
  FROM annotations a
  JOIN annotation_anchors aa ON aa.annotation_id = a.id
  JOIN discussion_messages dm ON dm.id = aa.discussion_message_id
  WHERE a.origin = 'discussion_review_followup'
    AND a.deleted_at IS NULL
),
base_counts AS (
  SELECT thread_id, COUNT(*) AS base_count
  FROM (
    SELECT dt.id AS thread_id, pbi.annotation_id
    FROM discussion_threads dt
    JOIN prompt_batch_items pbi
      ON pbi.prompt_batch_id = dt.initial_prompt_batch_id
    WHERE dt.deleted_at IS NULL
    UNION
    SELECT dm.thread_id, dma.annotation_id
    FROM discussion_messages dm
    JOIN discussion_message_annotations dma ON dma.message_id = dm.id
    JOIN annotations a ON a.id = dma.annotation_id
    WHERE dm.deleted_at IS NULL
      AND a.deleted_at IS NULL
      AND a.kind IN ('question', 'todo')
      AND a.origin <> 'discussion_review_followup'
  ) scoped
  GROUP BY thread_id
),
labels AS (
  SELECT
    followups.annotation_id,
    printf(
      'Q-%03d',
      COALESCE(base_counts.base_count, 0) + followups.followup_rank
    ) AS prompt_label
  FROM followups
  LEFT JOIN base_counts ON base_counts.thread_id = followups.thread_id
)
UPDATE annotation_anchors
SET selector_json = json_set(
      COALESCE(selector_json, '{}'),
      '$.promptLabel',
      (SELECT prompt_label FROM labels WHERE labels.annotation_id = annotation_anchors.annotation_id)
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE annotation_id IN (SELECT annotation_id FROM labels);
