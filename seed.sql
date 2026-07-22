-- Mochi demo seed (optional). Apply with:
--   wrangler d1 execute mochi --local  --file=./seed.sql   (local dev)
--   wrangler d1 execute mochi --remote --file=./seed.sql   (deployed DB)
-- Dates are static (anchored around 2026-06-22, a Monday) for a stable demo.

DELETE FROM parent_students; DELETE FROM class_students; DELETE FROM class_schedule;
DELETE FROM events; DELETE FROM homework; DELETE FROM materials; DELETE FROM invites;
DELETE FROM parents; DELETE FROM classes; DELETE FROM students; DELETE FROM staff;
DELETE FROM feedback; DELETE FROM settings;
DELETE FROM score_records; DELETE FROM behavior_records;

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

INSERT INTO homework (id, title, class_id, due, points, notes, color, done) VALUES
  ('h1', 'Cell diagram lab',  'c1', '2026-06-22', 20, 'Label all organelles.',           'green',  0),
  ('h2', 'Quadratics, set 4', 'c2', '2026-06-23', 15, 'Questions 1-12, show working.',    'blue',   0),
  ('h3', 'Read chapters 5-6', 'c3', '2026-06-24', 10, 'Be ready to discuss memory.',      'violet', 0),
  ('h4', 'Color wheel study', 'c4', '2026-06-21', 25, 'Primary/secondary/tertiary.',      'orange', 0),
  ('h5', 'Vocab quiz prep',   'c3', '2026-06-22', 10, '',                                 'violet', 1);

INSERT INTO materials (id, title, type, class_id, url, file_name, favorite, added_at) VALUES
  ('m1', 'Photosynthesis slides', 'notes',     'c1', '',                        'photosynthesis.pdf', 1, '2026-06-22'),
  ('m2', 'Khan: Quadratics',      'link',      'c2', 'https://khanacademy.org', '',                   0, '2026-06-22'),
  ('m3', 'Essay rubric',          'worksheet', 'c3', '',                        'rubric.docx',        1, '2026-06-22'),
  ('m4', 'Intro to color theory', 'video',     'c4', 'https://youtube.com',     '',                   0, '2026-06-22');

INSERT INTO invites (id, code, role, name, class_id, created_at, used) VALUES
  ('i1', 'ABC-234', 'Student', 'Ivy Tran',        'c1', '2026-06-22', 0),
  ('i2', 'KLM-789', 'Parent',  'Mina Park (Leo)', NULL, '2026-06-22', 1);

INSERT INTO feedback (id, message, category, author, status, created_at) VALUES
  ('fb1', 'Love the calendar color themes — the per-class hues make my week so easy to scan.', 'praise', 'Priya Nair', 'reviewed', '2026-06-20'),
  ('fb2', 'Could we get a print / PDF export of the month view for the staff room board?',      'idea',   'Sam Okafor', 'new',      '2026-06-21');

INSERT INTO settings (key, value) VALUES
  ('theme', '{"bg":"#FFFCF8","gridLine":"#ECE0CF","today":"#FFE7D1","header":"#FDF6EC","bgImage":"","bgOpacity":0.12}');

INSERT INTO score_records (id, student_id, class_id, date, score, label, notes) VALUES
  ('sc1',  's1', 'c1', '2026-05-04', 6.5, 'Kiểm tra miệng',   NULL),
  ('sc2',  's1', 'c1', '2026-05-18', 7.0, 'Kiểm tra 15 phút', NULL),
  ('sc3',  's1', 'c1', '2026-06-01', 7.5, 'Kiểm tra 1 tiết',  'Improving steadily.'),
  ('sc4',  's1', 'c1', '2026-06-15', 8.5, 'Giữa kỳ',          'Great progress!'),
  ('sc5',  's1', 'c3', '2026-05-11', 7.0, 'Essay draft',      NULL),
  ('sc6',  's1', 'c3', '2026-06-08', 8.0, 'Essay final',      NULL),
  ('sc7',  's2', 'c1', '2026-05-06', 8.0, 'Kiểm tra miệng',   NULL),
  ('sc8',  's2', 'c2', '2026-05-20', 5.5, 'Kiểm tra 15 phút', 'Struggled with quadratics.'),
  ('sc9',  's2', 'c2', '2026-06-03', 6.5, 'Kiểm tra 1 tiết',  NULL),
  ('sc10', 's2', 'c2', '2026-06-17', 7.5, 'Giữa kỳ',          'Big improvement.'),
  ('sc11', 's4', 'c2', '2026-05-12', 4.5, 'Kiểm tra 15 phút', NULL),
  ('sc12', 's4', 'c2', '2026-06-09', 6.0, 'Kiểm tra 1 tiết',  NULL);

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
