CREATE TABLE flashcard_topics (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  color       TEXT NOT NULL DEFAULT 'violet',
  created_at  TEXT
);

CREATE TABLE flashcard_words (
  id            TEXT PRIMARY KEY,
  topic_id      TEXT NOT NULL REFERENCES flashcard_topics(id) ON DELETE CASCADE,
  word          TEXT NOT NULL,
  meaning_vi    TEXT NOT NULL,
  definition_en TEXT,
  ipa           TEXT,
  audio_url     TEXT,
  created_at    TEXT
);
CREATE INDEX idx_flashcard_words_topic ON flashcard_words(topic_id);

CREATE TABLE flashcard_results (
  id          TEXT PRIMARY KEY,
  student_id  TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  topic_id    TEXT NOT NULL REFERENCES flashcard_topics(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL,
  score       INTEGER NOT NULL,
  total       INTEGER NOT NULL,
  duration_ms INTEGER,
  played_at   TEXT NOT NULL
);
CREATE INDEX idx_flashcard_results_topic ON flashcard_results(topic_id, played_at);
CREATE INDEX idx_flashcard_results_student ON flashcard_results(student_id, played_at);

CREATE TABLE flashcard_mastery (
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  word_id    TEXT NOT NULL REFERENCES flashcard_words(id) ON DELETE CASCADE,
  correct    INTEGER NOT NULL DEFAULT 0,
  wrong      INTEGER NOT NULL DEFAULT 0,
  last_seen  TEXT,
  PRIMARY KEY (student_id, word_id)
);
CREATE INDEX idx_flashcard_mastery_word ON flashcard_mastery(word_id);
