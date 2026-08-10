-- Ôn tập (spaced-repetition review): each word a student has answered comes back after a growing
-- ladder of ICT days (3, 5, 7, 14, 30 by default, admin-tunable via the `review-settings` row).
--
-- Design mirrors the garden: the state is two columns on the existing per-(student, word) mastery
-- row, and the transitions are the pure `applyAnswer` in shared/logic/review.ts. There is no cron
-- and no notification — "due" is derived at read time by comparing due_day to today in ICT, so a
-- word falls due at ICT midnight for every reader at once. Nothing sweeps, nothing to fall behind.
--
-- Only students get mastery rows (staff plays never write one), so this is student state by
-- construction.

-- Rung on the interval ladder: a 0-based index into the settings' intervals array. Advancing is
-- capped at the last rung, so a mature word keeps coming back at the longest interval forever.
ALTER TABLE flashcard_mastery ADD COLUMN level INTEGER NOT NULL DEFAULT 0;
-- ICT YYYY-MM-DD the word next falls due, compared lexically like the garden's day columns.
-- NULL means "not scheduled" — impossible for a row written after this migration, but treated as
-- not-due everywhere rather than trusted away.
ALTER TABLE flashcard_mastery ADD COLUMN due_day TEXT;

-- Backfill: every already-studied word joins the cycle at the first rung, due 3 ICT days after it
-- was last seen — which for most rows is already in the past, so the students who have been away
-- longest see their backlog immediately. last_seen is a UTC ISO instant; '+7 hours' shifts it into
-- ICT before date() takes the calendar day.
UPDATE flashcard_mastery
SET due_day = date(COALESCE(last_seen, CURRENT_TIMESTAMP), '+7 hours', '+3 days')
WHERE due_day IS NULL;

-- Serves both read paths: the sidebar badge count and the due-word list, each of which is
-- (student_id = ?, due_day <= today).
CREATE INDEX idx_flashcard_mastery_due ON flashcard_mastery(student_id, due_day);
