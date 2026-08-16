-- Mochi demo seed (optional). Apply with:
--   wrangler d1 execute mochi --local  --file=./seed.sql   (local dev)
--   wrangler d1 execute mochi --remote --file=./seed.sql   (deployed DB)
-- Dates are static (anchored around 2026-06-22, a Monday) for a stable demo.

DELETE FROM attendance_records;
DELETE FROM parent_students; DELETE FROM class_students; DELETE FROM class_schedule;
DELETE FROM events; DELETE FROM materials; DELETE FROM invites;
DELETE FROM parents; DELETE FROM classes; DELETE FROM students; DELETE FROM staff;
DELETE FROM feedback; DELETE FROM settings;
DELETE FROM score_records; DELETE FROM behavior_records; DELETE FROM assessment_types;

INSERT INTO staff (id, name, email, role, color, phone) VALUES
  ('u1', 'Sam Okafor', 'sam@school.edu',  'Admin',   'orange', '(555) 010-2280'),
  ('u2', 'Priya Nair', 'priya@school.edu','Teacher', 'violet', '(555) 010-7741');

-- Bootstrap accounts (admin/dev) live outside the demo dataset above. The DELETE FROM staff
-- statement removes their staff rows and fires accounts.staff_id ON DELETE SET NULL (which
-- breaks their login), so re-insert the rows AND re-link the accounts afterwards.
INSERT INTO staff (id, name, email, role, color) VALUES
  ('admin-0000-0000-0000-000000000001', 'Admin', 'admin@mochi.edu', 'Admin', 'orange'),
  ('dev-0000-0000-0000-000000000002',   'Dev',   'dev@mochi.edu',   'Admin', 'blue')
ON CONFLICT(id) DO NOTHING;
UPDATE accounts SET staff_id = 'admin-0000-0000-0000-000000000001' WHERE email = 'admin@mochi.edu';
UPDATE accounts SET staff_id = 'dev-0000-0000-0000-000000000002'   WHERE email = 'dev@mochi.edu';

INSERT INTO students (id, name, grade, guardian, email, color) VALUES
  ('s1', 'Leo Park',     '9', 'Mina Park',    'leo@school.edu',  'green'),
  ('s2', 'Mia Chen',     '9', 'David Chen',   'mia@school.edu',  'blue'),
  ('s3', 'Ada Rivera',   '9', 'Sofia Rivera', 'ada@school.edu',  'violet'),
  ('s4', 'Noah Bennett', '9', 'Greg Bennett', 'noah@school.edu', 'orange');

INSERT INTO classes (id, name, subject, color, room) VALUES
  ('c1', 'Biology 9A', 'Science', 'green',  'Room 204'),
  ('c2', 'Algebra II', 'Math',    'blue',   'Room 110'),
  ('c3', 'World Lit',  'English', 'violet', 'Room 301'),
  ('c4', 'Studio Art', 'Art',     'orange', 'Studio B');

INSERT INTO class_schedule (class_id, day, start_time, end_time) VALUES
  ('c1', 1, '09:00', '09:45'), ('c1', 3, '09:00', '09:45'),
  ('c2', 2, '11:00', '11:50'), ('c2', 4, '11:00', '11:50'),
  ('c3', 1, '13:00', '13:50'), ('c3', 5, '13:00', '13:50'),
  ('c4', 3, '15:00', '16:00');

INSERT INTO class_students (class_id, student_id) VALUES
  ('c1', 's1'), ('c1', 's2'), ('c1', 's3'),
  ('c2', 's2'), ('c2', 's4'),
  ('c3', 's1'), ('c3', 's3'), ('c3', 's4'),
  ('c4', 's3');

INSERT INTO parents (id, name, email, phone, color, relation) VALUES
  ('p1', 'Mina Park',    'mina.park@home.com',    '(555) 240-1180', 'green',  'Mother'),
  ('p2', 'David Chen',   'david.chen@home.com',   '(555) 240-7732', 'blue',   'Father'),
  ('p3', 'Sofia Rivera', 'sofia.rivera@home.com', '',               'violet', 'Mother'),
  ('p4', 'Greg Bennett', 'greg.bennett@home.com', '(555) 240-9026', 'orange', 'Father');

INSERT INTO parent_students (parent_id, student_id) VALUES
  ('p1', 's1'), ('p2', 's2'), ('p3', 's3'), ('p4', 's4');

INSERT INTO events (id, title, date, start_time, end_time, color, class_id, location, recurrence) VALUES
  ('e1', 'Biology 9A',    '2026-06-22', '09:00', '09:45', 'green',  'c1',  'Room 204', 'weekly'),
  ('e2', 'Algebra II',    '2026-06-23', '11:00', '11:50', 'blue',   'c2',  'Room 110', 'weekly'),
  ('e3', 'Staff meeting', '2026-06-22', '15:30', '16:15', 'cocoa',  NULL,  'Library',  'none'),
  ('e4', 'World Lit',     '2026-06-22', '13:00', '13:50', 'violet', 'c3',  'Room 301', 'weekly'),
  ('e5', 'Studio Art',    '2026-06-24', '15:00', '16:00', 'orange', 'c4',  'Studio B', 'weekly'),
  ('e6', 'Science fair',  '2026-06-26', '10:00', '12:00', 'green',  'c1',  'Gym',      'none'),
  ('e7', 'Parent night',  '2026-06-27', '18:00', '19:30', 'rose',   NULL,  'Hall',     'none');

INSERT INTO assessment_types (id, name, active, sort_order) VALUES
  ('at1', 'Kiểm tra miệng',   1, 1),
  ('at2', 'Kiểm tra 15 phút', 1, 2),
  ('at3', 'Kiểm tra 1 tiết',  1, 3),
  ('at4', 'Giữa kỳ',          1, 4),
  ('at5', 'Essay draft',      1, 5),
  ('at6', 'Essay final',      1, 6);

INSERT INTO materials (id, title, type, url, file_name, favorite, added_at) VALUES
  ('m1', 'Photosynthesis slides', 'notes',     '',                        'photosynthesis.pdf', 1, '2026-06-22'),
  ('m2', 'Khan: Quadratics',      'link',      'https://khanacademy.org', '',                   0, '2026-06-22'),
  ('m3', 'Essay rubric',          'worksheet', '',                        'rubric.docx',        1, '2026-06-22'),
  ('m4', 'Intro to color theory', 'video',     'https://youtube.com',     '',                   0, '2026-06-22');

-- Which class carries which file — a join, so a material can be shared by several classes.
INSERT INTO class_materials (class_id, material_id) VALUES
  ('c1', 'm1'), ('c2', 'm2'), ('c3', 'm3'), ('c4', 'm4');

INSERT INTO invites (id, code, role, name, class_id, created_at, used) VALUES
  ('i1', 'ABC-234', 'Student', 'Ivy Tran',        'c1', '2026-06-22', 0),
  ('i2', 'KLM-789', 'Parent',  'Mina Park (Leo)', NULL, '2026-06-22', 1);

INSERT INTO feedback (id, message, category, author, status, created_at, ref) VALUES
  ('fb1', 'Love the calendar color themes — the per-class hues make my week so easy to scan.', 'praise', 'Priya Nair', 'reviewed', '2026-06-20', 1),
  ('fb2', 'Could we get a print / PDF export of the month view for the staff room board?',      'idea',   'Sam Okafor', 'new',      '2026-06-21', 2);

INSERT INTO settings (key, value) VALUES
  ('theme', '{"bg":"#FFFCF8","gridLine":"#ECE0CF","today":"#FFE7D1","header":"#FDF6EC","bgImage":"","bgOpacity":0.12}');

INSERT INTO score_records (id, student_id, class_id, date, score, assessment_type_id, notes) VALUES
  ('sc1',  's1', 'c1', '2026-05-04', 6.5, 'at1', NULL),
  ('sc2',  's1', 'c1', '2026-05-18', 7.0, 'at2', NULL),
  ('sc3',  's1', 'c1', '2026-06-01', 7.5, 'at3', 'Improving steadily.'),
  ('sc4',  's1', 'c1', '2026-06-15', 8.5, 'at4', 'Great progress!'),
  ('sc5',  's1', 'c3', '2026-05-11', 7.0, 'at5', NULL),
  ('sc6',  's1', 'c3', '2026-06-08', 8.0, 'at6', NULL),
  ('sc7',  's2', 'c1', '2026-05-06', 8.0, 'at1', NULL),
  ('sc8',  's2', 'c2', '2026-05-20', 5.5, 'at2', 'Struggled with quadratics.'),
  ('sc9',  's2', 'c2', '2026-06-03', 6.5, 'at3', NULL),
  ('sc10', 's2', 'c2', '2026-06-17', 7.5, 'at4', 'Big improvement.'),
  ('sc11', 's4', 'c2', '2026-05-12', 4.5, 'at2', NULL),
  ('sc12', 's4', 'c2', '2026-06-09', 6.0, 'at3', NULL),
  ('sc13', 's2', 'c2', '2026-06-23', 7.5, 'at2', 'Good working shown.'),
  ('sc14', 's4', 'c2', '2026-06-23', 6.0, 'at2', 'Check sign errors in Q7-9.');

INSERT INTO behavior_records (id, student_id, class_id, date, type, notes) VALUES
  ('bh1',  's2', 'c2', '2026-04-28', 'late',             NULL),
  ('bh2',  's2', 'c2', '2026-05-05', 'late',             NULL),
  ('bh3',  's2', 'c1', '2026-05-06', 'missing_homework', 'Cell diagram not handed in.'),
  ('bh4',  's2', 'c2', '2026-05-12', 'late',             NULL),
  ('bh5',  's2', 'c2', '2026-05-26', 'missing_homework', NULL),
  ('bh6',  's2', 'c2', '2026-06-09', 'late',             NULL),
  ('bh7',  's2', 'c2', '2026-06-17', 'praise',           'Helped classmates before the midterm.'),
  ('bh8',  's4', 'c2', '2026-05-07', 'absent',           'Sick day.'),
  ('bh9',  's4', 'c3', '2026-05-14', 'missing_homework', NULL),
  ('bh10', 's4', 'c2', '2026-05-21', 'absent',           NULL),
  ('bh11', 's4', 'c3', '2026-06-04', 'disruptive',       'Talking during reading time.'),
  ('bh12', 's4', 'c2', '2026-06-16', 'praise',           'Volunteered to present.');

INSERT INTO attendance_records (event_id, student_id, date, status) VALUES
  ('e1', 's1', '2026-06-22', 'present'),
  ('e1', 's2', '2026-06-22', 'late'),
  ('e1', 's3', '2026-06-22', 'absent');

