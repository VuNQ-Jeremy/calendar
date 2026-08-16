-- Materials become a shared library (feedback F-21): several classes may carry the same file,
-- exactly as several events already can. The single-owner columns on `materials` go away.
CREATE TABLE class_materials (
  class_id    TEXT NOT NULL REFERENCES classes(id)   ON DELETE CASCADE,
  material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (class_id, material_id)
);
CREATE INDEX idx_class_materials_material ON class_materials(material_id);

-- Backfill: a material filed under a class with scope='class' was shown as that class's material,
-- so it becomes exactly one link. scope='event' rows were never class materials and get none.
INSERT INTO class_materials (class_id, material_id)
SELECT class_id, id FROM materials WHERE class_id IS NOT NULL AND scope = 'class';

ALTER TABLE materials DROP COLUMN class_id;
ALTER TABLE materials DROP COLUMN scope;
