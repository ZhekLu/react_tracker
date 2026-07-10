DELETE FROM discussion_messages
WHERE role = 'user'
  AND sequence_number = 1
  AND EXISTS (
    SELECT 1
    FROM discussion_threads dt
    JOIN prompt_batches pb ON pb.id = dt.initial_prompt_batch_id
    WHERE dt.id = discussion_messages.thread_id
      AND pb.prompt_document_id = discussion_messages.body_document_id
  );
