-- Class cohorts: a class is identified for competition by (khối, trình độ).
-- `class_levels` is the trình độ enum, managed from /config exactly like grade_levels (0017).
-- Both columns on `classes` are nullable so existing rows keep working; the web form requires
-- them going forward, and a class missing either half is excluded from cohort rankings.

CREATE TABLE class_levels (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  active     INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
-- Seeded because the class form makes trình độ required: an empty table would dead-end the
-- create dialog until someone visited /config. Renameable/deactivatable from there.
INSERT INTO class_levels (id, name, active, sort_order) VALUES
  ('cl1','Cơ bản',1,1),('cl2','Nâng cao',1,2);

ALTER TABLE classes ADD COLUMN grade_level_id TEXT REFERENCES grade_levels(id) ON DELETE SET NULL;
ALTER TABLE classes ADD COLUMN class_level_id TEXT REFERENCES class_levels(id) ON DELETE SET NULL;

CREATE INDEX idx_classes_grade_level ON classes(grade_level_id);
CREATE INDEX idx_classes_class_level ON classes(class_level_id);
