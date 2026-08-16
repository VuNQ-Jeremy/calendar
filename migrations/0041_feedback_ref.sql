-- Short, human-quotable handles for feedback.
--
-- `id` is a UUID and the GitHub issue number lived nowhere, so a report on the board and the
-- issue the brainstorm routine opened for it could only be matched by re-reading their text.
-- `ref` is the handle you say out loud ("F-12"); `issue_number` is the link to the issue.
ALTER TABLE feedback ADD COLUMN ref INTEGER;
ALTER TABLE feedback ADD COLUMN issue_number INTEGER;

-- Backfill in creation order, oldest = 1. A null created_at sorts first (there are none today,
-- but the column is nullable); `id` breaks the ties among the four rows that share a timestamp.
UPDATE feedback
SET ref = (
  SELECT COUNT(*)
  FROM feedback AS f2
  WHERE COALESCE(f2.created_at, '') < COALESCE(feedback.created_at, '')
     OR (COALESCE(f2.created_at, '') = COALESCE(feedback.created_at, '') AND f2.id <= feedback.id)
);

CREATE UNIQUE INDEX idx_feedback_ref ON feedback(ref);
