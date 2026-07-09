INSERT OR IGNORE INTO resource_relations (
  source_resource_id, target_resource_id, relation, created_at
)
SELECT
  dt.resource_id,
  pb.source_resource_id,
  'generated_from',
  dt.created_at
FROM discussion_threads dt
JOIN prompt_batches pb ON pb.id = dt.initial_prompt_batch_id
JOIN resources r ON r.id = pb.source_resource_id
WHERE dt.deleted_at IS NULL
  AND pb.deleted_at IS NULL
  AND r.deleted_at IS NULL;

INSERT OR IGNORE INTO resource_relations (
  source_resource_id, target_resource_id, relation, created_at
)
SELECT
  dt.resource_id,
  tr.resource_id,
  'generated_from',
  dt.created_at
FROM discussion_threads dt
JOIN prompt_batches pb ON pb.id = dt.initial_prompt_batch_id
JOIN task_resources tr ON tr.task_id = pb.source_task_id
JOIN resources r ON r.id = tr.resource_id
WHERE dt.deleted_at IS NULL
  AND pb.deleted_at IS NULL
  AND r.deleted_at IS NULL;

INSERT OR IGNORE INTO resource_relations (
  source_resource_id, target_resource_id, relation, created_at
)
SELECT
  dt.resource_id,
  tr.resource_id,
  'generated_from',
  dt.created_at
FROM discussion_threads dt
JOIN prompt_batches pb ON pb.id = dt.initial_prompt_batch_id
JOIN tasks t ON t.day_id = pb.source_day_id AND t.deleted_at IS NULL
JOIN task_resources tr ON tr.task_id = t.id
JOIN resources r ON r.id = tr.resource_id
WHERE dt.deleted_at IS NULL
  AND pb.deleted_at IS NULL
  AND r.deleted_at IS NULL;

INSERT OR IGNORE INTO resource_relations (
  source_resource_id, target_resource_id, relation, created_at
)
SELECT
  dt.resource_id,
  a.resource_id,
  'generated_from',
  dt.created_at
FROM discussion_threads dt
JOIN prompt_batch_items pbi
  ON pbi.prompt_batch_id = dt.initial_prompt_batch_id
JOIN annotations a ON a.id = pbi.annotation_id
JOIN resources r ON r.id = a.resource_id
WHERE dt.deleted_at IS NULL
  AND a.deleted_at IS NULL
  AND r.deleted_at IS NULL;
