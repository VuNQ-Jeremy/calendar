-- E2E accounts for the calendar-test environment (mochi-class-test D1 only —
-- NEVER run this against the production mochi-class database).
--
-- Both passwords are "mochi123" (PBKDF2-SHA256, 100k iterations, the exact
-- format server/services/crypto.ts verifies; regenerate with
-- scripts/hash-password.mjs if the format ever changes).
--
-- Idempotent, and must run AFTER every seed.sql reset: seed's DELETE FROM
-- staff/students fires accounts' ON DELETE SET NULL, so the role links here
-- have to be re-established each time.

-- Sweep accounts created by the invite-redemption e2e spec (their student
-- rows are deleted in-test; the accounts have no UI delete path).
DELETE FROM accounts WHERE email LIKE 'e2e-redeem-%';

-- seed.sql predates these tables and never clears them; without this, a
-- failed e2e run leaks questions/tests/flashcards into the next reset.
DELETE FROM test_answers;
DELETE FROM test_attempts;
DELETE FROM test_questions;
DELETE FROM tests;
DELETE FROM questions;
-- Garden: events/assignments/snapshots/trees would cascade off students and classes, but
-- garden_plants and class_trees survive a topic wipe, and a leaked plant would make the
-- next run's "empty pot" assertions fail. Sweep all five explicitly.
DELETE FROM garden_events;
DELETE FROM garden_snapshots;
DELETE FROM vocab_assignments;
DELETE FROM class_trees;
DELETE FROM garden_plants;
DELETE FROM flashcard_mastery;
DELETE FROM flashcard_results;
DELETE FROM flashcard_words;
DELETE FROM flashcard_topics;
DELETE FROM session_previews;
DELETE FROM event_materials;
-- Tuition state: prices/lines normally cascade off classes/students, but
-- tuition_months (keyed by month) never would — a leaked CLOSED month would
-- wreck the tuition spec. Sweep all four explicitly.
DELETE FROM tuition_lines;
DELETE FROM tuition_student_months;
DELETE FROM tuition_months;
DELETE FROM class_prices;
-- Zalo links and pairing codes. Chats cascade off accounts/parents/classes, but the e2e spec
-- pairs a synthetic chat id that belongs to none of them, and a leaked one would make the next
-- run's "no links yet" assertion fail. Codes never cascade at all — they outlive their target.
DELETE FROM zalo_chats;
DELETE FROM zalo_pair_codes;
-- Subjects (môn học). seed.sql still writes the legacy free-text `classes.subject`, so re-derive
-- the managed rows and the subject_id link after every reset — otherwise the seeded classes come
-- back reading "General" and the class spec has nothing to pick.
INSERT INTO subjects (id, name, active, sort_order)
SELECT 'sub_' || lower(hex(randomblob(8))), name, 1, 0
FROM (
  SELECT DISTINCT TRIM(subject) AS name
  FROM classes
  WHERE subject IS NOT NULL AND TRIM(subject) <> ''
)
WHERE name NOT IN (SELECT name FROM subjects);
UPDATE classes
SET subject_id = (SELECT s.id FROM subjects s WHERE s.name = TRIM(classes.subject))
WHERE subject IS NOT NULL AND TRIM(subject) <> '';

-- Class levels (trình độ). seed.sql predates the table, so sweep rows the config spec creates
-- and re-assert the two migration-seeded defaults the class/rankings specs pick from.
DELETE FROM class_levels WHERE id NOT IN ('cl1','cl2');
INSERT INTO class_levels (id, name, active, sort_order) VALUES
  ('cl1','Cơ bản',1,1),('cl2','Nâng cao',1,2)
ON CONFLICT(id) DO UPDATE SET
  name       = excluded.name,
  active     = 1,
  sort_order = excluded.sort_order;

INSERT INTO accounts (id, email, password_hash, staff_id, created_at) VALUES
  ('acc-e2e-staff-0001', 'dev@mochi.edu',
   'pbkdf2$100000$ZQrMNwfYI5HbKc9oTdJeRg==$Qmp9WzepoERgWRkmJyiMaJ0y4w6Wmkc/lroLZVvW8GQ=',
   'dev-0000-0000-0000-000000000002', datetime('now'))
ON CONFLICT(email) DO UPDATE SET
  password_hash = excluded.password_hash,
  staff_id      = excluded.staff_id;

-- Linked to seed student s1 (Leo Park) so the student sees real demo data.
INSERT INTO accounts (id, email, password_hash, student_id, created_at) VALUES
  ('acc-e2e-student-0001', 'vunq@mochi.edu',
   'pbkdf2$100000$3SWEZIbyW5qVC83vVx3TtQ==$r862GZCJplV5TZ2Eg0gWJjzU+UiJJi8I35V3Kem957M=',
   's1', datetime('now'))
ON CONFLICT(email) DO UPDATE SET
  password_hash = excluded.password_hash,
  student_id    = excluded.student_id;
