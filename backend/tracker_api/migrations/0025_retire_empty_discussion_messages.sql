-- Retire historical final-answer deletion shells. Preserve documents and revisions.
-- Only unequivocally empty messages without links or living review captures qualify.
UPDATE discussion_messages
SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), revision = revision + 1
WHERE deleted_at IS NULL AND role = 'assistant'
  AND body_document_id IN (
    SELECT id FROM documents WHERE trim(coalesce(markdown, '')) = ''
      AND trim(coalesce(plain_text, '')) = '' AND editor_json IS NULL
  )
  AND NOT EXISTS (SELECT 1 FROM discussion_message_annotations dma
                  WHERE dma.message_id = discussion_messages.id)
  AND NOT EXISTS (SELECT 1 FROM annotation_anchors aa JOIN annotations a ON a.id = aa.annotation_id
                  WHERE aa.discussion_message_id = discussion_messages.id AND a.deleted_at IS NULL);
