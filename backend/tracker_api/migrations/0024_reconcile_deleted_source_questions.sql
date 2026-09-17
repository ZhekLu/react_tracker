-- A deleted source mark removes its capture from the active workspace, including
-- questions. This is a recoverable soft deletion: stable identities, prompt
-- snapshots, notes, and answer links are retained. Recoloring is not deletion.
DROP TRIGGER IF EXISTS annotation_question_visibility_immutable;
