-- Student assessment: score records + behavior/attitude records.
CREATE TABLE score_records (
  id         TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id   TEXT REFERENCES classes(id) ON DELETE SET NULL,
  date       TEXT NOT NULL,
  score      REAL NOT NULL,
  label      TEXT,
  notes      TEXT
);
CREATE INDEX idx_score_records_student ON score_records(student_id, date);
CREATE INDEX idx_score_records_class ON score_records(class_id);

CREATE TABLE behavior_records (
  id         TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id   TEXT REFERENCES classes(id) ON DELETE SET NULL,
  date       TEXT NOT NULL,
  type       TEXT NOT NULL,
  notes      TEXT
);
CREATE INDEX idx_behavior_records_student ON behavior_records(student_id, date);
CREATE INDEX idx_behavior_records_class ON behavior_records(class_id);
