-- "Preview buổi sau": what the next occurrence of a class will cover, and what will be checked.
--
-- A weekly class is ONE `events` row expanded at read time (shared/logic/recurrence.ts), so
-- per-occurrence data has to key on (event_id, date) — the same shape attendance_records uses.
-- `events.notes` stays what it has always been: one blob for the whole series.
--
-- `focus_text` is the teacher's free text ("buổi sau học gì"). `vocab_topic_id` is a column
-- rather than something inferred because flashcard_topics has no class link — nothing in the
-- schema can tell you which topic a class is on, only a person can.
--
-- The tests to be checked are deliberately NOT stored here. They are composed at read time from
-- `tests` (server/services/session-preview.ts), so rescheduling or unpublishing a test can never
-- leave a stale promise behind in a preview a parent already read.
CREATE TABLE IF NOT EXISTS session_previews (
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  focus_text TEXT NOT NULL DEFAULT '',
  vocab_topic_id TEXT REFERENCES flashcard_topics(id) ON DELETE SET NULL,
  updated_at TEXT,
  PRIMARY KEY (event_id, date)
);

-- The evening cron and the student's upcoming-sessions endpoint both look these up by date.
CREATE INDEX IF NOT EXISTS idx_session_previews_date ON session_previews (date);
