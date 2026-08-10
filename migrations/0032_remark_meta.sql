-- Monthly remark provenance + send tracking. Until now a monthly_remarks row said nothing about
-- who wrote it or when, and "did this family get their report?" lived in the teacher's memory —
-- the slip printed an anonymous signature line. Four nullable columns, no backfill: rows written
-- before this migration honestly have no author or timestamps, and the slip simply omits the
-- teacher's name for them rather than inventing one.
--   staff_id    author of the LAST save (create or update), printed by the slip next to the
--               signature; SET NULL on staff delete so a departed teacher never blocks cleanup.
--   created_at  first save only (the upsert never overwrites it); updated_at every save. ISO
--               strings stamped by server/services/assessments.ts, never by the client.
--   sent_at     stamped by /zalo-send-card when the slip image actually reached at least one
--               family chat for this remark; the report tab's roster shows it as a "Sent" badge.
ALTER TABLE monthly_remarks ADD COLUMN staff_id TEXT REFERENCES staff(id) ON DELETE SET NULL;
ALTER TABLE monthly_remarks ADD COLUMN created_at TEXT;
ALTER TABLE monthly_remarks ADD COLUMN updated_at TEXT;
ALTER TABLE monthly_remarks ADD COLUMN sent_at TEXT;

CREATE INDEX idx_monthly_remarks_staff ON monthly_remarks(staff_id);
