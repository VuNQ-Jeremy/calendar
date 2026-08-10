-- Subjects (môn học) become a managed enum, like grade_levels (0017) and class_levels (0029),
-- instead of a free-text field every teacher spells their own way.
--
-- `classes.subject` is NOT dropped. It is seeded from, backfilled against, and then left dormant
-- exactly like `classes.room`: the free text is the only record of what a class used to be called,
-- and keeping it means this migration is reversible without a second one.

CREATE TABLE subjects (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  active     INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Seed from what the classes already say, so no existing subject disappears. sort_order stays 0
-- for every row: the service orders by (sort_order, name), so they list alphabetically until an
-- admin drags them into a deliberate order.
INSERT INTO subjects (id, name, active, sort_order)
SELECT 'sub_' || lower(hex(randomblob(8))), name, 1, 0
FROM (
  SELECT DISTINCT TRIM(subject) AS name
  FROM classes
  WHERE subject IS NOT NULL AND TRIM(subject) <> ''
);

ALTER TABLE classes ADD COLUMN subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL;

UPDATE classes
SET subject_id = (SELECT s.id FROM subjects s WHERE s.name = TRIM(classes.subject))
WHERE subject IS NOT NULL AND TRIM(subject) <> '';

CREATE INDEX idx_classes_subject ON classes(subject_id);
