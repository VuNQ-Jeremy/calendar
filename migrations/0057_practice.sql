-- 0057: Practice (Nhiệm vụ) — teacher-planned daily self-study tasks, copied per student, with
-- proof submissions, an excused-miss quota and an escalating penalty badge.
--
-- NOT the old homework feature: `homework` / `homework_grades` (0001/0007) are dead, unscoped and
-- deliberately untouched. Every table here carries tenant_id and an idx_*_tenant index because
-- 0045 will not rebuild them for us.
--
-- Dates are ICT 'YYYY-MM-DD'. The deadline of a practice day is the end of that day in ICT; the
-- 00:00 ICT cron (server/services/practice-notify.ts) is the only thing that decides a miss.

-- One row per class that opted in. `weekdays` is a comma list of ICT weekday numbers (0=Sun..6=Sat)
-- that are practice days by default; per-date exceptions live in practice_day_overrides.
CREATE TABLE practice_settings (
  class_id      TEXT PRIMARY KEY REFERENCES classes(id) ON DELETE CASCADE,
  tenant_id     TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  weekdays      TEXT NOT NULL DEFAULT '1,2,3,4,5,6',
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_practice_settings_tenant ON practice_settings(tenant_id);

-- A teacher's per-date decision that beats the weekday mask: 1 = practice day, 0 = day off.
CREATE TABLE practice_day_overrides (
  tenant_id     TEXT NOT NULL,
  class_id      TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  date          TEXT NOT NULL,
  is_practice   INTEGER NOT NULL,
  PRIMARY KEY (class_id, date)
);
CREATE INDEX idx_practice_day_overrides_tenant ON practice_day_overrides(tenant_id);

-- The class-level task as the teacher typed it. Copies are what students see.
CREATE TABLE practice_tasks (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  class_id      TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  date          TEXT NOT NULL,
  title         TEXT NOT NULL,
  -- SET NULL, not CASCADE: deleting a library file must not delete the task.
  material_id   TEXT REFERENCES materials(id) ON DELETE SET NULL,
  url           TEXT,
  proof_type    TEXT NOT NULL DEFAULT 'either',   -- photo | video | either | none
  sort_order    INTEGER NOT NULL DEFAULT 0,
  staff_id      TEXT REFERENCES staff(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_practice_tasks_class_date ON practice_tasks(class_id, date);
CREATE INDEX idx_practice_tasks_tenant ON practice_tasks(tenant_id);

-- One row per (student, task). task_id is NULL for a task added for one student only, and becomes
-- NULL when the class task is deleted after this copy was already submitted.
-- The submission lives on the same row: one submission per copy, a resubmit overwrites it.
CREATE TABLE practice_student_tasks (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  task_id             TEXT REFERENCES practice_tasks(id) ON DELETE SET NULL,
  class_id            TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id          TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date                TEXT NOT NULL,
  title               TEXT NOT NULL,
  material_id         TEXT REFERENCES materials(id) ON DELETE SET NULL,
  url                 TEXT,
  proof_type          TEXT NOT NULL DEFAULT 'either',
  sort_order          INTEGER NOT NULL DEFAULT 0,
  -- open | submitted | accepted | rejected | teacher_done
  status              TEXT NOT NULL DEFAULT 'open',
  submitted_at        TEXT,
  time_from           TEXT,          -- ICT HH:mm, self-reported
  time_to             TEXT,
  media_key           TEXT,          -- R2 key under t/<tenant>/practice/<id>/...
  media_type          TEXT,          -- image/jpeg | video/mp4
  note                TEXT,          -- student's question / note
  feedback            TEXT,          -- teacher's "Kết quả + Nhận xét"
  reject_reason       TEXT,
  reviewed_at         TEXT,
  reviewed_by         TEXT REFERENCES staff(id) ON DELETE SET NULL,
  recorded_by_teacher INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_practice_student_tasks_student_date ON practice_student_tasks(student_id, date);
CREATE INDEX idx_practice_student_tasks_class_date   ON practice_student_tasks(class_id, date);
CREATE INDEX idx_practice_student_tasks_status       ON practice_student_tasks(status, submitted_at);
CREATE INDEX idx_practice_student_tasks_tenant       ON practice_student_tasks(tenant_id);

-- A student's request to be excused for one practice day. Only one per (student, class, date).
CREATE TABLE practice_excuses (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  class_id      TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id    TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date          TEXT NOT NULL,
  reason        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  requested_by  TEXT NOT NULL,                      -- 'student' | 'teacher'
  requested_at  TEXT NOT NULL,
  decided_at    TEXT,
  decided_by    TEXT REFERENCES staff(id) ON DELETE SET NULL,
  UNIQUE (class_id, student_id, date)
);
CREATE INDEX idx_practice_excuses_status ON practice_excuses(status, requested_at);
CREATE INDEX idx_practice_excuses_tenant ON practice_excuses(tenant_id);

-- One row per missed practice day, written only by the nightly finalize job (or flipped to
-- excused by a teacher afterwards). `multiplier` is the ×N this miss imposed on the next day.
CREATE TABLE practice_misses (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL,
  class_id            TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id          TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date                TEXT NOT NULL,
  excused             INTEGER NOT NULL DEFAULT 0,
  multiplier          INTEGER NOT NULL DEFAULT 0,
  behavior_record_id  TEXT,
  created_at          TEXT NOT NULL,
  UNIQUE (class_id, student_id, date)
);
CREATE INDEX idx_practice_misses_student ON practice_misses(student_id, date);
CREATE INDEX idx_practice_misses_tenant  ON practice_misses(tenant_id);

-- The lifetime escalation state per (class, student). `level` = unexcused misses since the last
-- clear; `pending_multiplier` / `pending_for_date` = the ×N currently owed and the day it is due.
CREATE TABLE practice_warnings (
  tenant_id           TEXT NOT NULL,
  class_id            TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id          TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  level               INTEGER NOT NULL DEFAULT 0,
  pending_multiplier  INTEGER NOT NULL DEFAULT 0,
  pending_for_date    TEXT,
  pending_from_miss   TEXT,
  updated_at          TEXT NOT NULL,
  cleared_at          TEXT,
  cleared_by          TEXT REFERENCES staff(id) ON DELETE SET NULL,
  PRIMARY KEY (class_id, student_id)
);
CREATE INDEX idx_practice_warnings_tenant ON practice_warnings(tenant_id);
