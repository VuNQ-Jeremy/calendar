-- Tests module: grade levels (managed enum), question bank, tests, attempts.
-- Replaces homework (dropped in a later migration once the UI has moved over).

CREATE TABLE grade_levels (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  active     INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
INSERT INTO grade_levels (id, name, active, sort_order) VALUES
  ('gl6','Khối 6',1,1),('gl7','Khối 7',1,2),('gl8','Khối 8',1,3),('gl9','Khối 9',1,4);

CREATE TABLE questions (
  id             TEXT PRIMARY KEY,
  type           TEXT NOT NULL,              -- mcq | multi | text | essay
  prompt         TEXT NOT NULL,
  grade_level_id TEXT REFERENCES grade_levels(id) ON DELETE SET NULL,
  difficulty     TEXT,                       -- easy | medium | hard | NULL
  tags           TEXT NOT NULL DEFAULT '[]', -- JSON string[]
  options        TEXT NOT NULL DEFAULT '[]', -- JSON [{id,text}] (mcq/multi only)
  answer_key     TEXT,                       -- JSON: mcq "optId" | multi ["optId"] | text ["accepted"] | essay NULL
  explanation    TEXT,
  created_at     TEXT,
  updated_at     TEXT
);
CREATE INDEX idx_questions_grade_level ON questions(grade_level_id);

CREATE TABLE tests (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  class_id           TEXT REFERENCES classes(id) ON DELETE SET NULL,
  assessment_type_id TEXT REFERENCES assessment_types(id) ON DELETE SET NULL,
  grade_level_id     TEXT REFERENCES grade_levels(id) ON DELETE SET NULL,
  status             TEXT NOT NULL DEFAULT 'draft',   -- draft | published
  mode               TEXT NOT NULL DEFAULT 'online',  -- online | paper
  date               TEXT,                            -- ICT YYYY-MM-DD; becomes score_records.date
  open_at            TEXT,                            -- UTC ISO
  close_at           TEXT,                            -- UTC ISO
  time_limit_minutes INTEGER,
  instructions       TEXT,
  color              TEXT,
  created_at         TEXT
);
CREATE INDEX idx_tests_class ON tests(class_id);

CREATE TABLE test_questions (
  test_id     TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id),  -- deliberately no CASCADE: the service guards deletes
  sort_order  INTEGER NOT NULL DEFAULT 0,
  points      REAL NOT NULL DEFAULT 1,
  PRIMARY KEY (test_id, question_id)
);
CREATE INDEX idx_test_questions_question ON test_questions(question_id);

CREATE TABLE test_attempts (
  id               TEXT PRIMARY KEY,
  test_id          TEXT NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  student_id       TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  source           TEXT NOT NULL DEFAULT 'online',      -- online | paper
  status           TEXT NOT NULL DEFAULT 'in_progress', -- in_progress | submitted | needs_grading | graded
  started_at       TEXT NOT NULL,
  submitted_at     TEXT,
  deadline_at      TEXT,   -- server-computed at start: min(close_at, started_at + time_limit_minutes)
  auto_score       REAL,
  total_score      REAL,
  normalized_score REAL,   -- 0-10; the value that syncs to score_records
  comment          TEXT,
  score_record_id  TEXT REFERENCES score_records(id) ON DELETE SET NULL,
  UNIQUE (test_id, student_id)
);
CREATE INDEX idx_test_attempts_test ON test_attempts(test_id);
CREATE INDEX idx_test_attempts_student ON test_attempts(student_id);

CREATE TABLE test_answers (
  attempt_id    TEXT NOT NULL REFERENCES test_attempts(id) ON DELETE CASCADE,
  question_id   TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  answer        TEXT,    -- JSON: mcq "optId" | multi ["optId"] | text/essay "string"
  auto_correct  INTEGER, -- 1 | 0 | NULL (essay or not yet graded)
  auto_points   REAL,
  manual_points REAL,    -- effective points = manual_points ?? auto_points
  feedback      TEXT,
  PRIMARY KEY (attempt_id, question_id)
);
