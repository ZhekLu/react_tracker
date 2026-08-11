-- A response pasted before persistent follow-up labels existed could contain
-- the right Q-### headings but remain linked to the original broad question
-- batch. Recover those links from the stable label and same-titled discussion
-- family so the existing response immediately opens as a follow-up QA session.
INSERT OR IGNORE INTO discussion_message_annotations (
  message_id,
  annotation_id,
  relation,
  created_at
)
SELECT
  response_message.id,
  followup.id,
  'answers',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM annotations followup
JOIN annotation_anchors followup_anchor
  ON followup_anchor.annotation_id = followup.id
JOIN discussion_messages source_message
  ON source_message.id = followup_anchor.discussion_message_id
JOIN discussion_threads source_thread
  ON source_thread.id = source_message.thread_id
JOIN resources source_resource
  ON source_resource.id = source_thread.resource_id
JOIN discussion_threads response_thread
  ON response_thread.course_id = source_thread.course_id
 AND response_thread.deleted_at IS NULL
JOIN resources response_resource
  ON response_resource.id = response_thread.resource_id
 AND response_resource.title = source_resource.title
JOIN discussion_messages response_message
  ON response_message.thread_id = response_thread.id
 AND response_message.role = 'assistant'
 AND response_message.deleted_at IS NULL
JOIN documents response_document
  ON response_document.id = response_message.body_document_id
WHERE followup.origin = 'discussion_review_followup'
  AND followup.deleted_at IS NULL
  AND json_extract(
        followup_anchor.selector_json,
        '$.promptLabel'
      ) GLOB 'Q-[0-9][0-9][0-9]*'
  AND instr(
        response_document.markdown,
        json_extract(followup_anchor.selector_json, '$.promptLabel')
      ) > 0;
