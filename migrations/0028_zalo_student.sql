-- Pair a Zalo chat directly to a student.
--
-- 0027 could only pair a `parents` row, and parent records are entered by hand on the People
-- page — most students simply do not have one. The pairing dropdown was therefore offering a
-- handful of families out of the whole school, while the notifications it feeds are targeted by
-- STUDENT (class rosters). Adding a parent row first, purely so a family could be reached, is
-- data entry in service of the implementation rather than the school.
--
-- So a chat may now name a student instead. The two are deliberately separate targets, not one
-- replacing the other:
--
--   parent_id   a real `parents` record, which may cover several children at once
--   student_id  this student's family, with no parents row required
--
-- Both feed the same fan-out: `chatsForParentsOfStudents` unions them and dedupes, so a family
-- paired both ways is messaged once. Exactly one target column is set per row, as before —
-- enforced in server/services/zalo.ts, since SQLite cannot state it.
ALTER TABLE zalo_chats ADD COLUMN student_id TEXT REFERENCES students(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_zalo_chats_student ON zalo_chats (student_id);

-- Codes carry the same target, so a code issued for a student redeems to a student link.
ALTER TABLE zalo_pair_codes ADD COLUMN student_id TEXT REFERENCES students(id) ON DELETE CASCADE;
