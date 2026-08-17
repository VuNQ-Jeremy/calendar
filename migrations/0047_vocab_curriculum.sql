-- The curriculum spine: a grade is taught from one or more books, each with numbered units.
--
-- The DECK IS THE UNIT. `flashcard_topics` gains `curriculum_id` + `unit_no` rather than a new
-- `vocab_units` table sitting above it, because everything downstream already keys on `topic_id` —
-- the thirteen games, `vocab_assignments`, the garden's `ref_id`s, `flashcard_mastery`, and the
-- mobile offline bundle. Inserting a level above the deck would repoint all of them for no gain a
-- teacher can see. A deck with `curriculum_id IS NULL` is a free-standing deck, which is every row
-- that exists today.
--
-- A curriculum is two-tier like `flashcard_topics`: `tenant_id NULL` is the platform library that
-- every school reads through `db.pool()`, and a school's own rows are its private books.
--
-- No `subject_id`, deliberately: `subjects` is a per-school managed enum with UNIQUE(tenant_id,
-- name), so a platform-library row could not reference one. Vocabulary is English here by
-- construction. Add it the day a second subject actually needs decks.
CREATE TABLE vocab_curricula (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT,
  grade_level_id TEXT REFERENCES grade_levels(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  slug           TEXT NOT NULL,
  publisher      TEXT,
  description    TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT
);
CREATE INDEX idx_vocab_curricula_tenant ON vocab_curricula(tenant_id);
CREATE INDEX idx_vocab_curricula_grade ON vocab_curricula(grade_level_id);
-- Slug uniqueness is enforced in app code across the READABLE POOL (own + platform), the same way
-- flashcard_topics.slug is. A UNIQUE index here would let a school's slug collide with a platform
-- one and fail the insert instead of picking the next free suffix.
CREATE INDEX idx_vocab_curricula_slug ON vocab_curricula(slug);

ALTER TABLE flashcard_topics ADD COLUMN curriculum_id TEXT REFERENCES vocab_curricula(id) ON DELETE SET NULL;
ALTER TABLE flashcard_topics ADD COLUMN unit_no INTEGER;
CREATE INDEX idx_flashcard_topics_curriculum ON flashcard_topics(curriculum_id, unit_no);

-- Part of speech: every row in the source textbooks carries one ("Loại từ" / "Từ loại"), the games
-- can show it, and until now there was nowhere to put it.
ALTER TABLE flashcard_words ADD COLUMN part_of_speech TEXT;
