-- Allow staff plays to be recorded: student_id becomes nullable, staff_id added.
CREATE TABLE flashcard_results_new (
  id          TEXT PRIMARY KEY,
  student_id  TEXT REFERENCES students(id) ON DELETE CASCADE,
  staff_id    TEXT REFERENCES staff(id) ON DELETE CASCADE,
  topic_id    TEXT NOT NULL REFERENCES flashcard_topics(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL,
  score       INTEGER NOT NULL,
  total       INTEGER NOT NULL,
  duration_ms INTEGER,
  played_at   TEXT NOT NULL
);
INSERT INTO flashcard_results_new (id, student_id, topic_id, mode, score, total, duration_ms, played_at)
  SELECT id, student_id, topic_id, mode, score, total, duration_ms, played_at FROM flashcard_results;
DROP TABLE flashcard_results;
ALTER TABLE flashcard_results_new RENAME TO flashcard_results;
CREATE INDEX idx_flashcard_results_topic ON flashcard_results(topic_id, played_at);
CREATE INDEX idx_flashcard_results_student ON flashcard_results(student_id, played_at);
