-- Event notes + event↔material attachments ("curriculum" for a lesson).
ALTER TABLE events ADD COLUMN notes TEXT;

CREATE TABLE event_materials (
  event_id    TEXT NOT NULL REFERENCES events(id)    ON DELETE CASCADE,
  material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, material_id)
);
CREATE INDEX idx_event_materials_material ON event_materials(material_id);
