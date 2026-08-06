-- Vườn cây từ vựng (vocabulary garden): one persistent plant per student that grows with every
-- qualifying vocab round and wilts when neglected, plus teacher-assigned vocab homework, a
-- cooperative per-class tree, and frozen month-end albums.
--
-- Design: the plant row is authoritative AS OF `settled_through`; time decay (wilt, stage drops,
-- death) is DERIVED by the pure `settlePlant` in shared/logic/garden.ts. Readers settle in memory
-- and never write, so a drop takes effect at ICT midnight for everyone at once whether or not the
-- daily cron has run. `garden_events` is the append-only audit log (and the qualifying-play ledger:
-- a 'grow' row exists for every qualifying play, with stage_delta 0 when the daily cap was hit).

CREATE TABLE garden_plants (
  student_id      TEXT PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  -- Student-chosen. NULL until they name it.
  plant_name      TEXT,
  -- App palette key (colorOf), same vocabulary as students.color.
  pot_color       TEXT NOT NULL DEFAULT 'orange',
  -- 0..5: 0 empty/dead, 1 hạt mầm, 2 nảy mầm, 3 cây non, 4 nở hoa, 5 ra quả.
  -- A live row is 1..5; stage 0 exists only with is_dead = 1. "No row" is the empty pot.
  stage           INTEGER NOT NULL,
  is_dead         INTEGER NOT NULL DEFAULT 0,
  -- ICT YYYY-MM-DD the wilt began, or NULL. Set by decay OR by a missed-deadline penalty;
  -- cleared by any care (play, harvest, watering).
  wilted_since    TEXT,
  -- ICT day of the last care event. The wilt/drop clock counts from here.
  last_care_day   TEXT NOT NULL,
  -- ICT day grow_count refers to, so the daily growth cap resets at ICT midnight.
  grow_day        TEXT,
  grow_count      INTEGER NOT NULL DEFAULT 0,
  -- Stages already lost to neglect since the last care event; reset to 0 by any care.
  -- This is the fence that makes decay idempotent AND survives an admin changing the wilt
  -- intervals: what was already taken is recorded, not re-derived from the current settings.
  drops_taken     INTEGER NOT NULL DEFAULT 0,
  -- Lifetime harvested fruit. Never decreases. Per-month counts come from harvest events.
  fruits_total    INTEGER NOT NULL DEFAULT 0,
  -- Consecutive ICT days with a qualifying play, as of streak_last_day. Expiry is derived.
  streak_days     INTEGER NOT NULL DEFAULT 0,
  streak_last_day TEXT,
  -- UTC ISO. Doubles as the optimistic-concurrency token (UPDATE ... WHERE updated_at = ?).
  updated_at      TEXT NOT NULL
);

CREATE TABLE garden_events (
  id             TEXT PRIMARY KEY,
  student_id     TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  -- grow | revive | harvest | wilt | decay_drop | die | deadline_drop | water
  type           TEXT NOT NULL,
  stage_before   INTEGER NOT NULL,
  stage_after    INTEGER NOT NULL,
  -- The ICT day the event is ATTRIBUTED to. For decay that is the day the drop was DUE, not the
  -- day the sweep noticed — so a late cron writes history in the right place.
  vn_day         TEXT NOT NULL,
  -- Natural idempotency key, by type: grow/revive = flashcard_results.id, harvest = fruit ordinal,
  -- decay_drop/die = the due ICT day, deadline_drop = vocab_assignments.id, water = NULL.
  ref_id         TEXT,
  actor_staff_id TEXT REFERENCES staff(id) ON DELETE SET NULL,
  note           TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_garden_events_student ON garden_events(student_id, created_at);
CREATE INDEX idx_garden_events_day ON garden_events(vn_day, type);
-- A UNIQUE violation aborts the whole db.batch, which is exactly how concurrent plays, a
-- double-tapped harvest and a re-run deadline sweep are all made harmless (same mechanism as
-- flashcard_results.client_id in 0014). Partial so plain watering, which has no natural key,
-- can repeat.
CREATE UNIQUE INDEX uq_garden_events_dedupe ON garden_events(student_id, type, ref_id)
  WHERE ref_id IS NOT NULL;

-- Teacher-assigned vocabulary: one topic, one class, one deadline. Progress is NOT stored — it is
-- counted from flashcard_results at read time, so editing the threshold re-reads honestly.
CREATE TABLE vocab_assignments (
  id             TEXT PRIMARY KEY,
  class_id       TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  topic_id       TEXT NOT NULL REFERENCES flashcard_topics(id) ON DELETE CASCADE,
  staff_id       TEXT REFERENCES staff(id) ON DELETE SET NULL,
  -- How many qualifying rounds the student owes, and the score % that makes a round qualify.
  required_count INTEGER NOT NULL DEFAULT 3,
  min_score_pct  INTEGER NOT NULL DEFAULT 70,
  -- ICT YYYY-MM-DD, inclusive.
  deadline       TEXT NOT NULL,
  note           TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_vocab_assignments_class ON vocab_assignments(class_id, deadline);
CREATE INDEX idx_vocab_assignments_topic ON vocab_assignments(topic_id);

-- Cooperative class tree: +1 point per qualifying play by any member, counted even when that
-- student's own plant was capped, already at fruit, or dead. Effort always counts for the class.
CREATE TABLE class_trees (
  class_id   TEXT PRIMARY KEY REFERENCES classes(id) ON DELETE CASCADE,
  points     INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

-- Month-end album. Names and plant state are denormalized into `data` because the album is a
-- keepsake: it must survive students leaving, classes being renamed, and plants growing on.
CREATE TABLE garden_snapshots (
  class_id   TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  month      TEXT NOT NULL,
  class_name TEXT NOT NULL,
  -- JSON { members: [{ studentId, name, color, plantName, potColor, stage, wilted, dead, streak,
  --         fruitMonth, fruitTotal, titleId }], classTree: { level, points } }
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (class_id, month)
);
