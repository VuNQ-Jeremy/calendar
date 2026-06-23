-- Feedback log: ideas, bug reports, and praise.
CREATE TABLE feedback (
  id         TEXT PRIMARY KEY,
  message    TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT 'idea',   -- idea | bug | praise | other
  author     TEXT,
  status     TEXT NOT NULL DEFAULT 'new',     -- new | reviewed | done
  created_at TEXT
);
CREATE INDEX idx_feedback_status ON feedback(status);
