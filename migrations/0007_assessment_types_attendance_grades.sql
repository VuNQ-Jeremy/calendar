-- Assessment types (managed enum), attendance, and homework grading.

CREATE TABLE assessment_types (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  active     INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO assessment_types (id, name, active, sort_order) VALUES
  ('at1', 'Kiểm tra miệng',   1, 1),
  ('at2', 'Kiểm tra 15 phút', 1, 2),
  ('at3', 'Kiểm tra 1 tiết',  1, 3),
  ('at4', 'Giữa kỳ',          1, 4),
  ('at5', 'Essay draft',      1, 5),
  ('at6', 'Essay final',      1, 6);

-- Preserve any other free-text labels already present in real data.
INSERT INTO assessment_types (id, name, active, sort_order)
SELECT lower(hex(randomblob(16))), label, 1, 100
FROM (SELECT DISTINCT label FROM score_records
      WHERE label IS NOT NULL AND label <> ''
        AND label NOT IN (SELECT name FROM assessment_types));

ALTER TABLE score_records ADD COLUMN assessment_type_id TEXT
  REFERENCES assessment_types(id) ON DELETE SET NULL;
UPDATE score_records
  SET assessment_type_id = (SELECT id FROM assessment_types t WHERE t.name = score_records.label);
ALTER TABLE score_records DROP COLUMN label;
CREATE INDEX idx_score_records_type ON score_records(assessment_type_id);

ALTER TABLE homework ADD COLUMN assessment_type_id TEXT
  REFERENCES assessment_types(id) ON DELETE SET NULL;

CREATE TABLE attendance_records (
  event_id   TEXT NOT NULL REFERENCES events(id)   ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,          -- occurrence date (recurring events share event_id)
  status     TEXT NOT NULL,          -- present | absent | late | excused
  PRIMARY KEY (event_id, date, student_id)
);
CREATE INDEX idx_attendance_student ON attendance_records(student_id, date);

CREATE TABLE homework_grades (
  id              TEXT PRIMARY KEY,
  homework_id     TEXT NOT NULL REFERENCES homework(id) ON DELETE CASCADE,
  student_id      TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  score           REAL,
  comment         TEXT,
  graded_at       TEXT,
  score_record_id TEXT REFERENCES score_records(id) ON DELETE SET NULL,
  UNIQUE (homework_id, student_id)
);
CREATE INDEX idx_homework_grades_hw      ON homework_grades(homework_id);
CREATE INDEX idx_homework_grades_student ON homework_grades(student_id);
