-- Practice (Nhiệm vụ) demo data, for clicking through the feature by hand.
--
-- NOT a test fixture: e2e specs build their own rows and clean up after themselves (see
-- e2e/crud-practice.spec.ts). This exists for the manual pass — a review queue with nothing in
-- it renders an Empty state, so there is nothing to press Accept on.
--
-- Every row it writes has an id starting `seedtest-`, which is what makes the cleanup at the
-- bottom of this file remove exactly what it added and nothing else. The two tables with no id
-- column (practice_settings, practice_warnings) are keyed on the class, so the cleanup scopes
-- those to the seeded class instead.
--
-- Target class: the class with the most students. To pin a different one, replace the four
-- `LIKE '%'` patterns marked CLASS NAME below with the same fragment, e.g. `LIKE '%Biology%'`.
--
-- Dates are ICT (UTC+7), matching the app: `date('now','+7 hours')` is today in Hanoi.
-- Submissions carry no media_key on purpose — R2 has no object to serve, and the review card
-- already renders note + times when the proof is absent.

-- 1. Turn Practice on for the class, with every weekday a practice day so the week grid is
--    predictable whatever day you run this.
INSERT OR REPLACE INTO practice_settings (class_id, tenant_id, enabled, weekdays, created_at)
SELECT c.id, c.tenant_id, 1, '0,1,2,3,4,5,6', strftime('%Y-%m-%dT%H:%M:%SZ','now')
FROM classes c
WHERE c.id = (SELECT id FROM classes WHERE name LIKE '%'  -- CLASS NAME
              ORDER BY (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = classes.id) DESC,
                       name ASC LIMIT 1);

-- 2. Three class tasks: two today, one yesterday.
INSERT INTO practice_tasks (id, tenant_id, class_id, date, title, proof_type, sort_order, created_at)
SELECT 'seedtest-task-a', c.tenant_id, c.id, date('now','+7 hours'),
       'TEST Workbook p.12-15', 'either', 0, strftime('%Y-%m-%dT%H:%M:%SZ','now')
FROM classes c
WHERE c.id = (SELECT id FROM classes WHERE name LIKE '%'  -- CLASS NAME
              ORDER BY (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = classes.id) DESC,
                       name ASC LIMIT 1);

INSERT INTO practice_tasks (id, tenant_id, class_id, date, title, proof_type, sort_order, created_at)
SELECT 'seedtest-task-b', c.tenant_id, c.id, date('now','+7 hours'),
       'TEST Read aloud unit 4 and record', 'video', 1, strftime('%Y-%m-%dT%H:%M:%SZ','now')
FROM classes c
WHERE c.id = (SELECT id FROM classes WHERE name LIKE '%'  -- CLASS NAME
              ORDER BY (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = classes.id) DESC,
                       name ASC LIMIT 1);

INSERT INTO practice_tasks (id, tenant_id, class_id, date, title, proof_type, sort_order, created_at)
SELECT 'seedtest-task-c', c.tenant_id, c.id, date('now','+7 hours','-1 day'),
       'TEST Grammar in Use unit 3', 'photo', 0, strftime('%Y-%m-%dT%H:%M:%SZ','now')
FROM classes c
WHERE c.id = (SELECT id FROM classes WHERE name LIKE '%'  -- CLASS NAME
              ORDER BY (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = classes.id) DESC,
                       name ASC LIMIT 1);

-- 3. Task A -> one SUBMITTED copy per student. This is the row that fills the review queue.
INSERT INTO practice_student_tasks
  (id, tenant_id, task_id, class_id, student_id, date, title, proof_type, sort_order,
   status, submitted_at, time_from, time_to, note)
SELECT 'seedtest-st-a-' || cs.student_id, t.tenant_id, t.id, t.class_id, cs.student_id,
       t.date, t.title, t.proof_type, 0,
       'submitted', strftime('%Y-%m-%dT%H:%M:%SZ','now','-90 minutes'), '19:30', '20:10',
       'TEST em khong hieu cau 4, thay xem giup em a'
FROM practice_tasks t
JOIN class_students cs ON cs.class_id = t.class_id
WHERE t.id = 'seedtest-task-a';

-- 4. Task B -> still OPEN for everyone, so the week column shows 0 / N next to A's N / N.
INSERT INTO practice_student_tasks
  (id, tenant_id, task_id, class_id, student_id, date, title, proof_type, sort_order, status)
SELECT 'seedtest-st-b-' || cs.student_id, t.tenant_id, t.id, t.class_id, cs.student_id,
       t.date, t.title, t.proof_type, 1, 'open'
FROM practice_tasks t
JOIN class_students cs ON cs.class_id = t.class_id
WHERE t.id = 'seedtest-task-b';

-- 5. Task C (yesterday) -> already ACCEPTED with teacher feedback, so the ledger has something
--    in the done column and the week grid shows a finished day.
INSERT INTO practice_student_tasks
  (id, tenant_id, task_id, class_id, student_id, date, title, proof_type, sort_order,
   status, submitted_at, time_from, time_to, feedback, reviewed_at)
SELECT 'seedtest-st-c-' || cs.student_id, t.tenant_id, t.id, t.class_id, cs.student_id,
       t.date, t.title, t.proof_type, 0,
       'accepted', strftime('%Y-%m-%dT%H:%M:%SZ','now','-1 day'), '20:00', '20:35',
       'TEST 8/10 - lam tot, chu y thi qua khu', strftime('%Y-%m-%dT%H:%M:%SZ','now','-20 hours')
FROM practice_tasks t
JOIN class_students cs ON cs.class_id = t.class_id
WHERE t.id = 'seedtest-task-c';

-- 6. Two PENDING excuse requests — the block that sits above the review queue.
INSERT INTO practice_excuses
  (id, tenant_id, class_id, student_id, date, reason, status, requested_by, requested_at)
SELECT 'seedtest-exc-' || s.id, ps.tenant_id, ps.class_id, s.id,
       date('now','+7 hours'), 'TEST em bi om, xin phep nghi hom nay a',
       'pending', 'student', strftime('%Y-%m-%dT%H:%M:%SZ','now','-3 hours')
FROM practice_settings ps
JOIN class_students cs ON cs.class_id = ps.class_id
JOIN students s ON s.id = cs.student_id
WHERE ps.class_id = (SELECT class_id FROM practice_tasks WHERE id = 'seedtest-task-a')
ORDER BY s.name ASC LIMIT 2;

-- 7. Two unexcused misses and a level-2 warning for ONE student, so the ledger shows the xN
--    badge and the "Clear warning" button has something to clear.
INSERT INTO practice_misses
  (id, tenant_id, class_id, student_id, date, excused, multiplier, created_at)
SELECT 'seedtest-miss-1-' || s.id, ps.tenant_id, ps.class_id, s.id,
       date('now','+7 hours','-3 days'), 0, 2, strftime('%Y-%m-%dT%H:%M:%SZ','now')
FROM practice_settings ps
JOIN class_students cs ON cs.class_id = ps.class_id
JOIN students s ON s.id = cs.student_id
WHERE ps.class_id = (SELECT class_id FROM practice_tasks WHERE id = 'seedtest-task-a')
ORDER BY s.name ASC LIMIT 1;

INSERT INTO practice_misses
  (id, tenant_id, class_id, student_id, date, excused, multiplier, created_at)
SELECT 'seedtest-miss-2-' || s.id, ps.tenant_id, ps.class_id, s.id,
       date('now','+7 hours','-2 days'), 0, 3, strftime('%Y-%m-%dT%H:%M:%SZ','now')
FROM practice_settings ps
JOIN class_students cs ON cs.class_id = ps.class_id
JOIN students s ON s.id = cs.student_id
WHERE ps.class_id = (SELECT class_id FROM practice_tasks WHERE id = 'seedtest-task-a')
ORDER BY s.name ASC LIMIT 1;

INSERT OR REPLACE INTO practice_warnings
  (tenant_id, class_id, student_id, level, pending_multiplier, pending_for_date, updated_at)
SELECT tenant_id, class_id, student_id, 2, 3, date('now','+7 hours'),
       strftime('%Y-%m-%dT%H:%M:%SZ','now')
FROM practice_misses WHERE id LIKE 'seedtest-miss-2-%';

-- 8. Report back which class was seeded and how much, so a wrong CLASS NAME is obvious
--    immediately rather than after clicking around an empty page.
SELECT c.name AS seeded_class,
       (SELECT COUNT(*) FROM class_students WHERE class_id = c.id) AS students,
       (SELECT COUNT(*) FROM practice_student_tasks
         WHERE id LIKE 'seedtest-%' AND status = 'submitted')      AS in_review_queue,
       (SELECT COUNT(*) FROM practice_excuses WHERE id LIKE 'seedtest-%') AS pending_excuses
FROM classes c
WHERE c.id = (SELECT class_id FROM practice_tasks WHERE id = 'seedtest-task-a');
