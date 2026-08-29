-- Only source-controlled PDF questions need the immutable visibility guard.
-- Manual questions and note-derived markers remain user-editable/deletable.
DROP TRIGGER IF EXISTS annotation_question_visibility_immutable;
CREATE TRIGGER annotation_question_visibility_immutable
BEFORE UPDATE OF deleted_at ON annotations
WHEN OLD.deleted_at IS NULL
  AND NEW.deleted_at IS NOT NULL
  AND OLD.origin IN ('drawboard_cloud', 'drawboard_cloud_ink', 'pdf_import')
  AND EXISTS (
    SELECT 1
    FROM annotation_question_identities identity
    WHERE identity.annotation_id = OLD.id
  )
BEGIN
  SELECT RAISE(ABORT, 'question visibility is immutable after identity assignment');
END;
