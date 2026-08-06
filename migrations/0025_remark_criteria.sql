-- Remark criteria (managed enum): the rating rows on the monthly report, until now the four
-- hardcoded columns on monthly_remarks. Config-managed exactly like assessment_types, so the
-- school can rename, add, retire and reorder what a monthly report rates.
CREATE TABLE remark_criteria (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  active     INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Seeded with the four previously hardcoded criteria. Fixed ids: the backfill below and any
-- straggler mobile bundle keep pointing at the same rows.
INSERT INTO remark_criteria (id, name, active, sort_order) VALUES
  ('rc_attitude',      'Thái độ học tập',    1, 1),
  ('rc_homework',      'Bài tập về nhà',     1, 2),
  ('rc_participation', 'Tham gia phát biểu', 1, 3),
  ('rc_progress',      'Tiến bộ',            1, 4);

-- Ratings become one JSON object keyed by criterion id ({"rc_attitude":4,...}), so adding a
-- criterion is a config row, not a schema change. No FK per key — a deleted criterion leaves a
-- harmless orphan key that no screen renders.
ALTER TABLE monthly_remarks ADD COLUMN ratings TEXT NOT NULL DEFAULT '{}';
UPDATE monthly_remarks SET ratings = json_object(
  'rc_attitude',      attitude,
  'rc_homework',      homework,
  'rc_participation', participation,
  'rc_progress',      progress);
ALTER TABLE monthly_remarks DROP COLUMN attitude;
ALTER TABLE monthly_remarks DROP COLUMN homework;
ALTER TABLE monthly_remarks DROP COLUMN participation;
ALTER TABLE monthly_remarks DROP COLUMN progress;
