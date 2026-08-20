-- Readable labels are a per-discussion transport namespace; annotation UUIDs
-- remain the identity.  Original questions own Q-### and follow-ups live below
-- their root as Q-###-F1, Q-###-F2, ... .  This repairs the old independent
-- allocators, which could assign the same Q-### to both kinds.

-- If a later prompt batch reused a follow-up's old label, responses pasted
-- after that batch belong to the prompt item, not to the older follow-up.
DELETE FROM discussion_message_annotations
WHERE relation IN ('references', 'answers', 'partially_answers')
  AND EXISTS (
    SELECT 1
    FROM annotations followup
    JOIN annotation_anchors followup_anchor
      ON followup_anchor.annotation_id = followup.id
    JOIN discussion_messages response_message
      ON response_message.id = discussion_message_annotations.message_id
    JOIN prompt_batches prompt_batch
      ON prompt_batch.parent_discussion_thread_id = response_message.thread_id
     AND prompt_batch.deleted_at IS NULL
    JOIN prompt_batch_items prompt_item
      ON prompt_item.prompt_batch_id = prompt_batch.id
     AND prompt_item.question_label = json_extract(
       followup_anchor.selector_json,
       '$.promptLabel'
     )
    WHERE followup.id = discussion_message_annotations.annotation_id
      AND followup.origin = 'discussion_review_followup'
      AND followup.deleted_at IS NULL
      AND prompt_batch.created_at > followup.created_at
      AND prompt_batch.created_at <= response_message.created_at
  );

-- Restore every heading from the latest copied prompt batch that preceded a
-- response.  This repairs sibling questions that were hidden by the collision.
INSERT OR IGNORE INTO discussion_message_annotations (
  message_id,
  annotation_id,
  relation,
  created_at
)
SELECT
  response_message.id,
  prompt_item.annotation_id,
  'references',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM discussion_messages response_message
JOIN documents response_document
  ON response_document.id = response_message.body_document_id
JOIN prompt_batches prompt_batch
  ON prompt_batch.id = (
    SELECT candidate.id
    FROM prompt_batches candidate
    WHERE candidate.parent_discussion_thread_id = response_message.thread_id
      AND candidate.deleted_at IS NULL
      AND candidate.created_at <= response_message.created_at
    ORDER BY candidate.created_at DESC, candidate.id DESC
    LIMIT 1
  )
JOIN prompt_batch_items prompt_item
  ON prompt_item.prompt_batch_id = prompt_batch.id
WHERE response_message.role = 'assistant'
  AND response_message.deleted_at IS NULL
  AND instr(response_document.markdown, prompt_item.question_label) > 0;

WITH followups AS (
  SELECT
    followup.id AS annotation_id,
    followup.created_at,
    message.thread_id,
    anchor.selector_json
  FROM annotations followup
  JOIN annotation_anchors anchor ON anchor.annotation_id = followup.id
  JOIN discussion_messages message ON message.id = anchor.discussion_message_id
  WHERE followup.origin = 'discussion_review_followup'
    AND followup.deleted_at IS NULL
), root_candidates AS (
  SELECT
    followups.annotation_id,
    prompt_item.question_label AS root_label,
    ROW_NUMBER() OVER (
      PARTITION BY followups.annotation_id
      ORDER BY CAST(root.key AS INTEGER), prompt_batch.created_at, prompt_item.order_index
    ) AS candidate_rank
  FROM followups
  JOIN json_each(
    COALESCE(json_extract(followups.selector_json, '$.rootQuestionIds'), '[]')
  ) root
  JOIN prompt_batches prompt_batch
    ON prompt_batch.parent_discussion_thread_id = followups.thread_id
   AND prompt_batch.deleted_at IS NULL
  JOIN prompt_batch_items prompt_item
    ON prompt_item.prompt_batch_id = prompt_batch.id
   AND prompt_item.annotation_id = root.value
), primary_roots AS (
  SELECT annotation_id, root_label
  FROM root_candidates
  WHERE candidate_rank = 1
), section_roots AS (
  SELECT
    followups.annotation_id,
    'Q-' || printf(
      '%03d',
      CAST(substr(json_extract(followups.selector_json, '$.sectionLabel'), 3) AS INTEGER)
    ) AS root_label
  FROM followups
  WHERE json_extract(followups.selector_json, '$.sectionLabel') GLOB 'Q-[0-9]*'
), resolved_roots AS (
  SELECT
    followups.annotation_id,
    COALESCE(primary_roots.root_label, section_roots.root_label) AS root_label
  FROM followups
  LEFT JOIN primary_roots ON primary_roots.annotation_id = followups.annotation_id
  LEFT JOIN section_roots ON section_roots.annotation_id = followups.annotation_id
), ranked AS (
  SELECT
    followups.annotation_id,
    resolved_roots.root_label,
    ROW_NUMBER() OVER (
      PARTITION BY followups.thread_id, resolved_roots.root_label
      ORDER BY followups.created_at, followups.annotation_id
    ) AS followup_rank
  FROM followups
  JOIN resolved_roots ON resolved_roots.annotation_id = followups.annotation_id
  WHERE resolved_roots.root_label IS NOT NULL
), labels AS (
  SELECT
    annotation_id,
    root_label || '-F' || followup_rank AS prompt_label
  FROM ranked
)
UPDATE annotation_anchors
SET selector_json = json_set(
      COALESCE(selector_json, '{}'),
      '$.promptLabel',
      (SELECT prompt_label FROM labels WHERE labels.annotation_id = annotation_anchors.annotation_id)
    ),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE annotation_id IN (SELECT annotation_id FROM labels);
