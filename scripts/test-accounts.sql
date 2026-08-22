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

-- Schools created by the signup / tenant-isolation specs. This must come FIRST: those specs
-- create a whole second school, and every sweep below is written as an unqualified DELETE, so
-- clearing the extra schools' rows here means the rest of the file keeps working unchanged.
--
-- The tables migration 0045 changed by ALTER carry no foreign key to `tenants` (SQLite cannot
-- add one), so nothing cascades — the deletes have to be explicit and exhaustive. The eleven
-- REBUILT tables do cascade, which is why they are absent from this list.
DELETE FROM accounts       WHERE tenant_id <> 'tnt_mochi_0001';
DELETE FROM staff          WHERE tenant_id <> 'tnt_mochi_0001';
DELETE FROM students       WHERE tenant_id <> 'tnt_mochi_0001';
DELETE FROM parents        WHERE tenant_id <> 'tnt_mochi_0001';
DELETE FROM classes        WHERE tenant_id <> 'tnt_mochi_0001';
DELETE FROM events         WHERE tenant_id <> 'tnt_mochi_0001';
DELETE FROM materials      WHERE tenant_id <> 'tnt_mochi_0001';
DELETE FROM invites        WHERE tenant_id <> 'tnt_mochi_0001';
DELETE FROM feedback       WHERE tenant_id <> 'tnt_mochi_0001';
DELETE FROM activity_log   WHERE tenant_id <> 'tnt_mochi_0001';
DELETE FROM tenants        WHERE id        <> 'tnt_mochi_0001';
-- And make sure the original school is present before anything references it.
INSERT INTO tenants (id, slug, name, status, verified, created_at)
VALUES ('tnt_mochi_0001', 'mochi', 'Mochi', 'active', 1, datetime('now') || 'Z')
ON CONFLICT(id) DO UPDATE SET status = 'active';

-- Sweep accounts created by the invite-redemption and signup e2e specs (their person rows are
-- deleted in-test; the accounts have no UI delete path).
DELETE FROM accounts WHERE email LIKE 'e2e-redeem-%';
DELETE FROM accounts WHERE email LIKE 'e2e-signup-%';

-- Per-account preferences (migration 0043). The cascade off `accounts` above only reaches the
-- redeemed e2e accounts — dev@mochi.edu's account SURVIVES a reset, so without this a theme set
-- by crud-user-settings.spec.ts would still be there on the next run and its "a fresh account
-- sees the school default" assertion would fail.
DELETE FROM user_settings;

-- The changelog hide list (server/services/changelog.ts). Not a table of its own: it is one
-- k/v row in `settings`, which seed.sql does not clear, so a spec that hides a release note
-- would leak it into the next run and the next spec would see a short changelog.
DELETE FROM settings WHERE key = 'changelog-hidden';

-- Activity log (migration 0035). Append-only and unrelated to any spec's own assertions, but a
-- leaked prior run's rows would make crud-activity.spec.ts's row-count-based checks (e.g. "exactly
-- 3 events for this entity id") fragile across reruns against the same test database.
DELETE FROM activity_log;

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
-- Word tags (migration 0046). `vocab_topics` itself is NOT swept: it is global reference data that
-- only a migration writes, so a failed run cannot dirty it, and re-inserting its 24 catalog rows on
-- every reset would be pure cost. The junction is a different matter — a spec that tags a word leaks
-- a row otherwise.
DELETE FROM vocab_word_topics;
DELETE FROM flashcard_words;
DELETE FROM flashcard_topics;
-- One PLATFORM LIBRARY deck: `tenant_id NULL` is the schema's one nullable discriminator, and it
-- means "readable by every school, writable only by a platform admin" (server/services/flashcards.ts).
-- Re-inserted after the wipe above rather than left to seed.sql, which predates the two-tier pool.
--
-- It exists so crud-vocab-library.spec.ts can prove a platform admin's edit of a library deck
-- actually lands. That was silently a no-op until 2026-08-18: the list reads through `db.pool` and
-- the update wrote through `db.own`, so recolouring one changed zero rows and still answered ok.
-- Every other spec locates topics by their own throwaway name, so one extra seeded deck is inert.
INSERT INTO flashcard_topics (id, tenant_id, name, slug, description, color, created_at) VALUES
  ('fct-library-0001', NULL, 'Library Starter Deck', 'library-starter-deck',
   'Shared across every school. Only a platform admin may edit it.', 'violet', datetime('now'));
-- Curriculum spine (migration 0047). Decks reference it ON DELETE SET NULL, so it does not cascade
-- off the topic wipe above and has to be explicit. Ordered after flashcard_topics so the decks are
-- already gone and the SET NULL has nothing to do.
DELETE FROM vocab_curricula;
DELETE FROM session_previews;
DELETE FROM event_materials;
-- Class ↔ material links (migration 0044). Unlike event_materials, seed.sql DOES insert links,
-- so this is a wipe-and-restore: a spec that fails mid-attach must not leave a stray link behind,
-- and the four canonical ones must still be there for the next run.
DELETE FROM class_materials;
INSERT INTO class_materials (tenant_id, class_id, material_id) VALUES
  ('tnt_mochi_0001', 'c1', 'm1'), ('tnt_mochi_0001', 'c2', 'm2'),
  ('tnt_mochi_0001', 'c3', 'm3'), ('tnt_mochi_0001', 'c4', 'm4');
-- The notification idempotency ledger (migration 0015). Keyed by a synthetic `key`, never by an
-- entity, so nothing cascades it away — and every row is a permanent "already sent" for that key.
-- logs-notifications.spec.ts presses Send on a forecast row; without this sweep the SECOND run
-- finds that button disabled (title="already sent") and waits for it until the test times out.
DELETE FROM sent_notifications;
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
-- Zalo OTP login/recovery challenges (migration 0051). Never cascades off anything the resets
-- above touch, so a leaked one from a failed run would poison the next run's rate-limit-free
-- "one live challenge per phone" assumption.
DELETE FROM login_codes;
-- Email verification tokens (migration 0052). Cascades off accounts, but the accounts this
-- sweep re-inserts above are ON CONFLICT UPDATEs, not fresh rows, so a stale verification row
-- from a prior run would otherwise survive and let a spec's "not verified yet" assertion see a
-- leftover verified state.
DELETE FROM email_verifications;
-- Check-in kiosk + túi mù. Checks/items cascade off events, but activity types, the bag
-- ledger and gift redemptions are keyed to students that seed.sql keeps — a leaked bag would
-- shift the next run's tally assertions. Also drop the settings row so earn mode is default.
DELETE FROM checklist_checks;
DELETE FROM checklist_items;
DELETE FROM tui_mu_events;
DELETE FROM gift_redemptions;
DELETE FROM checkin_activity_types;
DELETE FROM settings WHERE key = 'checkin-settings';
-- Pronounce scoring: the config spec restores the curve to Off itself, but a failed run must
-- not leak a curve into the next one; usage counters likewise start every run at zero.
DELETE FROM settings WHERE key = 'pronounce-settings';
DELETE FROM usage_counters;
-- Subjects (môn học). seed.sql still writes the legacy free-text `classes.subject`, so re-derive
-- the managed rows and the subject_id link after every reset — otherwise the seeded classes come
-- back reading "General" and the class spec has nothing to pick.
INSERT INTO subjects (id, tenant_id, name, active, sort_order)
SELECT 'sub_' || lower(hex(randomblob(8))), 'tnt_mochi_0001', name, 1, 0
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
INSERT INTO class_levels (id, tenant_id, name, active, sort_order) VALUES
  ('cl1','tnt_mochi_0001','Cơ bản',1,1),('cl2','tnt_mochi_0001','Nâng cao',1,2)
ON CONFLICT(id) DO UPDATE SET
  name       = excluded.name,
  active     = 1,
  sort_order = excluded.sort_order;

-- Khối (grade levels). GLOBAL since migration 0049: no tenant_id, one shared list, writable only by
-- a platform admin. This block is new because the safety net it replaces is gone — a second school's
-- khối rows used to be swept for free by `DELETE FROM tenants WHERE id <> 'tnt_mochi_0001'` cascading
-- through 0045's `REFERENCES tenants(id)`. There is now nothing per-school to sweep, but
-- crud-config*.spec.ts creates, renames and deletes REAL GLOBAL rows, and a run that fails mid-test
-- would leak one into the list crud-core and crud-rankings pick 'Khối 6' from.
--
-- The DELETE must precede the INSERT: `ON CONFLICT(id)` cannot help with a leaked row that holds the
-- NAME 'Khối 6' under a different id, and UNIQUE(name) would abort the statement. Deleting the
-- non-canonical ids first guarantees the four names are free.
--
-- Scoped by id rather than a blanket wipe on purpose: `classes.grade_level_id` is ON DELETE SET NULL,
-- so clearing all four rows would silently unlink every seeded class from its cohort and break the
-- rankings specs.
DELETE FROM grade_levels WHERE id NOT IN ('gl6','gl7','gl8','gl9');
INSERT INTO grade_levels (id, name, active, sort_order) VALUES
  ('gl6','Khối 6',1,1),('gl7','Khối 7',1,2),('gl8','Khối 8',1,3),('gl9','Khối 9',1,4)
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

-- dev@ owns the platform as well as the school, so the /platform and tenant-isolation specs
-- have someone who can enter another school. vunq@ deliberately does NOT, so the specs can
-- assert that an ordinary school Admin is refused.
UPDATE accounts SET is_platform_admin = 1 WHERE email = 'dev@mochi.edu';
UPDATE accounts SET tenant_id = 'tnt_mochi_0001'
  WHERE email IN ('dev@mochi.edu', 'vunq@mochi.edu');

-- Linked to seed student s1 (Leo Park) so the student sees real demo data.
INSERT INTO accounts (id, email, password_hash, student_id, phone_e164, created_at) VALUES
  ('acc-e2e-student-0001', 'vunq@mochi.edu',
   'pbkdf2$100000$3SWEZIbyW5qVC83vVx3TtQ==$r862GZCJplV5TZ2Eg0gWJjzU+UiJJi8I35V3Kem957M=',
   's1', '+84900000001', datetime('now'))
ON CONFLICT(email) DO UPDATE SET
  password_hash = excluded.password_hash,
  student_id    = excluded.student_id,
  phone_e164    = excluded.phone_e164;

-- A parent account (p1, Mina Park — already linked to s1 via parent_students in seed.sql)
-- sharing the SAME phone number as the student above. This is deliberate: the Zalo OTP picker
-- (server/services/login-otp.ts `resolve`) is only reachable when one phone number resolves to
-- more than one account — a parent's own account (matched directly) plus their child's account
-- (matched through parents.phone_e164 -> parent_students) is the real-world shape that produces
-- it, and crud-login-otp.spec.ts exercises the picker against exactly this pair.
UPDATE parents SET phone_e164 = '+84900000001' WHERE id = 'p1';
INSERT INTO accounts (id, email, password_hash, parent_id, phone_e164, created_at) VALUES
  ('acc-e2e-parent-0001', 'mina.park@mochi.edu',
   'pbkdf2$100000$3SWEZIbyW5qVC83vVx3TtQ==$r862GZCJplV5TZ2Eg0gWJjzU+UiJJi8I35V3Kem957M=',
   'p1', '+84900000001', datetime('now'))
ON CONFLICT(email) DO UPDATE SET
  password_hash = excluded.password_hash,
  parent_id     = excluded.parent_id,
  phone_e164    = excluded.phone_e164;
UPDATE accounts SET tenant_id = 'tnt_mochi_0001' WHERE email = 'mina.park@mochi.edu';

-- The paired Zalo chat itself — without this, `login-otp.ts` finds zero chats for the phone
-- above and every OTP request answers with the enumeration-safe decoy, same as an unregistered
-- number. Paired to the PARENT record (route (a), direct — this is p1's own chat), which is also
-- what the family-phone route (b) reaches through parent_students for s1.
INSERT INTO zalo_chats (id, tenant_id, chat_id, kind, parent_id, created_at)
VALUES ('zc-e2e-family-0001', 'tnt_mochi_0001', 'chat-e2e-family-0001', 'user', 'p1', datetime('now'))
ON CONFLICT(chat_id) DO UPDATE SET parent_id = excluded.parent_id, student_id = NULL, class_id = NULL, account_id = NULL;
